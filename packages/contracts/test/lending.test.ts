import { expect } from "chai";
import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import type { Signer } from "ethers";
import { OFT_UNSAFE_ALLOW } from "../lz-options.js";

const conn = await network.create();
const { ethers, networkHelpers } = conn;
const up = await upgrades(hre, conn);

const E18 = 10n ** 18n;
const usd = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const eth = (n: number) => ethers.parseEther(String(n));
const ETH = ethers.encodeBytes32String("ETH-USD");
const BTC = ethers.encodeBytes32String("BTC-USD");
const YEAR = 365 * 86_400;

// the rules agreed for launch: 70% LTV, 80% liquidation, 5% bonus, 10% of interest to the Tide Pool, 4% APR at 80% use, 60% at 100%
const PARAMS = {
  ltvBps: 7000,
  liquidationBps: 8000,
  bonusBps: 500,
  reserveBps: 1000,
  closeFactorBps: 5000,
  baseRate: 0n,
  kinkRate: (4n * E18) / 100n,
  maxRate: (60n * E18) / 100n,
  kinkBps: 8000,
  supplyCap: usd(100_000),
  borrowCap: usd(100_000),
  dustDebt: usd(10),
};

async function deploy() {
  type S = Awaited<ReturnType<typeof ethers.getSigners>>[number];
  const [owner, lender, borrower, liquidator, keeper, guardian] = (await ethers.getSigners()) as [S, S, S, S, S, S];
  const ep = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(1);
  const opts = { kind: "uups" as const, initializer: "initialize" };
  const usdToken = await up.deployProxy(await ethers.getContractFactory("OmnitideUSD"), [owner.address, guardian.address, true], {
    ...opts,
    unsafeAllow: [...OFT_UNSAFE_ALLOW],
    constructorArgs: [await ep.getAddress()],
  });
  const oracle = await up.deployProxy(await ethers.getContractFactory("OmnitideOracle"), [owner.address, keeper.address, 120], opts);
  const ch = await up.deployProxy(
    await ethers.getContractFactory("OmnitideClearinghouse"),
    [owner.address, guardian.address, await usdToken.getAddress(), await oracle.getAddress(), 10, usd(1_000_000)],
    opts,
  );
  const weth = await (await ethers.getContractFactory("TestWeth")).deploy();
  const lending = await up.deployProxy(
    await ethers.getContractFactory("OmnitideLending"),
    [owner.address, guardian.address, await ch.getAddress(), await weth.getAddress(), ETH, PARAMS],
    opts,
  );
  const L = await lending.getAddress();
  for (const who of [lender, borrower, liquidator]) {
    await usdToken.faucetMint(who.address, usd(50_000));
    await usdToken.connect(who).approve(L, ethers.MaxUint256);
  }
  await weth.mint(borrower.address, eth(10));
  await weth.connect(borrower).approve(L, ethers.MaxUint256);
  return { owner, lender, borrower, liquidator, keeper, guardian, usdToken, oracle, ch, weth, lending };
}

type Ctx = Awaited<ReturnType<typeof deploy>>;

async function report(ctx: Ctx, price: bigint, feed = ETH, signer: Signer = ctx.keeper) {
  const timestamp = await networkHelpers.time.latest();
  const domain = { name: "OmnitideOracle", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.oracle.getAddress() };
  const types = { PriceReport: [{ name: "feed", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "timestamp", type: "uint64" }] };
  const signature = await signer.signTypedData(domain, types, { feed, price, timestamp });
  return { feed, price, timestamp, signature };
}

// lender supplies $10k; borrower locks 1 ETH at $2,000
async function opened(ctx: Ctx) {
  await ctx.lending.connect(ctx.lender).deposit(usd(10_000), ctx.lender.address);
  await ctx.lending.connect(ctx.borrower).depositCollateral(eth(1), ctx.borrower.address);
}

describe("OmnitideLending", () => {
  it("borrows up to 70% of the collateral and no further", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, usdToken } = ctx;
    await opened(ctx);
    const r = await report(ctx, 2_000n * E18);
    await expect(lending.connect(borrower).borrow(usd(1_401), borrower.address, r)).to.be.revertedWithCustomError(lending, "Unhealthy");
    const before = await usdToken.balanceOf(borrower.address);
    await lending.connect(borrower).borrow(usd(1_400), borrower.address, r);
    expect((await usdToken.balanceOf(borrower.address)) - before).to.equal(usd(1_400));
    expect(await lending.debtOf(borrower.address)).to.equal(usd(1_400));
    const pos = await lending.positionOf(borrower.address, 2_000n * E18);
    expect(pos.borrowLimit).to.equal(usd(1_400));
    expect(pos.health).to.equal((usd(1_600) * E18) / usd(1_400));
  });

  it("rejects foreign feeds, stale and unsigned prices", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, lender } = ctx;
    await opened(ctx);
    await expect(lending.connect(borrower).borrow(usd(10), borrower.address, await report(ctx, 2_000n * E18, BTC))).to.be.revertedWithCustomError(lending, "WrongFeed");
    await expect(lending.connect(borrower).borrow(usd(10), borrower.address, await report(ctx, 9_000n * E18, ETH, lender))).to.be.revertedWithCustomError(ctx.oracle, "UnknownSigner");
    const stale = await report(ctx, 2_000n * E18);
    await networkHelpers.time.increase(600);
    await expect(lending.connect(borrower).borrow(usd(10), borrower.address, stale)).to.be.revertedWithCustomError(ctx.oracle, "StaleReport");
  });

  it("borrows straight into clearinghouse margin", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, ch } = ctx;
    await opened(ctx);
    await lending.connect(borrower).borrowToMargin(usd(500), await report(ctx, 2_000n * E18));
    expect(await ch.balances(borrower.address)).to.equal(usd(500));
    expect(await lending.debtOf(borrower.address)).to.equal(usd(500));
  });

  it("charges the kinked rate, pays lenders and sends 10% of interest to the Tide Pool", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, lender, ch } = ctx;
    expect(await lending.borrowRate(0)).to.equal(0n);
    expect(await lending.borrowRate(4000)).to.equal((2n * E18) / 100n);
    expect(await lending.borrowRate(8000)).to.equal((4n * E18) / 100n);
    expect(await lending.borrowRate(9000)).to.equal((32n * E18) / 100n);
    expect(await lending.borrowRate(10_000)).to.equal((60n * E18) / 100n);

    await opened(ctx);
    await lending.connect(borrower).depositCollateral(eth(9), borrower.address);
    await lending.connect(borrower).borrow(usd(8_000), borrower.address, await report(ctx, 2_000n * E18)); // 80% used → 4% APR
    expect(await lending.utilization()).to.equal(8000n);
    await networkHelpers.time.increase(YEAR);
    await lending.accrue();
    const debt = await lending.debtOf(borrower.address);
    expect(debt).to.be.closeTo(usd(8_320), usd(1)); // 8,000 × 4%
    expect(await lending.reserves()).to.be.closeTo(usd(32), usd(1)); // 10% of 320
    // the lender's $10k is now worth $10k + 90% of the interest
    expect(await lending.convertToAssets(await lending.balanceOf(lender.address))).to.be.closeTo(usd(10_288), usd(1));

    const pool = await ch.poolBalance();
    await lending.sendReserves();
    expect((await ch.poolBalance()) - pool).to.be.closeTo(usd(32), usd(1));
    expect(await lending.reserves()).to.equal(0n);
    expect(await lending.convertToAssets(await lending.balanceOf(lender.address))).to.be.closeTo(usd(10_288), usd(1));
  });

  it("repays in full from anyone and releases the collateral", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, liquidator, weth } = ctx;
    await opened(ctx);
    const r = await report(ctx, 2_000n * E18);
    await lending.connect(borrower).borrow(usd(1_000), borrower.address, r);
    await expect(lending.connect(borrower).withdrawCollateral(eth(0.5), borrower.address, await report(ctx, 2_000n * E18))).to.be.revertedWithCustomError(lending, "Unhealthy");
    await networkHelpers.time.increase(30 * 86_400);
    // someone else (an Inlet, a friend) clears the debt
    await lending.connect(liquidator).repay(ethers.MaxUint256, borrower.address);
    expect(await lending.debtOf(borrower.address)).to.equal(0n);
    expect(await lending.totalDebtScaled()).to.equal(0n);
    await lending.connect(borrower).withdrawCollateral(eth(1), borrower.address, await report(ctx, 2_000n * E18));
    expect(await weth.balanceOf(borrower.address)).to.equal(eth(10));
  });

  it("liquidates half the debt for collateral plus 5% once past 80%", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, liquidator, weth } = ctx;
    await opened(ctx);
    await lending.connect(borrower).borrow(usd(1_400), borrower.address, await report(ctx, 2_000n * E18));
    await expect(lending.connect(liquidator).liquidate(borrower.address, usd(100), liquidator.address, await report(ctx, 2_000n * E18))).to.be.revertedWithCustomError(lending, "Healthy");

    // ETH falls to $1,700: limit 1,360 < debt 1,400
    const r = await report(ctx, 1_700n * E18);
    await expect(lending.connect(liquidator).liquidate(borrower.address, usd(701), liquidator.address, r)).to.be.revertedWithCustomError(lending, "TooMuchRepaid");
    await lending.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256, liquidator.address, r);
    const seized = await weth.balanceOf(liquidator.address);
    expect(seized).to.equal((usd(735) * 10n ** 30n) / (1_700n * E18)); // $700 × 1.05 of ETH
    expect(await lending.debtOf(borrower.address)).to.be.closeTo(usd(700), 2n);
    const pos = await lending.positionOf(borrower.address, 1_700n * E18);
    expect(pos.health).to.be.gt(E18); // healthy again
  });

  it("writes off debt left with no collateral against the lenders", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, liquidator, lender } = ctx;
    await opened(ctx);
    await lending.connect(borrower).borrow(usd(1_400), borrower.address, await report(ctx, 2_000n * E18));
    await lending.setParams({ ...PARAMS, dustDebt: usd(5_000) }); // whole position in one go
    // ETH crashes to $1,000: collateral worth less than the debt
    const r = await report(ctx, 1_000n * E18);
    await expect(lending.connect(liquidator).liquidate(borrower.address, ethers.MaxUint256, liquidator.address, r)).to.emit(lending, "BadDebt");
    const a = await lending.accounts(borrower.address);
    expect(a.collateral).to.equal(0n);
    expect(a.debtScaled).to.equal(0n);
    expect(await lending.totalDebtScaled()).to.equal(0n);
    // liquidator paid $952.38 for 1 ETH ($1,000 = repay × 1.05); lenders lose the other $447.62
    expect(await lending.convertToAssets(await lending.balanceOf(lender.address))).to.be.closeTo(usd(10_000) - usd(1_400) + 952_380_953n, 2n);
  });

  it("keeps lender exits to idle cash and enforces both caps", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, lender } = ctx;
    await lending.setParams({ ...PARAMS, supplyCap: usd(2_000), borrowCap: usd(500) });
    await expect(lending.connect(lender).deposit(usd(2_001), lender.address)).to.be.revertedWithCustomError(lending, "ERC4626ExceededMaxDeposit");
    await lending.connect(lender).deposit(usd(1_000), lender.address);
    await lending.connect(borrower).depositCollateral(eth(1), borrower.address);
    const r = await report(ctx, 2_000n * E18);
    await expect(lending.connect(borrower).borrow(usd(501), borrower.address, r)).to.be.revertedWithCustomError(lending, "CapReached");
    await lending.connect(borrower).borrow(usd(500), borrower.address, r);
    expect(await lending.maxWithdraw(lender.address)).to.equal(usd(500));
    await expect(lending.connect(lender).withdraw(usd(501), lender.address, lender.address)).to.be.revertedWithCustomError(lending, "ERC4626ExceededMaxWithdraw");
    // a second of interest has already set aside a sliver of reserves, so the last cent stays put
    await lending.connect(lender).withdraw(usd(499), lender.address, lender.address);
  });

  it("pauses new borrowing but never repayment or lender exits", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, lender, guardian } = ctx;
    await opened(ctx);
    await lending.connect(borrower).borrow(usd(100), borrower.address, await report(ctx, 2_000n * E18));
    await expect(lending.connect(lender).pause()).to.be.revertedWithCustomError(lending, "NotGuardian");
    await lending.connect(guardian).pause();
    await expect(lending.connect(borrower).borrow(usd(1), borrower.address, await report(ctx, 2_000n * E18))).to.be.revertedWithCustomError(lending, "EnforcedPause");
    expect(await lending.maxDeposit(lender.address)).to.equal(0n);
    await lending.connect(borrower).repay(ethers.MaxUint256, borrower.address);
    await lending.connect(lender).withdraw(usd(1_000), lender.address, lender.address);
  });

  it("wraps native ETH as collateral and refuses unsafe parameters", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { lending, borrower, lender } = ctx;
    await lending.connect(lender).depositETH(borrower.address, { value: eth(0.25) });
    expect((await lending.accounts(borrower.address)).collateral).to.equal(eth(0.25));
    await expect(lending.setParams({ ...PARAMS, ltvBps: 8000 })).to.be.revertedWithCustomError(lending, "BadParams");
    await expect(lending.setParams({ ...PARAMS, bonusBps: 2_600 })).to.be.revertedWithCustomError(lending, "BadParams");
    await expect(lending.connect(lender).setParams(PARAMS)).to.be.revertedWithCustomError(lending, "OwnableUnauthorizedAccount");
  });
});

describe("OmnitideClearinghouse.depositFor", () => {
  it("credits another account and respects the deposit cap", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, usdToken, lender, borrower, owner, guardian } = ctx;
    await usdToken.connect(lender).approve(await ch.getAddress(), ethers.MaxUint256);
    await expect(ch.connect(lender).depositFor(borrower.address, usd(25))).to.emit(ch, "Deposited");
    expect(await ch.balances(borrower.address)).to.equal(usd(25));
    expect(await ch.balances(lender.address)).to.equal(0n);
    await ch.connect(owner).setParams(10, usd(30), guardian.address);
    await expect(ch.connect(lender).depositFor(borrower.address, usd(6))).to.be.revertedWithCustomError(ch, "DepositCapReached");
    await expect(ch.connect(lender).depositFor(ethers.ZeroAddress, usd(1))).to.be.revertedWithCustomError(ch, "ZeroAddress");
  });
});

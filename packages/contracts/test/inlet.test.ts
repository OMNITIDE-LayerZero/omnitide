import { expect } from "chai";
import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import { OFT_UNSAFE_ALLOW } from "../lz-options.js";

const conn = await network.create();
const { ethers, networkHelpers } = conn;
const up = await upgrades(hre, conn);

const E18 = 10n ** 18n;
const usd = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const eth = (n: number) => ethers.parseEther(String(n));
const ETH = ethers.encodeBytes32String("ETH-USD");
const MARGIN = 0;
const REPAY = 1;

async function deploy() {
  type S = Awaited<ReturnType<typeof ethers.getSigners>>[number];
  const [owner, alice, bob, keeper, guardian, solver] = (await ethers.getSigners()) as [S, S, S, S, S, S];
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
  const usdg = await (await ethers.getContractFactory("TestStable")).deploy(6);
  const port = await up.deployProxy(await ethers.getContractFactory("OmnitidePort"), [owner.address, guardian.address, await usdg.getAddress(), await usdToken.getAddress()], opts);
  await usdToken.setMinter(await port.getAddress(), true);
  const weth = await (await ethers.getContractFactory("TestWeth")).deploy();
  const lending = await up.deployProxy(
    await ethers.getContractFactory("OmnitideLending"),
    [
      owner.address,
      guardian.address,
      await ch.getAddress(),
      await weth.getAddress(),
      ETH,
      { ltvBps: 7000, liquidationBps: 8000, bonusBps: 500, reserveBps: 1000, closeFactorBps: 5000, baseRate: 0n, kinkRate: (4n * E18) / 100n, maxRate: (60n * E18) / 100n, kinkBps: 8000, supplyCap: usd(100_000), borrowCap: usd(100_000), dustDebt: usd(1) },
    ],
    opts,
  );
  const inlet = await up.deployProxy(
    await ethers.getContractFactory("OmnitideInlet"),
    [owner.address, guardian.address, await ch.getAddress(), await port.getAddress(), await usdg.getAddress(), await lending.getAddress(), await weth.getAddress()],
    opts,
  );
  // a lender so alice can borrow
  await usdToken.faucetMint(bob.address, usd(1_000));
  await usdToken.connect(bob).approve(await lending.getAddress(), ethers.MaxUint256);
  await lending.connect(bob).deposit(usd(1_000), bob.address);
  return { owner, alice, bob, keeper, guardian, solver, usdToken, oracle, ch, usdg, port, weth, lending, inlet };
}

type Ctx = Awaited<ReturnType<typeof deploy>>;

async function report(ctx: Ctx, price: bigint) {
  const timestamp = await networkHelpers.time.latest();
  const domain = { name: "OmnitideOracle", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.oracle.getAddress() };
  const types = { PriceReport: [{ name: "feed", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "timestamp", type: "uint64" }] };
  return { feed: ETH, price, timestamp, signature: await ctx.keeper.signTypedData(domain, types, { feed: ETH, price, timestamp }) };
}

describe("OmnitideInlet", () => {
  it("credits a solver's plain USDG transfer to the owner's margin, whoever sweeps", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { alice, bob, solver, usdg, ch, inlet, port } = ctx;
    const box = await inlet.inletOf(alice.address, MARGIN);
    expect(box).to.not.equal(await inlet.inletOf(alice.address, REPAY));
    expect(box).to.not.equal(await inlet.inletOf(bob.address, MARGIN));
    await usdg.mint(box, usd(25)); // the box receives before any code lives there
    expect((await inlet.pending(alice.address, MARGIN))[0]).to.equal(usd(25));
    await expect(inlet.connect(solver).sweep(alice.address, MARGIN)).to.emit(inlet, "Swept");
    expect(await ch.balances(alice.address)).to.equal(usd(25));
    expect(await ch.balances(solver.address)).to.equal(0n);
    expect(await usdg.balanceOf(await port.getAddress())).to.equal(usd(25)); // backed 1:1 in the Port
    await expect(inlet.sweep(alice.address, MARGIN)).to.be.revertedWithCustomError(inlet, "NothingToSweep");
    await usdg.mint(box, usd(5)); // a second delivery reuses the deployed box
    await inlet.sweep(alice.address, MARGIN);
    expect(await ch.balances(alice.address)).to.equal(usd(30));
  });

  it("pays the loan first on the repay route and sends the rest to margin", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { alice, usdg, usdToken, ch, inlet, lending } = ctx;
    await lending.connect(alice).depositETH(alice.address, { value: eth(1) });
    await lending.connect(alice).borrow(usd(100), alice.address, await report(ctx, 2_000n * E18));
    const box = await inlet.inletOf(alice.address, REPAY);
    await usdg.mint(box, usd(60));
    await usdToken.faucetMint(box, usd(60));
    await inlet.sweep(alice.address, REPAY);
    expect(await lending.debtOf(alice.address)).to.equal(0n);
    const margin = await ch.balances(alice.address);
    expect(margin).to.be.greaterThan(usd(19)); // 120 in, ~100 plus a few seconds of interest to the loan
    expect(margin).to.be.lessThan(usd(20));
    // no loan: the repay route simply funds margin
    await usdg.mint(box, usd(10));
    await inlet.sweep(alice.address, REPAY);
    expect(await ch.balances(alice.address)).to.equal(margin + usd(10));
  });

  it("locks ETH and WETH that land in a box as Lending collateral", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { alice, solver, weth, inlet, lending } = ctx;
    const box = await inlet.inletOf(alice.address, MARGIN);
    await solver.sendTransaction({ to: box, value: eth(0.5) });
    await weth.mint(box, eth(0.25));
    expect((await inlet.pending(alice.address, MARGIN))[1]).to.equal(eth(0.75));
    await inlet.sweep(alice.address, MARGIN);
    expect((await lending.accounts(alice.address))[0]).to.equal(eth(0.75));
    await solver.sendTransaction({ to: box, value: eth(0.1) }); // the deployed box still takes ETH
    await inlet.sweep(alice.address, MARGIN);
    expect((await lending.accounts(alice.address))[0]).to.equal(eth(0.85));
  });

  it("lets only the owner rescue a box raw, even while paused", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { alice, bob, guardian, solver, usdg, inlet } = ctx;
    const box = await inlet.inletOf(alice.address, MARGIN);
    await usdg.mint(box, usd(7));
    await solver.sendTransaction({ to: box, value: eth(0.2) });
    await inlet.connect(guardian).pause();
    await expect(inlet.sweep(alice.address, MARGIN)).to.be.revertedWithCustomError(inlet, "EnforcedPause");
    await expect(inlet.connect(bob).rescue(MARGIN, await usdg.getAddress())).to.be.revertedWithCustomError(inlet, "NothingToSweep"); // bob's own box is empty
    await inlet.connect(alice).rescue(MARGIN, await usdg.getAddress());
    expect(await usdg.balanceOf(alice.address)).to.equal(usd(7));
    const before = await ethers.provider.getBalance(alice.address);
    await inlet.connect(alice).rescue(MARGIN, ethers.ZeroAddress);
    expect(await ethers.provider.getBalance(alice.address)).to.be.greaterThan(before + eth(0.19));
    await expect(inlet.connect(bob).pause()).to.be.revertedWithCustomError(inlet, "NotGuardian");
  });

  it("refuses a second init on a box and a stranger's pull", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { alice, bob, usdg, inlet } = ctx;
    await usdg.mint(await inlet.inletOf(alice.address, MARGIN), usd(1));
    await inlet.sweep(alice.address, MARGIN);
    const box = await ethers.getContractAt("OmnitideInletBox", await inlet.inletOf(alice.address, MARGIN));
    expect(await box.inlet()).to.equal(await inlet.getAddress());
    await expect(box.connect(bob).init()).to.be.revertedWithCustomError(box, "NotInlet");
    await expect(box.connect(bob).pull(await usdg.getAddress(), bob.address, 0)).to.be.revertedWithCustomError(box, "NotInlet");
  });
});

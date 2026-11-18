import { expect } from "chai";
import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import type { Signer } from "ethers";
import { lzReceiveOption, MSG_SEND, MSG_SEND_AND_CALL, OFT_UNSAFE_ALLOW } from "../lz-options.js";

const conn = await network.create();
const { ethers, networkHelpers } = conn;
const up = await upgrades(hre, conn);

const HUB = 1;
const SPOKE = 2;
const E18 = 10n ** 18n;
const usd = (n: number | bigint) => BigInt(n) * 10n ** 6n;
const feed = (s: string) => ethers.encodeBytes32String(s);
const BTC = feed("BTC-USD");
const ETH = feed("ETH-USD");

async function deploy() {
  const [owner, alice, bob, keeper, guardian] = await ethers.getSigners();
  const Endpoint = await ethers.getContractFactory("EndpointV2Mock");
  const hubEp = await Endpoint.deploy(HUB);
  const spokeEp = await Endpoint.deploy(SPOKE);

  const USD = await ethers.getContractFactory("OmnitideUSD");
  const opts = { kind: "uups" as const, initializer: "initialize" };
  const usdOpts = { ...opts, unsafeAllow: OFT_UNSAFE_ALLOW };
  const hubUsd = await up.deployProxy(USD, [owner.address, guardian.address, true], { ...usdOpts, constructorArgs: [await hubEp.getAddress()] });
  const spokeUsd = await up.deployProxy(USD, [owner.address, guardian.address, true], { ...usdOpts, constructorArgs: [await spokeEp.getAddress()] });

  const Oracle = await ethers.getContractFactory("OmnitideOracle");
  const oracle = await up.deployProxy(Oracle, [owner.address, keeper.address, 120], opts);
  const CH = await ethers.getContractFactory("OmnitideClearinghouse");
  const ch = await up.deployProxy(CH, [owner.address, guardian.address, await hubUsd.getAddress(), await oracle.getAddress(), 10, usd(1_000_000)], opts);

  // wire the LayerZero mesh
  await hubEp.setDestLzEndpoint(await spokeUsd.getAddress(), await spokeEp.getAddress());
  await spokeEp.setDestLzEndpoint(await hubUsd.getAddress(), await hubEp.getAddress());
  await hubUsd.setPeer(SPOKE, ethers.zeroPadValue(await spokeUsd.getAddress(), 32));
  await spokeUsd.setPeer(HUB, ethers.zeroPadValue(await hubUsd.getAddress(), 32));
  for (const [token, dst] of [[hubUsd, SPOKE], [spokeUsd, HUB]] as const) {
    await token.setEnforcedOptions([
      { eid: dst, msgType: MSG_SEND, options: lzReceiveOption(80_000n) },
      // the mock executor rejects compose options (type 3); real deploys enforce lzReceiveAndComposeOption
      { eid: dst, msgType: MSG_SEND_AND_CALL, options: lzReceiveOption(80_000n) },
    ]);
    await token.setRateLimit(dst, usd(50_000), 3600);
  }

  await ch.setMarket(0, BTC, 1000, 500, 10n ** 24n, true); // 10x, 5% maintenance
  await ch.setMarket(1, ETH, 2000, 1000, 10n ** 24n, true); // 5x

  // seed the Tide Pool
  await hubUsd.connect(owner).drip();
  await hubUsd.approve(await ch.getAddress(), usd(1_000));
  await ch.fundPool(usd(1_000));

  return { owner, alice, bob, keeper, guardian, hubEp, spokeEp, hubUsd, spokeUsd, oracle, ch };
}

type Ctx = Awaited<ReturnType<typeof deploy>>;

async function report(ctx: Ctx, f: string, price: bigint, signer: Signer = ctx.keeper, ts?: number) {
  const timestamp = ts ?? (await networkHelpers.time.latest());
  const domain = { name: "OmnitideOracle", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.oracle.getAddress() };
  const types = { PriceReport: [{ name: "feed", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "timestamp", type: "uint64" }] };
  const signature = await signer.signTypedData(domain, types, { feed: f, price, timestamp });
  return { feed: f, price, timestamp, signature };
}

async function depositLocal(ctx: Ctx, who: Signer, amount: bigint) {
  await ctx.hubUsd.connect(who).drip();
  await ctx.hubUsd.connect(who).approve(await ctx.ch.getAddress(), amount);
  await ctx.ch.connect(who).deposit(amount);
}

describe("OmnitideUSD", () => {
  it("drips once per day and respects the faucet switch", async () => {
    const { hubUsd, alice } = await networkHelpers.loadFixture(deploy);
    await hubUsd.connect(alice).drip();
    expect(await hubUsd.balanceOf(alice.address)).to.equal(usd(1_000));
    await expect(hubUsd.connect(alice).drip()).to.be.revertedWithCustomError(hubUsd, "DripCooldown");
    await networkHelpers.time.increase(86_400);
    await hubUsd.connect(alice).drip();
    await hubUsd.setFaucetEnabled(false);
    await networkHelpers.time.increase(86_400);
    await expect(hubUsd.connect(alice).drip()).to.be.revertedWithCustomError(hubUsd, "FaucetDisabled");
  });

  it("uses 6 decimals and blocks re-initialisation", async () => {
    const { hubUsd, owner, guardian } = await networkHelpers.loadFixture(deploy);
    expect(await hubUsd.decimals()).to.equal(6);
    await expect(hubUsd.initialize(owner.address, guardian.address, true)).to.be.revertedWithCustomError(hubUsd, "InvalidInitialization");
  });

  it("restricts admin functions to the owner and pause to the guardian", async () => {
    const { hubUsd, alice, guardian } = await networkHelpers.loadFixture(deploy);
    await expect(hubUsd.connect(alice).setRateLimit(SPOKE, 1, 1)).to.be.revertedWithCustomError(hubUsd, "OwnableUnauthorizedAccount");
    await expect(hubUsd.connect(alice).pause()).to.be.revertedWithCustomError(hubUsd, "NotGuardian");
    await hubUsd.connect(guardian).pause();
    await expect(hubUsd.connect(alice).drip()).to.be.revertedWithCustomError(hubUsd, "EnforcedPause");
    await expect(hubUsd.connect(guardian).unpause()).to.be.revertedWithCustomError(hubUsd, "OwnableUnauthorizedAccount");
  });

  it("bridges hub → spoke and enforces the per-pathway rate limit", async () => {
    const { hubUsd, spokeUsd, alice } = await networkHelpers.loadFixture(deploy);
    await hubUsd.connect(alice).drip();
    const p = { dstEid: SPOKE, to: ethers.zeroPadValue(alice.address, 32), amountLD: usd(400), minAmountLD: usd(400), extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const q = await hubUsd.quoteSend(p, false);
    const fee = { nativeFee: q.nativeFee, lzTokenFee: q.lzTokenFee };
    await hubUsd.connect(alice).send(p, fee, alice.address, { value: fee.nativeFee });
    expect(await spokeUsd.balanceOf(alice.address)).to.equal(usd(400));
    expect(await hubUsd.availableToSend(SPOKE)).to.equal(usd(49_600));

    await hubUsd.setRateLimit(SPOKE, usd(100), 3600);
    await expect(hubUsd.connect(alice).send(p, fee, alice.address, { value: fee.nativeFee })).to.be.revertedWithCustomError(hubUsd, "RateLimitExceeded");
    await hubUsd.setRateLimit(SPOKE, 0, 3600);
    expect(await hubUsd.availableToSend(SPOKE)).to.equal(0);
  });
});

describe("OmnitideOracle", () => {
  it("accepts fresh signed reports and rejects stale, future, zero and foreign ones", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { oracle, alice } = ctx;
    expect(await oracle.verify(await report(ctx, BTC, 60_000n * E18))).to.equal(60_000n * E18);
    const now = await networkHelpers.time.latest();
    await expect(oracle.verify(await report(ctx, BTC, 1n, ctx.keeper, now - 500))).to.be.revertedWithCustomError(oracle, "StaleReport");
    await expect(oracle.verify(await report(ctx, BTC, 1n, ctx.keeper, now + 600))).to.be.revertedWithCustomError(oracle, "FutureReport");
    await expect(oracle.verify(await report(ctx, BTC, 0n))).to.be.revertedWithCustomError(oracle, "ZeroPrice");
    await expect(oracle.verify(await report(ctx, BTC, 1n, alice))).to.be.revertedWithCustomError(oracle, "UnknownSigner");
  });
});

describe("OmnitideClearinghouse", () => {
  it("credits Inflow from a spoke through lzCompose", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { spokeUsd, hubUsd, ch, hubEp, alice } = ctx;
    await spokeUsd.connect(alice).drip();
    const composeMsg = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [alice.address]);
    const p = { dstEid: HUB, to: ethers.zeroPadValue(await ch.getAddress(), 32), amountLD: usd(500), minAmountLD: usd(500), extraOptions: "0x", composeMsg, oftCmd: "0x" };
    const q = await spokeUsd.quoteSend(p, false);
    const fee = { nativeFee: q.nativeFee, lzTokenFee: q.lzTokenFee };
    await spokeUsd.connect(alice).send(p, fee, alice.address, { value: fee.nativeFee });
    expect(await hubUsd.balanceOf(await ch.getAddress())).to.equal(usd(1_500));

    // the executor delivers the compose; reproduce its exact payload: nonce | srcEid | amountLD | composeFrom | composeMsg
    const message = ethers.solidityPacked(
      ["uint64", "uint32", "uint256", "bytes32", "bytes"],
      [1, SPOKE, usd(500), ethers.zeroPadValue(alice.address, 32), composeMsg],
    );
    await expect(ch.lzCompose(await hubUsd.getAddress(), ethers.ZeroHash, message, alice.address, "0x")).to.be.revertedWithCustomError(ch, "NotEndpoint");
    const ep = await networkHelpers.impersonateAccount(await hubEp.getAddress()).then(() => ethers.getSigner(hubEp.target as string));
    await networkHelpers.setBalance(await hubEp.getAddress(), E18);
    await expect(ch.connect(ep).lzCompose(await hubUsd.getAddress(), ethers.id("guid"), message, alice.address, "0x"))
      .to.emit(ch, "Deposited").withArgs(alice.address, usd(500), SPOKE, ethers.id("guid"));
    expect(await ch.balances(alice.address)).to.equal(usd(500));
  });

  it("Ebbs collateral back to a spoke", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, spokeUsd, hubUsd, alice } = ctx;
    await depositLocal(ctx, alice, usd(300));
    const p = { dstEid: SPOKE, to: ethers.zeroPadValue(alice.address, 32), amountLD: usd(200), minAmountLD: usd(200), extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const q = await hubUsd.quoteSend(p, false);
    const fee = { nativeFee: q.nativeFee, lzTokenFee: q.lzTokenFee };
    await expect(ch.connect(alice).withdraw(usd(200), SPOKE, alice.address, [], { value: fee.nativeFee })).to.emit(ch, "Withdrawn");
    expect(await spokeUsd.balanceOf(alice.address)).to.equal(usd(200));
    expect(await ch.balances(alice.address)).to.equal(usd(100));
    await expect(ch.connect(alice).withdraw(usd(101), HUB, alice.address, [])).to.be.revertedWithCustomError(ch, "InsufficientBalance");
  });

  it("opens and closes a cross-margined long with pool-settled PnL and fees", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice } = ctx;
    await depositLocal(ctx, alice, usd(1_000));
    const size = E18 / 10n; // 0.1 BTC
    await ch.connect(alice).trade(0, size, 60_100n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    expect((await ch.positions(alice.address, 0)).size).to.equal(size);
    // fee: 6,000 notional × 10 bps = 6 tdUSD
    expect(await ch.balances(alice.address)).to.equal(usd(994));

    await ch.connect(alice).trade(0, -size, 0, [await report(ctx, BTC, 61_000n * E18)]);
    // +100 pnl − 6.1 fee
    expect(await ch.balances(alice.address)).to.equal(usd(994) + usd(100) - 6_100_000n);
    expect(await ch.openMarkets(alice.address)).to.deep.equal([]);
  });

  it("rejects over-leverage, slippage and missing prices", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice } = ctx;
    await depositLocal(ctx, alice, usd(100));
    const px = [await report(ctx, BTC, 60_000n * E18)];
    await expect(ch.connect(alice).trade(0, E18, 70_000n * E18, px)).to.be.revertedWithCustomError(ch, "InsufficientMargin");
    await expect(ch.connect(alice).trade(0, E18 / 1000n, 59_000n * E18, px)).to.be.revertedWithCustomError(ch, "SlippageExceeded");
    await expect(ch.connect(alice).trade(1, E18 / 1000n, 10_000n * E18, px)).to.be.revertedWithCustomError(ch, "MissingPrice");
    await expect(ch.connect(alice).trade(9, 1, 1, px)).to.be.revertedWithCustomError(ch, "UnknownMarket");
  });

  it("uses one book: an ETH profit carries a BTC position", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice } = ctx;
    await depositLocal(ctx, alice, usd(200));
    await ch.connect(alice).trade(1, 49n * E18 / 100n, 2_100n * E18, [await report(ctx, ETH, 2_000n * E18)]);
    // 1,000 ETH notional needs 200 IM → the book is full at these prices
    const prices = async (eth: bigint) => [await report(ctx, ETH, eth * E18), await report(ctx, BTC, 60_000n * E18)];
    await expect(ch.connect(alice).trade(0, E18 / 100n, 61_000n * E18, await prices(2_000n))).to.be.revertedWithCustomError(ch, "InsufficientMargin");
    // ETH rallies 20% → +200 unrealised frees margin for BTC
    await ch.connect(alice).trade(0, E18 / 100n, 61_000n * E18, await prices(2_400n));
    expect(await ch.openMarkets(alice.address)).to.have.lengthOf(2);
  });

  it("fills limit, stop-loss and take-profit orders only past their trigger", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice, keeper } = ctx;
    await depositLocal(ctx, alice, usd(1_000));
    await ch.connect(alice).placeOrder(0, 0, E18 / 10n, 59_000n * E18, false); // limit buy
    await expect(ch.connect(keeper).executeOrder(0, [await report(ctx, BTC, 59_500n * E18)])).to.be.revertedWithCustomError(ch, "TriggerNotMet");
    await expect(ch.connect(keeper).executeOrder(0, [await report(ctx, BTC, 58_900n * E18)])).to.emit(ch, "OrderExecuted");

    await ch.connect(alice).placeOrder(0, 1, -E18, 57_000n * E18, false); // stop: forced reduce-only, clamped to 0.1
    await ch.connect(alice).placeOrder(0, 2, -E18 / 20n, 62_000n * E18, false); // take-profit half
    await ch.connect(keeper).executeOrder(2, [await report(ctx, BTC, 62_500n * E18)]);
    expect((await ch.positions(alice.address, 0)).size).to.equal(E18 / 20n);
    await ch.connect(keeper).executeOrder(1, [await report(ctx, BTC, 56_000n * E18)]);
    expect((await ch.positions(alice.address, 0)).size).to.equal(0);
    expect(await ch.openOrderCount(alice.address)).to.equal(0);
    await expect(ch.connect(alice).cancelOrder(1)).to.be.revertedWithCustomError(ch, "OrderNotActive");
  });

  it("liquidates under maintenance, pays the caller and keeps the pool whole", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice, bob } = ctx;
    await depositLocal(ctx, alice, usd(100));
    await ch.connect(alice).trade(0, E18 / 61n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)]); // 1,000 notional, 10x
    await expect(ch.connect(bob).liquidate(alice.address, [await report(ctx, BTC, 59_000n * E18)])).to.be.revertedWithCustomError(ch, "NotLiquidatable");
    await expect(ch.connect(bob).liquidate(alice.address, [await report(ctx, BTC, 55_200n * E18)])).to.emit(ch, "Liquidated");
    expect(await ch.openMarkets(alice.address)).to.deep.equal([]);
    expect(await ch.balances(bob.address)).to.be.greaterThan(0);
  });

  it("pause blocks new exposure but keeps closing and withdrawals open", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice, guardian } = ctx;
    await depositLocal(ctx, alice, usd(500));
    await ch.connect(alice).trade(0, E18 / 100n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    await ch.connect(guardian).pause();
    await expect(ch.connect(alice).trade(0, E18 / 100n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)])).to.be.revertedWithCustomError(ch, "PausedIncrease");
    await ch.connect(alice).trade(0, -E18 / 100n, 0, [await report(ctx, BTC, 60_000n * E18)]);
    await ch.connect(alice).withdraw(usd(100), HUB, alice.address, []);
    await expect(ch.connect(alice).deposit(1)).to.be.revertedWithCustomError(ch, "EnforcedPause");
  });

  it("enforces the deposit cap and owner-only config", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice } = ctx;
    await ch.setParams(10, usd(50), ctx.guardian.address);
    await ctx.hubUsd.connect(alice).drip();
    await ctx.hubUsd.connect(alice).approve(await ch.getAddress(), usd(100));
    await expect(ch.connect(alice).deposit(usd(60))).to.be.revertedWithCustomError(ch, "DepositCapReached");
    await expect(ch.connect(alice).setMarket(2, BTC, 1000, 500, 1, true)).to.be.revertedWithCustomError(ch, "OwnableUnauthorizedAccount");
  });
});

describe("Upgrades", () => {
  it("upgrades the clearinghouse in place with storage intact; only the owner can", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice } = ctx;
    await depositLocal(ctx, alice, usd(250));
    const addr = await ch.getAddress();
    const V2 = await ethers.getContractFactory("OmnitideClearinghouseV2");
    await up.validateUpgrade(addr, V2, { kind: "uups" });
    const v2 = await up.upgradeProxy(addr, V2, { kind: "uups" });
    expect(await v2.getAddress()).to.equal(addr);
    expect(await v2.getFunction("version")()).to.equal("2");
    expect(await v2.balances(alice.address)).to.equal(usd(250));

    const impl = await up.erc1967.getImplementationAddress(addr);
    await expect(ch.connect(alice).upgradeToAndCall(impl, "0x")).to.be.revertedWithCustomError(ch, "OwnableUnauthorizedAccount");
  });

  it("locks implementation contracts against initialisation", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const impl = await up.erc1967.getImplementationAddress(await ctx.oracle.getAddress());
    const oracleImpl = await ethers.getContractAt("OmnitideOracle", impl);
    await expect(oracleImpl.initialize(ctx.alice.address, ctx.alice.address, 1)).to.be.revertedWithCustomError(oracleImpl, "InvalidInitialization");
  });
});

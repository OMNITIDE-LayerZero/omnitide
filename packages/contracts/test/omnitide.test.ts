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
  type S = Awaited<ReturnType<typeof ethers.getSigners>>[number];
  const [owner, alice, bob, keeper, guardian] = (await ethers.getSigners()) as [S, S, S, S, S];
  const Endpoint = await ethers.getContractFactory("EndpointV2Mock");
  const hubEp = await Endpoint.deploy(HUB);
  const spokeEp = await Endpoint.deploy(SPOKE);

  const USD = await ethers.getContractFactory("OmnitideUSD");
  const opts = { kind: "uups" as const, initializer: "initialize" };
  const usdOpts = { ...opts, unsafeAllow: [...OFT_UNSAFE_ALLOW] };
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
    await expect(hubUsd.faucetMint(alice.address, 1)).to.be.revertedWithCustomError(hubUsd, "FaucetDisabled");
    await hubUsd.setFaucetEnabled(true);
    await expect(hubUsd.connect(alice).faucetMint(alice.address, 1)).to.be.revertedWithCustomError(hubUsd, "OwnableUnauthorizedAccount");
    await hubUsd.faucetMint(alice.address, usd(5));
    await expect(hubUsd.setGuardian(ethers.ZeroAddress)).to.be.revertedWithCustomError(hubUsd, "ZeroAddress");
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

async function portFixture() {
  const ctx = await deploy();
  const { owner, guardian, hubUsd, spokeUsd } = ctx;
  const Stable = await ethers.getContractFactory("TestStable");
  const usdg = await Stable.deploy(6);
  const usdc = await Stable.deploy(6);
  const Port = await ethers.getContractFactory("OmnitidePort");
  const opts = { kind: "uups" as const, initializer: "initialize" };
  const hubPort = await up.deployProxy(Port, [owner.address, guardian.address, await usdg.getAddress(), await hubUsd.getAddress()], opts);
  const spokePort = await up.deployProxy(Port, [owner.address, guardian.address, await usdc.getAddress(), await spokeUsd.getAddress()], opts);
  await hubUsd.setMinter(await hubPort.getAddress(), true);
  await spokeUsd.setMinter(await spokePort.getAddress(), true);
  return { ...ctx, usdg, usdc, hubPort, spokePort };
}

describe("OmnitidePort (stablecoin-backed tdUSD)", () => {
  it("mints 1:1 against the stablecoin and redeems from the local reserve only", async () => {
    const { usdg, hubPort, hubUsd, alice, bob } = await networkHelpers.loadFixture(portFixture);
    await usdg.mint(alice.address, usd(100));
    await usdg.connect(alice).approve(await hubPort.getAddress(), usd(100));
    await expect(hubPort.connect(alice).deposit(usd(100), alice.address)).to.emit(hubPort, "Deposited").withArgs(alice.address, alice.address, usd(100), ethers.ZeroHash);
    expect(await hubUsd.balanceOf(alice.address)).to.equal(usd(100));
    expect(await hubPort.reserve()).to.equal(usd(100));

    await hubPort.connect(alice).redeem(usd(40), bob.address);
    expect(await usdg.balanceOf(bob.address)).to.equal(usd(40));
    expect(await hubUsd.balanceOf(alice.address)).to.equal(usd(60));
    // faucet tdUSD has no reserve behind it on this chain
    await hubUsd.connect(bob).drip();
    await expect(hubPort.connect(bob).redeem(usd(61), bob.address)).to.be.revertedWithCustomError(hubPort, "InsufficientReserve");
    await expect(hubPort.connect(alice).deposit(0, alice.address)).to.be.revertedWithCustomError(hubPort, "ZeroAmount");
  });

  it("keeps mint and burn to Ports, refuses a mismatched stablecoin, owner-only admin", async () => {
    const { hubUsd, hubPort, alice, owner, guardian } = await networkHelpers.loadFixture(portFixture);
    await expect(hubUsd.connect(alice).mint(alice.address, 1)).to.be.revertedWithCustomError(hubUsd, "NotMinter");
    await expect(hubUsd.connect(alice).burn(owner.address, 1)).to.be.revertedWithCustomError(hubUsd, "NotMinter");
    await expect(hubUsd.connect(alice).setMinter(alice.address, true)).to.be.revertedWithCustomError(hubUsd, "OwnableUnauthorizedAccount");
    const eighteen = await (await ethers.getContractFactory("TestStable")).deploy(18);
    await expect(
      up.deployProxy(await ethers.getContractFactory("OmnitidePort"), [owner.address, guardian.address, await eighteen.getAddress(), await hubUsd.getAddress()], { kind: "uups" }),
    ).to.be.revertedWithCustomError(hubPort, "DecimalsMismatch");
    await expect(hubPort.connect(alice).upgradeToAndCall(alice.address, "0x")).to.be.revertedWithCustomError(hubPort, "OwnableUnauthorizedAccount");
  });

  it("pause stops deposits but never redemptions", async () => {
    const { usdg, hubPort, alice, guardian } = await networkHelpers.loadFixture(portFixture);
    await usdg.mint(alice.address, usd(50));
    await usdg.connect(alice).approve(await hubPort.getAddress(), usd(50));
    await hubPort.connect(alice).deposit(usd(20), alice.address);
    await expect(hubPort.connect(alice).pause()).to.be.revertedWithCustomError(hubPort, "NotGuardian");
    await hubPort.connect(guardian).pause();
    await expect(hubPort.connect(alice).deposit(usd(10), alice.address)).to.be.revertedWithCustomError(hubPort, "EnforcedPause");
    await hubPort.connect(alice).redeem(usd(20), alice.address);
    expect(await usdg.balanceOf(alice.address)).to.equal(usd(50));
  });

  it("deposits USDC on a spoke and sends the tdUSD into the hub clearinghouse in one call", async () => {
    const { usdc, spokePort, spokeUsd, hubUsd, ch, alice } = await networkHelpers.loadFixture(portFixture);
    await usdc.mint(alice.address, usd(300));
    await usdc.connect(alice).approve(await spokePort.getAddress(), usd(300));
    const composeMsg = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [alice.address]);
    const p = { dstEid: HUB, to: ethers.zeroPadValue(await ch.getAddress(), 32), amountLD: usd(300), minAmountLD: usd(300), extraOptions: "0x", composeMsg, oftCmd: "0x" };
    const q = await spokeUsd.quoteSend(p, false);
    await expect(spokePort.connect(alice).depositAndSend(usd(300), { ...p, composeMsg: "0x" }, { value: q.nativeFee })).to.be.revertedWithCustomError(spokePort, "NoBeneficiary");
    await expect(spokePort.connect(alice).depositAndSend(usd(300), p, { value: q.nativeFee })).to.emit(spokePort, "Deposited");
    expect(await spokePort.reserve()).to.equal(usd(300));
    expect(await spokeUsd.balanceOf(await spokePort.getAddress())).to.equal(0);
    expect(await hubUsd.balanceOf(await ch.getAddress())).to.equal(usd(1_300));
  });
});

async function harborFixture() {
  const ctx = await deploy();
  const { owner, guardian, ch, hubEp, spokeEp, hubUsd } = ctx;
  const opts = { kind: "uups" as const, initializer: "initialize" };
  const harbor = await up.deployProxy(await ethers.getContractFactory("OmnitideHarbor"), [owner.address, guardian.address, await ch.getAddress()], opts);
  const lz = { ...opts, unsafeAllow: [...OFT_UNSAFE_ALLOW] };
  const adapter = await up.deployProxy(await ethers.getContractFactory("OmnitideHarborShareAdapter"), [owner.address], { ...lz, constructorArgs: [await harbor.getAddress(), await hubEp.getAddress()] });
  const spokeShare = await up.deployProxy(await ethers.getContractFactory("OmnitideHarborShare"), [owner.address], { ...lz, constructorArgs: [await spokeEp.getAddress()] });

  await hubEp.setDestLzEndpoint(await spokeShare.getAddress(), await spokeEp.getAddress());
  await spokeEp.setDestLzEndpoint(await adapter.getAddress(), await hubEp.getAddress());
  await adapter.setPeer(SPOKE, ethers.zeroPadValue(await spokeShare.getAddress(), 32));
  await spokeShare.setPeer(HUB, ethers.zeroPadValue(await adapter.getAddress(), 32));
  for (const [oft, dst] of [[adapter, SPOKE], [spokeShare, HUB]] as const) {
    await oft.setEnforcedOptions([
      { eid: dst, msgType: MSG_SEND, options: lzReceiveOption(80_000n) },
      { eid: dst, msgType: MSG_SEND_AND_CALL, options: lzReceiveOption(80_000n) },
    ]);
  }
  await harbor.setShareOFT(await adapter.getAddress());

  // hand the seeded Tide Pool to Harbor: defund, then deposit as its first LP
  const seed = usd(1_000);
  await ch.defundPool(seed, owner.address);
  await ch.setHarbor(await harbor.getAddress());
  await hubUsd.approve(await harbor.getAddress(), seed);
  await harbor.deposit(seed, owner.address);

  const endpoint = await networkHelpers.impersonateAccount(await hubEp.getAddress()).then(() => ethers.getSigner(hubEp.target as string));
  await networkHelpers.setBalance(await hubEp.getAddress(), 10n * E18);
  return { ...ctx, harbor, adapter, spokeShare, endpoint };
}

const composed = (nonce: number, src: number, amount: bigint, from: string, inner: string) =>
  ethers.solidityPacked(["uint64", "uint32", "uint256", "bytes32", "bytes"], [nonce, src, amount, ethers.zeroPadValue(from, 32), inner]);
const harborMsg = (receiver: string, dstEid: number, minOut: bigint) =>
  ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint32", "uint256"], [receiver, dstEid, minOut]);

describe("OmnitideHarbor (OVault)", () => {
  it("takes over the Tide Pool 1:1 and closes owner defunding", async () => {
    const { harbor, ch, owner, alice } = await networkHelpers.loadFixture(harborFixture);
    expect(await harbor.totalAssets()).to.equal(usd(1_000));
    expect(await harbor.balanceOf(owner.address)).to.equal(usd(1_000));
    expect(await harbor.decimals()).to.equal(6);
    await expect(ch.defundPool(1, owner.address)).to.be.revertedWithCustomError(ch, "HarborActive");
    await expect(ch.connect(alice).drawPool(1, alice.address)).to.be.revertedWithCustomError(ch, "NotHarbor");
    await expect(ch.connect(alice).setHarbor(alice.address)).to.be.revertedWithCustomError(ch, "OwnableUnauthorizedAccount");
  });

  it("earns trading fees for depositors and pays them out on redeem", async () => {
    const ctx = await networkHelpers.loadFixture(harborFixture);
    const { harbor, ch, hubUsd, alice, bob } = ctx;
    await hubUsd.connect(bob).drip();
    await hubUsd.connect(bob).approve(await harbor.getAddress(), usd(500));
    await harbor.connect(bob).deposit(usd(500), bob.address);
    expect(await harbor.balanceOf(bob.address)).to.equal(usd(500));

    await depositLocal(ctx, alice, usd(1_000));
    const size = E18 / 10n;
    await ch.connect(alice).trade(0, size, 60_100n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    await ch.connect(alice).trade(0, -size, 0, [await report(ctx, BTC, 60_000n * E18)]);
    // 12 tdUSD of fees went to the pool: 1,500 → 1,512
    expect(await harbor.totalAssets()).to.equal(usd(1_512));
    const out = await harbor.previewRedeem(usd(500));
    expect(out).to.be.greaterThan(usd(503));
    const before = await hubUsd.balanceOf(bob.address);
    await harbor.connect(bob).redeem(usd(500), bob.address, bob.address);
    expect((await hubUsd.balanceOf(bob.address)) - before).to.equal(out);
  });

  it("keeps open trader profit in the pool when LPs exit", async () => {
    const ctx = await networkHelpers.loadFixture(harborFixture);
    const { harbor, ch, owner, alice, bob } = ctx;
    await depositLocal(ctx, alice, usd(1_000));
    await depositLocal(ctx, bob, usd(1_000));
    const size = E18 / 10n;
    await ch.connect(alice).trade(0, size, 60_100n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    await ch.connect(bob).trade(0, -size / 2n, 0, [await report(ctx, BTC, 60_000n * E18)]);
    expect(await ch.traderPnl()).to.equal(0);
    const pool = BigInt(await ch.poolBalance());

    // BTC +3,000: alice +300, bob −150 → traders net +150 owed by the pool
    await ch.markPrices([await report(ctx, BTC, 63_000n * E18)]);
    expect(await ch.markPrice(0)).to.equal(63_000n * E18);
    expect(await ch.traderPnl()).to.equal(usd(150));
    expect(await harbor.totalAssets()).to.equal(pool - usd(150));

    // the whole LP book exits; the 150 stays for the traders
    await harbor.redeem(await harbor.balanceOf(owner.address), owner.address, owner.address);
    expect(BigInt(await ch.poolBalance())).to.equal(usd(150));
    await expect(harbor.withdraw(1, owner.address, owner.address)).to.be.revertedWithCustomError(harbor, "ERC4626ExceededMaxWithdraw");

    const before = await ch.balances(alice.address);
    await ch.connect(alice).trade(0, -size, 0, [await report(ctx, BTC, 63_000n * E18)]);
    expect((await ch.balances(alice.address)) - before).to.equal(usd(300) - 6_300_000n);
    await ch.connect(bob).trade(0, size / 2n, 70_000n * E18, [await report(ctx, BTC, 63_000n * E18)]);
    expect(await ch.costBasis(0)).to.equal(0);
    expect(await ch.traderPnl()).to.equal(0);
    expect(BigInt(await ch.poolBalance())).to.be.greaterThan(0n);
  });

  it("syncs a market's cost basis only from a complete position list", async () => {
    const ctx = await networkHelpers.loadFixture(harborFixture);
    const { ch, alice, bob, owner } = ctx;
    await depositLocal(ctx, alice, usd(1_000));
    await depositLocal(ctx, bob, usd(1_000));
    await ch.connect(alice).trade(0, E18 / 10n, 60_100n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    await ch.connect(bob).trade(0, -E18 / 20n, 0, [await report(ctx, BTC, 61_000n * E18)]);
    const basis = await ch.costBasis(0);
    await expect(ch.syncCostBasis(0, [alice.address])).to.be.revertedWithCustomError(ch, "IncompleteSync");
    await expect(ch.connect(alice).syncCostBasis(0, [alice.address, bob.address])).to.be.revertedWithCustomError(ch, "OwnableUnauthorizedAccount");
    await ch.syncCostBasis(0, [alice.address, bob.address, owner.address]);
    expect(await ch.costBasis(0)).to.equal(basis);
  });

  it("pause stops deposits but never redemptions", async () => {
    const { harbor, hubUsd, guardian, owner } = await networkHelpers.loadFixture(harborFixture);
    await harbor.connect(guardian).pause();
    expect(await harbor.maxDeposit(owner.address)).to.equal(0);
    await hubUsd.approve(await harbor.getAddress(), 1);
    await expect(harbor.deposit(1, owner.address)).to.be.revertedWithCustomError(harbor, "ERC4626ExceededMaxDeposit");
    await harbor.redeem(usd(10), owner.address, owner.address);
  });

  it("deposits tdUSD from a spoke and ships the shares back to that spoke", async () => {
    const { harbor, adapter, spokeShare, hubUsd, spokeUsd, endpoint, alice } = await networkHelpers.loadFixture(harborFixture);
    await spokeUsd.connect(alice).drip();
    const inner = harborMsg(alice.address, SPOKE, usd(200));
    const p = { dstEid: HUB, to: ethers.zeroPadValue(await harbor.getAddress(), 32), amountLD: usd(200), minAmountLD: usd(200), extraOptions: "0x", composeMsg: inner, oftCmd: "0x" };
    const q = await spokeUsd.quoteSend(p, false);
    await spokeUsd.connect(alice).send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, alice.address, { value: q.nativeFee });
    expect(await hubUsd.balanceOf(await harbor.getAddress())).to.equal(usd(200));

    const back = await adapter.quoteSend({ dstEid: SPOKE, to: ethers.zeroPadValue(alice.address, 32), amountLD: usd(200), minAmountLD: usd(200), extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" }, false);
    await expect(harbor.lzCompose(await hubUsd.getAddress(), ethers.id("g"), composed(1, SPOKE, usd(200), alice.address, inner), alice.address, "0x"))
      .to.be.revertedWithCustomError(harbor, "NotEndpoint");
    await expect(harbor.connect(endpoint).lzCompose(await hubUsd.getAddress(), ethers.id("g"), composed(1, SPOKE, usd(200), alice.address, inner), alice.address, "0x", { value: back.nativeFee }))
      .to.emit(harbor, "Composed").withArgs(ethers.id("g"), SPOKE, alice.address, SPOKE, true, usd(200), usd(200), true);
    expect(await spokeShare.balanceOf(alice.address)).to.equal(usd(200));
    expect(await harbor.balanceOf(await adapter.getAddress())).to.equal(usd(200));
    expect(await harbor.totalAssets()).to.equal(usd(1_200));
  });

  it("hands the deposit back on the hub when the return leg is unpaid or slips", async () => {
    const { harbor, hubUsd, spokeUsd, endpoint, alice } = await networkHelpers.loadFixture(harborFixture);
    await spokeUsd.connect(alice).drip();
    const inner = harborMsg(alice.address, SPOKE, usd(200));
    const p = { dstEid: HUB, to: ethers.zeroPadValue(await harbor.getAddress(), 32), amountLD: usd(200), minAmountLD: usd(200), extraOptions: "0x", composeMsg: inner, oftCmd: "0x" };
    const q = await spokeUsd.quoteSend(p, false);
    await spokeUsd.connect(alice).send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, alice.address, { value: q.nativeFee });
    await expect(harbor.connect(endpoint).lzCompose(await hubUsd.getAddress(), ethers.id("g"), composed(1, SPOKE, usd(200), alice.address, inner), alice.address, "0x"))
      .to.emit(harbor, "Composed").withArgs(ethers.id("g"), SPOKE, alice.address, HUB, true, usd(200), 0, false);
    expect(await hubUsd.balanceOf(alice.address)).to.equal(usd(200));
    expect(await harbor.totalAssets()).to.equal(usd(1_000));
    await expect(harbor.connect(endpoint).lzCompose(alice.address, ethers.id("g"), composed(1, SPOKE, 1n, alice.address, inner), alice.address, "0x"))
      .to.be.revertedWithCustomError(harbor, "UnknownSource");
  });

  it("redeems shares arriving from a spoke and sends tdUSD to the chosen chain", async () => {
    const { harbor, adapter, spokeShare, hubUsd, spokeUsd, endpoint, owner, alice } = await networkHelpers.loadFixture(harborFixture);
    // owner moves 300 shares to alice on the spoke
    await harbor.approve(await adapter.getAddress(), usd(300));
    const out = { dstEid: SPOKE, to: ethers.zeroPadValue(alice.address, 32), amountLD: usd(300), minAmountLD: usd(300), extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const qo = await adapter.quoteSend(out, false);
    await adapter.send(out, { nativeFee: qo.nativeFee, lzTokenFee: 0n }, owner.address, { value: qo.nativeFee });
    expect(await spokeShare.balanceOf(alice.address)).to.equal(usd(300));

    const inner = harborMsg(alice.address, SPOKE, usd(300));
    const home = { dstEid: HUB, to: ethers.zeroPadValue(await harbor.getAddress(), 32), amountLD: usd(300), minAmountLD: usd(300), extraOptions: "0x", composeMsg: inner, oftCmd: "0x" };
    const qh = await spokeShare.quoteSend(home, false);
    await spokeShare.connect(alice).send(home, { nativeFee: qh.nativeFee, lzTokenFee: 0n }, alice.address, { value: qh.nativeFee });
    expect(await harbor.balanceOf(await harbor.getAddress())).to.equal(usd(300));

    const fee = await hubUsd.quoteSend({ ...out, amountLD: usd(300), minAmountLD: usd(300) }, false);
    await expect(harbor.connect(endpoint).lzCompose(await adapter.getAddress(), ethers.id("r"), composed(2, SPOKE, usd(300), alice.address, inner), alice.address, "0x", { value: fee.nativeFee }))
      .to.emit(harbor, "Composed").withArgs(ethers.id("r"), SPOKE, alice.address, SPOKE, false, usd(300), usd(300), true);
    expect(await spokeUsd.balanceOf(alice.address)).to.equal(usd(300));
    expect(await harbor.totalSupply()).to.equal(usd(700));
    expect(await harbor.totalAssets()).to.equal(usd(700));
  });

  it("upgrades in place and locks its implementation", async () => {
    const { harbor, alice } = await networkHelpers.loadFixture(harborFixture);
    const impl = await up.erc1967.getImplementationAddress(await harbor.getAddress());
    const h = await ethers.getContractAt("OmnitideHarbor", impl);
    await expect(h.initialize(alice.address, alice.address, alice.address)).to.be.revertedWithCustomError(h, "InvalidInitialization");
    await expect(harbor.connect(alice).upgradeToAndCall(impl, "0x")).to.be.revertedWithCustomError(harbor, "OwnableUnauthorizedAccount");
  });
});

describe("OmnitideTideReader (lzRead)", () => {
  const READ_CHANNEL = 4294967295;
  async function readerFixture() {
    const ctx = await deploy();
    const targets = [
      { eid: SPOKE, token: await ctx.spokeUsd.getAddress() },
      { eid: HUB, token: await ctx.hubUsd.getAddress() },
    ];
    const reader = await up.deployProxy(await ethers.getContractFactory("OmnitideTideReader"), [ctx.owner.address, targets], {
      kind: "uups",
      initializer: "initialize",
      constructorArgs: [await ctx.hubEp.getAddress()],
      unsafeAllow: [...OFT_UNSAFE_ALLOW],
    });
    const endpoint = await networkHelpers.impersonateAccount(await ctx.hubEp.getAddress()).then(() => ethers.getSigner(ctx.hubEp.target as string));
    await networkHelpers.setBalance(await ctx.hubEp.getAddress(), E18);
    return { ...ctx, reader, endpoint, targets };
  }

  it("encodes one totalSupply request per target", async () => {
    const { reader, targets } = await networkHelpers.loadFixture(readerFixture);
    const cmd = await reader.command(1_700_000_000);
    // header: version 1, label 1, 2 requests; then per request 1+2+2+2 bytes + 35 + 4 calldata
    expect(cmd.slice(0, 14)).to.equal("0x000100010002");
    expect((cmd.length - 2) / 2).to.equal(6 + 2 * (7 + 39));
    expect(cmd.toLowerCase()).to.contain(targets[0]!.token.slice(2).toLowerCase());
    expect(await reader.peers(READ_CHANNEL)).to.equal(ethers.zeroPadValue(await reader.getAddress(), 32));
  });

  it("stores DVN-verified supplies from the read channel only", async () => {
    const { reader, endpoint, alice } = await networkHelpers.loadFixture(readerFixture);
    const self = ethers.zeroPadValue(await reader.getAddress(), 32);
    const payload = ethers.solidityPacked(["uint256", "uint256"], [usd(900), usd(250_000)]);
    await expect(reader.connect(endpoint).lzReceive({ srcEid: READ_CHANNEL, sender: self, nonce: 1 }, ethers.id("q"), payload, alice.address, "0x"))
      .to.emit(reader, "TideRead");
    expect((await reader.readings(SPOKE)).supply).to.equal(usd(900));
    expect((await reader.readings(HUB)).supply).to.equal(usd(250_000));
    await expect(reader.connect(endpoint).lzReceive({ srcEid: READ_CHANNEL, sender: self, nonce: 2 }, ethers.id("q2"), "0x01", alice.address, "0x"))
      .to.be.revertedWithCustomError(reader, "BadResponse");
    await expect(reader.connect(endpoint).lzReceive({ srcEid: SPOKE, sender: self, nonce: 1 }, ethers.id("q3"), payload, alice.address, "0x"))
      .to.be.revertedWithCustomError(reader, "NoPeer");
    await expect(reader.connect(alice).setTargets([])).to.be.revertedWithCustomError(reader, "OwnableUnauthorizedAccount");
  });
});

// ───────────────────────── V3 Deep Water ─────────────────────────

const abi = ethers.AbiCoder.defaultAbiCoder();
const lzOpts = { kind: "uups" as const, initializer: "initialize", unsafeAllow: [...OFT_UNSAFE_ALLOW] };

/** Deploys one OApp on the hub and one on the spoke, peered, with enforced receive gas for every msgType. */
async function oappPair(ctx: Ctx, name: string, hubArgs: unknown[], spokeArgs: unknown[], msgTypes: number[] = [1]) {
  const F = await ethers.getContractFactory(name);
  // OApps share the OFT's peer and enforced-option surface, so the OmnitideUSD ABI wires any of them
  const hub = await ethers.getContractAt("OmnitideUSD", await (await up.deployProxy(F, hubArgs, { ...lzOpts, constructorArgs: [await ctx.hubEp.getAddress()] })).getAddress());
  const spoke = await ethers.getContractAt("OmnitideUSD", await (await up.deployProxy(F, spokeArgs, { ...lzOpts, constructorArgs: [await ctx.spokeEp.getAddress()] })).getAddress());
  await ctx.hubEp.setDestLzEndpoint(await spoke.getAddress(), await ctx.spokeEp.getAddress());
  await ctx.spokeEp.setDestLzEndpoint(await hub.getAddress(), await ctx.hubEp.getAddress());
  await hub.setPeer(SPOKE, ethers.zeroPadValue(await spoke.getAddress(), 32));
  await spoke.setPeer(HUB, ethers.zeroPadValue(await hub.getAddress(), 32));
  for (const [app, dst] of [[hub, SPOKE], [spoke, HUB]] as const)
    await app.setEnforcedOptions(msgTypes.map((msgType) => ({ eid: dst, msgType, options: lzReceiveOption(200_000n) })));
  return { hub: await hub.getAddress(), spoke: await spoke.getAddress() };
}

describe("Sealed Orders", () => {
  const SL = 1;
  const seal = (account: string, marketId: number, kind: number, size: bigint, trigger: bigint, salt: string) =>
    ethers.keccak256(abi.encode(["address", "uint8", "uint8", "int256", "uint256", "bytes32"], [account, marketId, kind, size, trigger, salt]));

  it("keeps the level hidden until a valid reveal fires it, reduce-only", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice, bob, keeper } = ctx;
    await depositLocal(ctx, alice, usd(1_000));
    await ch.connect(alice).trade(0, E18 / 10n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    const salt = ethers.id("salt");
    const commitment = seal(alice.address, 0, SL, -E18, 58_000n * E18, salt); // oversized: clamps to the open 0.1
    await expect(ch.connect(alice).placeSealedOrder(commitment, "0xc1f3e5")).to.emit(ch, "SealedOrderPlaced").withArgs(0, alice.address, commitment, "0xc1f3e5");
    expect(await ch.openOrderCount(alice.address)).to.equal(1);
    await expect(ch.connect(bob).cancelSealedOrder(0)).to.be.revertedWithCustomError(ch, "NotOrderOwner");

    const at = async (p: bigint) => [await report(ctx, BTC, p)];
    await expect(ch.connect(keeper).executeSealedOrder(0, 0, SL, -E18, 57_000n * E18, salt, await at(57_000n * E18))).to.be.revertedWithCustomError(ch, "BadReveal");
    await expect(ch.connect(keeper).executeSealedOrder(0, 0, SL, -E18, 58_000n * E18, salt, await at(59_000n * E18))).to.be.revertedWithCustomError(ch, "TriggerNotMet");
    await expect(ch.connect(keeper).executeSealedOrder(0, 0, SL, -E18, 58_000n * E18, salt, await at(57_900n * E18))).to.emit(ch, "SealedOrderExecuted");
    expect((await ch.positions(alice.address, 0)).size).to.equal(0);
    expect(await ch.openOrderCount(alice.address)).to.equal(0);
    await expect(ch.connect(keeper).executeSealedOrder(0, 0, SL, -E18, 58_000n * E18, salt, await at(57_900n * E18))).to.be.revertedWithCustomError(ch, "OrderNotActive");
  });

  it("refuses sealed limit orders and lets the owner cancel", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice, keeper } = ctx;
    const salt = ethers.id("s");
    await ch.connect(alice).placeSealedOrder(seal(alice.address, 0, 0, E18, 50_000n * E18, salt), "0x");
    await expect(ch.connect(keeper).executeSealedOrder(0, 0, 0, E18, 50_000n * E18, salt, [await report(ctx, BTC, 49_000n * E18)])).to.be.revertedWithCustomError(ch, "LimitNotSealable");
    await expect(ch.connect(alice).cancelSealedOrder(0)).to.emit(ch, "SealedOrderCancelled");
    await expect(ch.connect(alice).placeSealedOrder(ethers.ZeroHash, "0x")).to.be.revertedWithCustomError(ch, "ZeroAmount");
  });
});

describe("OmnitideDeepPool (Deep Mode)", () => {
  async function deepFixture() {
    const ctx = await deploy();
    const { owner, keeper, guardian, ch } = ctx;
    const pool = await up.deployProxy(await ethers.getContractFactory("OmnitideDeepPool"), [owner.address, keeper.address, guardian.address, await ch.getAddress()], { kind: "uups", initializer: "initialize" });
    const salt = ethers.id("alice-deep");
    const id = await pool.deepId(ctx.alice.address, salt);
    const endpoint = await networkHelpers.impersonateAccount(await ctx.hubEp.getAddress()).then(() => ethers.getSigner(ctx.hubEp.target as string));
    await networkHelpers.setBalance(await ctx.hubEp.getAddress(), E18);
    return { ...ctx, pool, salt, id, endpoint };
  }
  type D = Awaited<ReturnType<typeof deepFixture>>;
  const commit = (id: string, nonce: number, collateral: bigint, flat: boolean, detail: string) =>
    ethers.keccak256(abi.encode(["bytes32", "uint64", "uint256", "bool", "bytes32"], [id, nonce, collateral, flat, detail]));
  async function signWithdrawal(ctx: D, w: { owner: string; salt: string; amount: bigint; dstEid: number; receiver: string; deadline: number }, signer: Signer = ctx.alice) {
    const domain = { name: "OMNITIDE Deep Pool", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.pool.getAddress() };
    const types = { DeepWithdrawal: [{ name: "salt", type: "bytes32" }, { name: "amount", type: "uint256" }, { name: "dstEid", type: "uint32" }, { name: "receiver", type: "address" }, { name: "deadline", type: "uint64" }] };
    return signer.signTypedData(domain, types, w);
  }

  it("pools deposits under a hashed id, trades without one, and seals books in batches", async () => {
    const ctx = await networkHelpers.loadFixture(deepFixture);
    const { pool, ch, hubUsd, alice, keeper, id } = ctx;
    await hubUsd.connect(alice).drip();
    await hubUsd.connect(alice).approve(await pool.getAddress(), usd(500));
    await expect(pool.connect(alice).deposit(id, usd(500))).to.emit(pool, "DeepDeposit").withArgs(id, usd(500), HUB, ethers.ZeroHash);
    expect(await ch.balances(await pool.getAddress())).to.equal(usd(500));

    await expect(pool.connect(alice).trade(0, E18 / 100n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)])).to.be.revertedWithCustomError(pool, "NotOperator");
    await pool.connect(keeper).trade(0, E18 / 100n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    expect((await ch.positions(await pool.getAddress(), 0)).size).to.equal(E18 / 100n);

    const c = commit(id, 1, usd(499), false, ethers.id("detail"));
    await expect(pool.connect(keeper).seal([id], [c], ["0xabcd"])).to.emit(pool, "Sealed").withArgs(id, 1, c, "0xabcd");
    await expect(pool.connect(keeper).seal([id], [], [])).to.be.revertedWithCustomError(pool, "LengthMismatch");
  });

  it("credits a private Inflow from a spoke to the Deep id only", async () => {
    const ctx = await networkHelpers.loadFixture(deepFixture);
    const { pool, hubUsd, owner, endpoint, alice, id } = ctx;
    await hubUsd.faucetMint(await pool.getAddress(), usd(300)); // the OFT credit that precedes compose
    const msg = composed(1, SPOKE, usd(300), alice.address, abi.encode(["bytes32"], [id]));
    await expect(pool.connect(alice).lzCompose(await hubUsd.getAddress(), ethers.id("g"), msg, alice.address, "0x")).to.be.revertedWithCustomError(pool, "NotEndpoint");
    await expect(pool.connect(endpoint).lzCompose(await hubUsd.getAddress(), ethers.id("g"), msg, alice.address, "0x"))
      .to.emit(pool, "DeepDeposit").withArgs(id, usd(300), SPOKE, ethers.id("g"));
  });

  it("pays out only on the owner's signature, once", async () => {
    const ctx = await networkHelpers.loadFixture(deepFixture);
    const { pool, hubUsd, alice, bob, keeper, id, salt } = ctx;
    await hubUsd.connect(alice).drip();
    await hubUsd.connect(alice).approve(await pool.getAddress(), usd(500));
    await pool.connect(alice).deposit(id, usd(500));
    const deadline = (await networkHelpers.time.latest()) + 600;
    const w = { owner: alice.address, salt, amount: usd(200), dstEid: HUB, receiver: bob.address, deadline };
    const forged = await signWithdrawal(ctx, w, bob);
    const c = commit(id, 1, usd(300), true, ethers.ZeroHash);
    await expect(pool.connect(keeper).withdraw(w, forged, [], c, "0x")).to.be.revertedWithCustomError(pool, "BadSignature");
    const sig = await signWithdrawal(ctx, w);
    await expect(pool.connect(alice).withdraw(w, sig, [], c, "0x")).to.be.revertedWithCustomError(pool, "NotOperator");
    await expect(pool.connect(keeper).withdraw(w, sig, [], c, "0x")).to.emit(pool, "DeepWithdraw").withArgs(id, usd(200), HUB, bob.address, ethers.ZeroHash);
    expect(await hubUsd.balanceOf(bob.address)).to.equal(usd(200));
    await expect(pool.connect(keeper).withdraw(w, sig, [], c, "0x")).to.be.revertedWithCustomError(pool, "Replayed");
  });

  it("lets a flat book exit without the keeper after the delay unless a newer seal lands", async () => {
    const ctx = await networkHelpers.loadFixture(deepFixture);
    const { pool, hubUsd, alice, keeper, id, salt } = ctx;
    await hubUsd.connect(alice).drip();
    await hubUsd.connect(alice).approve(await pool.getAddress(), usd(500));
    await pool.connect(alice).deposit(id, usd(500));
    await pool.connect(keeper).seal([id], [commit(id, 1, usd(500), true, ethers.ZeroHash)], ["0x"]);
    await expect(pool.connect(alice).requestExit(salt, usd(900), ethers.ZeroHash)).to.be.revertedWithCustomError(pool, "BadPreimage");
    await pool.connect(alice).requestExit(salt, usd(500), ethers.ZeroHash);
    await expect(pool.exit(id, [])).to.be.revertedWithCustomError(pool, "ExitNotReady");
    await networkHelpers.time.increase(86_400);
    const before = await hubUsd.balanceOf(alice.address);
    await expect(pool.exit(id, [])).to.emit(pool, "Exited").withArgs(id, usd(500), alice.address);
    expect((await hubUsd.balanceOf(alice.address)) - before).to.equal(usd(500));

    // a newer seal cancels a pending exit
    await hubUsd.connect(alice).approve(await pool.getAddress(), usd(100));
    await pool.connect(alice).deposit(id, usd(100));
    await pool.connect(keeper).seal([id], [commit(id, 3, usd(100), true, ethers.ZeroHash)], ["0x"]);
    await pool.connect(alice).requestExit(salt, usd(100), ethers.ZeroHash);
    await pool.connect(keeper).seal([id], [commit(id, 4, usd(100), true, ethers.ZeroHash)], ["0x"]);
    await networkHelpers.time.increase(86_400);
    await expect(pool.exit(id, [])).to.be.revertedWithCustomError(pool, "ExitNotReady");
  });
});

describe("OmnitideLighthouse", () => {
  async function lighthouseFixture() {
    const ctx = await deploy();
    const a = await oappPair(ctx, "OmnitideLighthouse", [ctx.owner.address, ctx.keeper.address], [ctx.owner.address, ctx.keeper.address]);
    return { ...ctx, hub: await ethers.getContractAt("OmnitideLighthouse", a.hub), spoke: await ethers.getContractAt("OmnitideLighthouse", a.spoke) };
  }

  it("lights an attested Book Score here and on the spoke, newest only", async () => {
    const ctx = await networkHelpers.loadFixture(lighthouseFixture);
    const { hub, spoke, keeper, alice, bob } = ctx;
    const now = await networkHelpers.time.latest();
    const beam = { account: alice.address, score: 91, grade: 0, issuedAt: now, expiry: now + 7 * 86_400 };
    const domain = { name: "OMNITIDE Lighthouse", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await hub.getAddress() };
    const types = { Beam: [{ name: "account", type: "address" }, { name: "score", type: "uint8" }, { name: "grade", type: "uint8" }, { name: "issuedAt", type: "uint64" }, { name: "expiry", type: "uint64" }] };
    const forged = await bob.signTypedData(domain, types, beam);
    await expect(hub.connect(alice).shine(beam, forged, [SPOKE])).to.be.revertedWithCustomError(hub, "BadAttestation");
    const sig = await keeper.signTypedData(domain, types, beam);
    const fee = await hub.quoteShine(beam, [SPOKE]);
    await expect(hub.connect(alice).shine(beam, sig, [SPOKE], { value: fee - 1n })).to.be.revertedWithCustomError(hub, "FeeTooLow");
    await expect(hub.connect(alice).shine(beam, sig, [SPOKE], { value: fee })).to.emit(spoke, "BeamLit").withArgs(alice.address, 91, 0, now, now + 7 * 86_400, HUB);
    expect((await spoke.scoreOf(alice.address)).live).to.equal(true);
    expect((await hub.scoreOf(alice.address)).score).to.equal(91);
    await expect(hub.connect(alice).shine(beam, sig, [])).to.be.revertedWithCustomError(hub, "Stale");
  });
});

describe("OmnitideBadge (Arena, ONFT)", () => {
  async function badgeFixture() {
    const ctx = await deploy();
    const a = await oappPair(ctx, "OmnitideBadge", [ctx.owner.address, ctx.keeper.address, true, "https://x/b/"], [ctx.owner.address, ctx.keeper.address, false, "https://x/b/"]);
    return { ...ctx, hub: await ethers.getContractAt("OmnitideBadge", a.hub), spoke: await ethers.getContractAt("OmnitideBadge", a.spoke) };
  }
  async function claimSig(ctx: Awaited<ReturnType<typeof badgeFixture>>, to: string, kind: number, deadline: number) {
    const domain = { name: "OMNITIDE Arena", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await ctx.hub.getAddress() };
    return ctx.keeper.signTypedData(domain, { Claim: [{ name: "to", type: "address" }, { name: "kind", type: "uint8" }, { name: "deadline", type: "uint64" }] }, { to, kind, deadline });
  }

  it("mints once per kind against an attestation and travels to the spoke", async () => {
    const ctx = await networkHelpers.loadFixture(badgeFixture);
    const { hub, spoke, alice, bob } = ctx;
    const deadline = (await networkHelpers.time.latest()) + 600;
    const sig = await claimSig(ctx, alice.address, 3, deadline);
    await expect(hub.connect(bob).claim(3, deadline, sig)).to.be.revertedWithCustomError(hub, "BadAttestation");
    await expect(hub.connect(alice).claim(3, deadline, sig)).to.emit(hub, "BadgeClaimed").withArgs(alice.address, 1, 3);
    await expect(hub.connect(alice).claim(3, deadline, sig)).to.be.revertedWithCustomError(hub, "AlreadyClaimed");
    await expect(spoke.connect(alice).claim(3, deadline, sig)).to.be.revertedWithCustomError(spoke, "NotHome");
    expect(await hub.tokenURI(1)).to.equal("https://x/b/3/1");

    await expect(hub.connect(bob).send(SPOKE, bob.address, 1)).to.be.revertedWithCustomError(hub, "NotOwner");
    const fee = await hub.quoteSend(SPOKE, alice.address, 1);
    await expect(hub.connect(alice).send(SPOKE, alice.address, 1, { value: fee })).to.emit(spoke, "BadgeReceived").withArgs(alice.address, 1, HUB, 3);
    expect(await spoke.ownerOf(1)).to.equal(alice.address);
    expect(await spoke.kindOf(1)).to.equal(3);
    await expect(hub.ownerOf(1)).to.be.revertedWithCustomError(hub, "ERC721NonexistentToken");
  });
});

describe("OmnitideCouncil (cross-chain governance)", () => {
  async function councilFixture() {
    const ctx = await deploy();
    const t = await oappPair(ctx, "OmnitideToken", [ctx.owner.address, "TIDE", true], [ctx.owner.address, "TIDE", true]);
    const c = await oappPair(ctx, "OmnitideCouncil", [ctx.owner.address, t.hub, HUB, 86_400, 1_000n * E18], [ctx.owner.address, t.spoke, HUB, 86_400, 1_000n * E18], [1, 2]);
    const [hubTide, spokeTide] = await Promise.all([t.hub, t.spoke].map((a) => ethers.getContractAt("OmnitideToken", a)));
    const [hub, spoke] = await Promise.all([c.hub, c.spoke].map((a) => ethers.getContractAt("OmnitideCouncil", a)));
    return { ...ctx, hubTide: hubTide!, spokeTide: spokeTide!, hub: hub!, spoke: spoke! };
  }

  it("tallies hub and spoke stake on the hub, counting only stake older than the proposal", async () => {
    const ctx = await networkHelpers.loadFixture(councilFixture);
    const { hub, spoke, hubTide, spokeTide, alice, bob, owner } = ctx;
    for (const [t, c, who] of [[hubTide, hub, alice], [spokeTide, spoke, bob]] as const) {
      await t.connect(who).drip();
      await t.connect(who).approve(await c.getAddress(), 1_000n * E18);
      await c.connect(who).stake(1_000n * E18);
    }
    await expect(hub.connect(owner).propose("t", "b", [SPOKE])).to.be.revertedWithCustomError(hub, "BelowThreshold");
    await expect(spoke.connect(bob).propose("t", "b", [])).to.be.revertedWithCustomError(spoke, "NotHub");
    await networkHelpers.time.increase(10);
    const fee = await hub.quotePropose([SPOKE]);
    await expect(hub.connect(alice).propose("Raise the BTC cap", "Lift BTC-PERP max OI to 500k", [SPOKE], { value: fee })).to.emit(spoke, "ProposalMirrored");

    await hub.connect(alice).castVote(1, 1);
    const vfee = await spoke.quoteVote(1, 0, bob.address);
    await expect(spoke.connect(bob).castVote(1, 0, { value: vfee })).to.emit(hub, "VoteTallied").withArgs(1, bob.address, 0, 1_000n * E18, SPOKE);
    const p = await hub.proposals(1);
    expect(p.forVotes).to.equal(1_000n * E18);
    expect(p.againstVotes).to.equal(1_000n * E18);
    await expect(hub.connect(alice).castVote(1, 1)).to.be.revertedWithCustomError(hub, "AlreadyVoted");
    await expect(hub.connect(alice).unstake(1n)).to.be.revertedWithCustomError(hub, "Locked");

    // fresh stake after the proposal opened carries no weight
    await hubTide.connect(owner).drip();
    await hubTide.connect(owner).approve(await hub.getAddress(), E18);
    await hub.connect(owner).stake(E18);
    await expect(hub.connect(owner).castVote(1, 1)).to.be.revertedWithCustomError(hub, "NoWeight");

    await networkHelpers.time.increase(86_401);
    await expect(hub.connect(alice).castVote(1, 1)).to.be.revertedWithCustomError(hub, "VotingClosed");
    await hub.connect(alice).unstake(1_000n * E18);
    expect(await hubTide.balanceOf(alice.address)).to.equal(1_000n * E18);
  });
});

describe("OmnitideTokenAdapter ($OMNITIDE mesh)", () => {
  it("locks the launched token on the hub, mints its OFT on a spoke, and the hub Council stakes the original", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { owner, alice, hubEp, spokeEp } = ctx;
    const launched = await (await ethers.getContractFactory("TestStable")).deploy(18);
    await launched.mint(alice.address, 5_000n * E18);
    const adapter = await up.deployProxy(await ethers.getContractFactory("OmnitideTokenAdapter"), [owner.address], { ...lzOpts, constructorArgs: [await launched.getAddress(), await hubEp.getAddress()] });
    const spokeOft = await up.deployProxy(await ethers.getContractFactory("OmnitideToken"), [owner.address, "OMNITIDE", false], { ...lzOpts, constructorArgs: [await spokeEp.getAddress()] });
    const [a, o] = [await adapter.getAddress(), await spokeOft.getAddress()];
    await hubEp.setDestLzEndpoint(o, await spokeEp.getAddress());
    await spokeEp.setDestLzEndpoint(a, await hubEp.getAddress());
    await adapter.setPeer(SPOKE, ethers.zeroPadValue(o, 32));
    await spokeOft.setPeer(HUB, ethers.zeroPadValue(a, 32));
    await adapter.setEnforcedOptions([{ eid: SPOKE, msgType: MSG_SEND, options: lzReceiveOption(200_000n) }]);
    await spokeOft.setEnforcedOptions([{ eid: HUB, msgType: MSG_SEND, options: lzReceiveOption(200_000n) }]);
    expect(await spokeOft.symbol()).to.equal("OMNITIDE");
    await expect(spokeOft.connect(alice).drip()).to.be.revertedWithCustomError(spokeOft, "FaucetClosed");

    await launched.connect(alice).approve(a, 2_000n * E18);
    const p = { dstEid: SPOKE, to: ethers.zeroPadValue(alice.address, 32), amountLD: 2_000n * E18, minAmountLD: 2_000n * E18, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const q = await adapter.quoteSend(p, false);
    await adapter.connect(alice).send(p, { nativeFee: q.nativeFee, lzTokenFee: 0 }, alice.address, { value: q.nativeFee });
    expect(await launched.balanceOf(a)).to.equal(2_000n * E18);
    expect(await spokeOft.balanceOf(alice.address)).to.equal(2_000n * E18);

    const back = { ...p, dstEid: HUB, amountLD: 500n * E18, minAmountLD: 500n * E18 };
    const qb = await spokeOft.quoteSend(back, false);
    await spokeOft.connect(alice).send(back, { nativeFee: qb.nativeFee, lzTokenFee: 0 }, alice.address, { value: qb.nativeFee });
    expect(await launched.balanceOf(alice.address)).to.equal(3_500n * E18);
    expect(await spokeOft.totalSupply()).to.equal(1_500n * E18);

    const council = await up.deployProxy(await ethers.getContractFactory("OmnitideCouncil"), [owner.address, await launched.getAddress(), HUB, 86_400, 1_000n * E18], { ...lzOpts, constructorArgs: [await hubEp.getAddress()] });
    await launched.connect(alice).approve(await council.getAddress(), 1_000n * E18);
    await council.connect(alice).stake(1_000n * E18);
    expect(await council.staked(alice.address)).to.equal(1_000n * E18);
  });
});

describe("Deep pool position cap", () => {
  it("lets only the account the owner names hold more than eight markets, up to the hard ceiling", async () => {
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, owner, alice, bob } = ctx;
    const feeds = Array.from({ length: 10 }, (_, i) => feed(`M${i}`));
    for (let i = 0; i < 10; i++) await ch.setMarket(2 + i, feeds[i]!, 1000, 500, 10n ** 24n, true);
    await expect(ch.connect(alice).setPositionCap(alice.address, 18)).to.be.revertedWithCustomError(ch, "OwnableUnauthorizedAccount");
    await expect(ch.connect(owner).setPositionCap(alice.address, 33)).to.be.revertedWithCustomError(ch, "TooManyPositions");
    await expect(ch.connect(owner).setPositionCap(alice.address, 18)).to.emit(ch, "PositionCapSet").withArgs(alice.address, 18);
    for (const who of [alice, bob]) await depositLocal(ctx, who, usd(1_000));
    const open = async (who: typeof alice, i: number) => {
      const reports = [];
      for (let j = 0; j <= i; j++) reports.push(await report(ctx, feeds[j]!, 10n * E18));
      return ch.connect(who).trade(2 + i, E18, 11n * E18, reports);
    };
    for (let i = 0; i < 8; i++) {
      await open(alice, i);
      await open(bob, i);
    }
    await expect(open(bob, 8)).to.be.revertedWithCustomError(ch, "TooManyPositions");
    await open(alice, 8);
    await open(alice, 9);
    expect((await ch.openMarkets(alice.address)).length).to.equal(10);
  });
});

describe("OmnitideCopyVault", () => {
  async function copyFixture() {
    const ctx = await deploy();
    const impl = await (await ethers.getContractFactory("OmnitideCopyVault")).deploy();
    const factory = await up.deployProxy(await ethers.getContractFactory("OmnitideCopyVaultFactory"), [ctx.owner.address, await ctx.ch.getAddress(), await impl.getAddress(), usd(100)], { kind: "uups", initializer: "initialize" });
    const { alice, hubUsd } = ctx;
    await hubUsd.connect(alice).drip();
    await hubUsd.connect(alice).approve(await factory.getAddress(), usd(500));
    await factory.connect(alice).createVault("Alice Momentum", "cALICE", 0, usd(500), []);
    const vault = await ethers.getContractAt("OmnitideCopyVault", await factory.vaults(0));
    const endpoint = await networkHelpers.impersonateAccount(await ctx.hubEp.getAddress()).then(() => ethers.getSigner(ctx.hubEp.target as string));
    await networkHelpers.setBalance(await ctx.hubEp.getAddress(), E18);
    return { ...ctx, factory, vault, endpoint };
  }

  it("seeds at creation, lets followers ride the leader's PnL and redeem at NAV", async () => {
    const ctx = await networkHelpers.loadFixture(copyFixture);
    const { factory, vault, hubUsd, ch, alice, bob } = ctx;
    await expect(factory.connect(bob).createVault("x", "x", 0, usd(10), [])).to.be.revertedWithCustomError(factory, "SeedTooSmall");
    expect(await vault.leader()).to.equal(alice.address);
    expect(await vault.balanceOf(alice.address)).to.equal(usd(500));

    await hubUsd.connect(bob).drip();
    await hubUsd.connect(bob).approve(await vault.getAddress(), usd(500));
    await vault.connect(bob).deposit(usd(500), bob.address, []);
    expect(await vault.balanceOf(bob.address)).to.equal(usd(500));

    await expect(vault.connect(bob).trade(0, E18 / 10n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)])).to.be.revertedWithCustomError(vault, "NotLeader");
    await vault.connect(alice).trade(0, E18 / 10n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)]); // fee 6
    await vault.connect(alice).trade(0, -E18 / 10n, 0, [await report(ctx, BTC, 62_000n * E18)]); // +200, fee 6.2
    const navNow = await vault.nav([]);
    expect(navNow).to.equal(usd(1_000) + usd(200) - 12_200_000n);
    const before = await hubUsd.balanceOf(bob.address);
    await vault.connect(bob).redeem(usd(500), HUB, bob.address, []);
    expect((await hubUsd.balanceOf(bob.address)) - before).to.equal(navNow / 2n);
    expect(await ch.balances(await vault.getAddress())).to.equal(navNow - navNow / 2n);
  });

  it("queues omnichain deposits and prices them on settle", async () => {
    const ctx = await networkHelpers.loadFixture(copyFixture);
    const { vault, hubUsd, owner, bob, endpoint } = ctx;
    await hubUsd.faucetMint(await vault.getAddress(), usd(250));
    const msg = composed(1, SPOKE, usd(250), bob.address, abi.encode(["address"], [bob.address]));
    await expect(vault.connect(endpoint).lzCompose(await hubUsd.getAddress(), ethers.id("c"), msg, bob.address, "0x")).to.emit(vault, "Queued").withArgs(bob.address, usd(250), SPOKE, ethers.id("c"));
    expect(await vault.pending(bob.address)).to.equal(usd(250));
    await vault.settle([bob.address], []);
    expect(await vault.balanceOf(bob.address)).to.equal(usd(250));
    await expect(vault.settle([bob.address], [])).to.be.revertedWithCustomError(vault, "NothingPending");
  });

  it("pays the leader a cut of gains above the high-water mark, once, in new shares", async () => {
    const ctx = await networkHelpers.loadFixture(copyFixture);
    const { factory, hubUsd, alice, bob } = ctx;
    await hubUsd.connect(bob).drip();
    await hubUsd.connect(bob).approve(await factory.getAddress(), usd(1_000));
    const vaultAbi = await ethers.getContractAt("OmnitideCopyVault", ethers.ZeroAddress);
    await expect(factory.connect(bob).createVault("Too greedy", "cX", 2_001, usd(100), [])).to.be.revertedWithCustomError(vaultAbi, "FeeLocked");
    await factory.connect(bob).createVault("Bob Carry", "cBOB", 1_000, usd(500), []);
    const vault = await ethers.getContractAt("OmnitideCopyVault", await factory.vaults(1));
    expect(await vault.feeBps()).to.equal(1_000);
    expect(await vault.highWaterMark()).to.equal(E18);
    await expect(vault.connect(bob).setFee(1_500)).to.be.revertedWithCustomError(vault, "FeeLocked");
    await expect(vault.connect(alice).setFee(500)).to.be.revertedWithCustomError(vault, "FeeLocked");

    await hubUsd.connect(alice).approve(await vault.getAddress(), usd(500));
    await vault.connect(alice).deposit(usd(500), alice.address, []); // at 1.0, no fee
    expect(await vault.balanceOf(bob.address)).to.equal(usd(500));

    await vault.connect(bob).trade(0, E18 / 10n, 61_000n * E18, [await report(ctx, BTC, 60_000n * E18)]);
    await vault.connect(bob).trade(0, -E18 / 10n, 0, [await report(ctx, BTC, 62_000n * E18)]);
    const value = await vault.nav([]); // 1187.8
    const [feeShares] = await vault.pendingFee(value);
    const gain = ((value * E18) / usd(1_000) - E18) * usd(1_000) / E18; // assets above the mark
    expect(feeShares).to.equal((gain / 10n) * usd(1_000) / (value - gain / 10n));

    const before = await hubUsd.balanceOf(alice.address);
    await expect(vault.connect(alice).redeem(usd(500), HUB, alice.address, [])).to.emit(vault, "FeeCharged");
    expect(await vault.balanceOf(bob.address)).to.equal(usd(500) + feeShares);
    expect((await hubUsd.balanceOf(alice.address)) - before).to.equal((usd(500) * value) / (usd(1_000) + feeShares));
    const [again] = await vault.pendingFee(await vault.nav([]));
    expect(again).to.equal(0n); // same NAV per share: nothing twice

    await vault.connect(bob).setFee(500);
    expect(await vault.feeBps()).to.equal(500);
  });
});

describe("Deep Water crypto (deep.ts)", () => {
  it("round-trips sealed boxes for every recipient, refuses strangers, and matches on-chain hashes", async () => {
    const deep = await import("../deep.js");
    const a = deep.deriveDeepKeys(ethers.hexlify(ethers.randomBytes(65)) as `0x${string}`);
    const keeper = ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;
    const box = deep.seal([a.viewPublic, deep.x25519Public(keeper)], '{"tide":"low"}');
    expect(deep.open(a.viewPrivate, box)).to.equal('{"tide":"low"}');
    expect(deep.open(keeper, box)).to.equal('{"tide":"low"}');
    expect(deep.open(ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`, box)).to.equal(null);
    expect(deep.deriveDeepKeys("0x1234").salt).to.equal(deep.deriveDeepKeys("0x1234").salt);

    const dk = deep.disclosureKey(ethers.id("x") as `0x${string}`, a.viewPrivate);
    expect(deep.parseDisclosureKey(dk)).to.deep.equal({ id: ethers.id("x"), viewPrivate: a.viewPrivate });
    expect(deep.parseDisclosureKey("nope")).to.equal(null);

    const ctx = await networkHelpers.loadFixture(deploy);
    const pool = await up.deployProxy(await ethers.getContractFactory("OmnitideDeepPool"), [ctx.owner.address, ctx.keeper.address, ctx.guardian.address, await ctx.ch.getAddress()], { kind: "uups", initializer: "initialize" });
    expect(await pool.deepId(ctx.alice.address, a.salt)).to.equal(deep.deepId(ctx.alice.address as `0x${string}`, a.salt));

    // a flat book the escape hatch accepts
    const id = (await pool.deepId(ctx.alice.address, a.salt)) as `0x${string}`;
    const book = { id, nonce: 1, collateral: "250000000", positions: [], realized: "0", fees: "0", updatedAt: 1, history: [] };
    await pool.connect(ctx.keeper).seal([id], [deep.deepCommitment(book)], ["0x"]);
    await expect(pool.connect(ctx.alice).requestExit(a.salt, usd(250), deep.detailHash(book))).to.emit(pool, "ExitRequested");
  });
});

describe("Deep ledger parity", () => {
  it("applyFill reproduces the clearinghouse balance, entry and PnL fill by fill", async () => {
    const deep = await import("../deep.js");
    const ctx = await networkHelpers.loadFixture(deploy);
    const { ch, alice } = ctx;
    await depositLocal(ctx, alice, usd(1_000));
    let book = { ...deep.emptyBook(ethers.ZeroHash as `0x${string}`), collateral: usd(1_000).toString() };
    const fills: [bigint, bigint][] = [
      [E18 / 10n, 60_000n * E18],
      [E18 / 20n, 61_234n * E18],
      [-(E18 / 8n), 59_870n * E18],
      [-(E18 / 10n), 60_500n * E18], // flips short
      [E18 / 20n, 58_000n * E18],
    ];
    for (const [delta, price] of fills) {
      await ch.connect(alice).trade(0, delta, delta > 0n ? price : 0n, [await report(ctx, BTC, price)]);
      book = deep.applyFill(book, 0, delta, price, deep.tradeFee(delta, price, 10n), 0).book;
      const [size, entry] = await ch.positions(alice.address, 0);
      expect(book.positions[0]?.size ?? "0").to.equal(size.toString());
      expect(book.positions[0]?.entry ?? "0").to.equal(entry.toString());
      expect(book.collateral).to.equal((await ch.balances(alice.address)).toString());
    }
    const m = deep.bookMargin(book, { 0: 59_000n * E18 }, { 0: { initialMarginBps: 1000, maintenanceMarginBps: 500 } });
    const [equity, im, mm] = await ch.accountMargin(alice.address, [await report(ctx, BTC, 59_000n * E18)]);
    expect([m.equity, m.im, m.mm]).to.deep.equal([equity, im, mm]);
  });
});

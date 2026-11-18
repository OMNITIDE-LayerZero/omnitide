import { network } from "hardhat";
import { CHAINS, type ChainKey } from "../chains.js";
import { lzReceiveAndComposeOption, lzReceiveOption, MSG_SEND, MSG_SEND_AND_CALL } from "../lz-options.js";
import { chainKeyById, deployerSigner, loadDeployments, saveDeployments } from "./lib.js";

const RATE_LIMIT = 100_000n * 10n ** 6n; // tdUSD per pathway per hour
const RECEIVE_GAS = 100_000n;
const COMPOSE_GAS = 300_000n;

const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const { chainId } = await ethers.provider.getNetwork();
const key = chainKeyById(Number(chainId));

const all = loadDeployments();
const local = all[key]?.OmnitideUSD;
if (!local) throw new Error(`OmnitideUSD not deployed on ${key}`);
const usd = await ethers.getContractAt("OmnitideUSD", local.proxy);
const start = await ethers.provider.getBalance(signer.address);

const peers = (Object.keys(CHAINS) as ChainKey[]).filter((k) => k !== key && all[k]?.OmnitideUSD);
const options = [];
for (const peer of peers) {
  const { eid, hub } = CHAINS[peer];
  const want = ethers.zeroPadValue(all[peer]!.OmnitideUSD!.proxy, 32);
  if ((await usd.peers(eid)).toLowerCase() !== want.toLowerCase()) {
    await (await usd.setPeer(eid, want)).wait();
    console.log(`peer ${peer} (${eid})`);
  }
  const [limit] = await usd.rateLimits(eid);
  if (limit !== RATE_LIMIT) await (await usd.setRateLimit(eid, RATE_LIMIT, 3600)).wait();
  options.push({ eid, msgType: MSG_SEND, options: lzReceiveOption(RECEIVE_GAS) });
  // only the hub runs lzCompose (Inflow into the clearinghouse)
  if (hub) options.push({ eid, msgType: MSG_SEND_AND_CALL, options: lzReceiveAndComposeOption(RECEIVE_GAS, COMPOSE_GAS) });
}
if (options.length) await (await usd.setEnforcedOptions(options)).wait();

all[key]!.wired = peers.join(",");
saveDeployments(all);
console.log(`wired ${key} → ${peers.join(", ")} · spent ${ethers.formatEther(start - (await ethers.provider.getBalance(signer.address)))}`);

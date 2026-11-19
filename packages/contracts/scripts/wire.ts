import { network } from "hardhat";
import { CHAINS, type ChainKey } from "../chains.js";
import { lzReceiveAndComposeOption, lzReceiveOption, MSG_SEND, MSG_SEND_AND_CALL } from "../lz-options.js";
import { chainKeyById, deployerSigner, loadDeployments, saveDeployments, type ChainDeployment } from "./lib.js";

const RATE_LIMIT = 100_000n * 10n ** 6n; // tdUSD per pathway per hour
const RECEIVE_GAS = 200_000n; // 100k ran out on the first HyperEVM → Sepolia delivery
const COMPOSE_GAS = 500_000n; // Harbor deposits that ship shares back to a spoke need ~350k

const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const { chainId } = await ethers.provider.getNetwork();
const key = chainKeyById(Number(chainId));
const all = loadDeployments();
const start = await ethers.provider.getBalance(signer.address);

// each mesh is one app spread over chains: tdUSD, Harbor shares (adapter on the hub), TIDE, and the V3 OApps
type Name = "OmnitideUSD" | "OmnitideHarborShareAdapter" | "OmnitideHarborShare" | "OmnitideToken" | "OmnitideLighthouse" | "OmnitideBadge" | "OmnitideCouncil";
interface Mesh {
  name: (k: ChainKey) => Name;
  /** enforced options toward a peer; compose only toward the hub, where lzCompose runs */
  options: (peerIsHub: boolean) => { msgType: number; options: string }[];
}
const plain = (...types: number[]) => () => types.map((msgType) => ({ msgType, options: lzReceiveOption(RECEIVE_GAS) }));
const oft = (peerIsHub: boolean) => [
  { msgType: MSG_SEND, options: lzReceiveOption(RECEIVE_GAS) },
  ...(peerIsHub ? [{ msgType: MSG_SEND_AND_CALL, options: lzReceiveAndComposeOption(RECEIVE_GAS, COMPOSE_GAS) }] : []),
];
const MESHES: Mesh[] = [
  { name: () => "OmnitideUSD", options: oft },
  { name: (k) => (CHAINS[k].hub ? "OmnitideHarborShareAdapter" : "OmnitideHarborShare"), options: oft },
  { name: () => "OmnitideToken", options: plain(MSG_SEND) },
  { name: () => "OmnitideLighthouse", options: plain(1) },
  { name: () => "OmnitideBadge", options: plain(1) },
  { name: () => "OmnitideCouncil", options: plain(1, 2) }, // 1 = proposal mirror, 2 = vote
];
const at = (k: ChainKey, name: Name) => (all[k] as ChainDeployment | undefined)?.[name];

for (const mesh of MESHES) {
  const name = mesh.name(key);
  const local = at(key, name);
  if (!local) continue;
  const app = await ethers.getContractAt("OmnitideUSD", local.proxy); // shared OApp surface: peers, enforced options
  const peers = (Object.keys(CHAINS) as ChainKey[]).filter((k) => k !== key && at(k, mesh.name(k)));
  const options = [];
  for (const peer of peers) {
    const { eid, hub } = CHAINS[peer];
    const want = ethers.zeroPadValue(at(peer, mesh.name(peer))!.proxy, 32);
    if ((await app.peers(eid)).toLowerCase() !== want.toLowerCase()) {
      await (await app.setPeer(eid, want)).wait();
      console.log(`${name}: peer ${peer} (${eid})`);
    }
    if (name === "OmnitideUSD") {
      const [limit] = await app.rateLimits(eid);
      if (limit !== RATE_LIMIT) await (await app.setRateLimit(eid, RATE_LIMIT, 3600)).wait();
    }
    options.push(...mesh.options(!!hub).map((o) => ({ eid, ...o })));
  }
  if (options.length) await (await app.setEnforcedOptions(options)).wait();
  console.log(`wired ${name} on ${key} → ${peers.join(", ") || "none"}`);
  if (name === "OmnitideUSD") all[key]!.wired = peers.join(",");
}

// chains dropped from CHAINS keep their deployment record; close their tdUSD lanes so nothing is sent into them
const usd = await ethers.getContractAt("OmnitideUSD", all[key]!.OmnitideUSD!.proxy);
for (const [k, rec] of Object.entries(all)) {
  if (k in CHAINS || !rec?.eid || (await usd.peers(rec.eid)) === ethers.ZeroHash) continue;
  await (await usd.setPeer(rec.eid, ethers.ZeroHash)).wait();
  console.log(`unpeered ${k} (${rec.eid})`);
}

saveDeployments(all);
console.log(`spent ${ethers.formatEther(start - (await ethers.provider.getBalance(signer.address)))} ${CHAINS[key].nativeSymbol}`);

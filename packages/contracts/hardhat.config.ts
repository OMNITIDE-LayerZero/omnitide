import { configVariable, defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import hardhatUpgrades from "@openzeppelin/hardhat-upgrades";
import { CHAINS } from "./chains.js";

const accounts = [configVariable("DEPLOYER_PRIVATE_KEY")];

export default defineConfig({
  plugins: [hardhatEthers, hardhatEthersChaiMatchers, hardhatMocha, hardhatNetworkHelpers, hardhatVerify, hardhatTypechain, hardhatUpgrades],
  solidity: {
    version: "0.8.28",
    npmFilesToBuild: ["@layerzerolabs/test-devtools-evm-hardhat/contracts/mocks/EndpointV2Mock.sol"],
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    ...Object.fromEntries(
      Object.entries(CHAINS).map(([key, c]) => [
        key,
        {
          type: "http",
          chainType: "generic",
          url: process.env[`RPC_${c.chainId}`] ?? c.rpc,
          accounts,
          chainId: c.chainId,
          // HyperEVM big blocks price far below the small-block gas price the RPC quotes; pin it with GAS_PRICE_999 (wei)
          ...(process.env[`GAS_PRICE_${c.chainId}`] ? { gasPrice: BigInt(process.env[`GAS_PRICE_${c.chainId}`]!) } : {}),
        },
      ]),
    ),
    // dry-run targets: simulate deploys against live chain state before spending gas
    ...Object.fromEntries(
      Object.entries(CHAINS).map(([key, c]) => [
        `${key}Fork`,
        {
          type: "edr-simulated",
          chainType: "generic",
          chainId: c.chainId,
          forking: { url: c.rpc },
          accounts: [{ privateKey: configVariable("DEPLOYER_PRIVATE_KEY"), balance: "100000000000000000000" }],
        },
      ]),
    ),
  },
  chainDescriptors: Object.fromEntries(
    Object.values(CHAINS).map((c) => [
      c.chainId,
      {
        name: c.name,
        // forks of chains Hardhat doesn't know need a hardfork to execute on the fork block
        hardforkHistory: { cancun: { blockNumber: 0 } },
        blockExplorers: {
          ...(c.blockscout ? { blockscout: { name: c.name, url: c.explorer, apiUrl: c.blockscout } } : {}),
          ...(c.etherscanApi ? { etherscan: { name: c.name, url: c.explorer, apiUrl: c.etherscanApi } } : {}),
        },
      },
    ]),
  ),
  // Etherscan-compatible verification is unused (Blockscout + Sourcify); hardhat-verify still wants a key.
  verify: { etherscan: { apiKey: "verifyContract" } },
});

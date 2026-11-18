// LayerZero type-3 executor options, encoded the same way as OptionsBuilder.sol.
const hex = (n: bigint, bytes: number) => n.toString(16).padStart(bytes * 2, "0");

export function lzReceiveOption(gas: bigint): `0x${string}` {
  return `0x0003${"01"}${hex(17n, 2)}${"01"}${hex(gas, 16)}`;
}

export function lzReceiveAndComposeOption(receiveGas: bigint, composeGas: bigint): `0x${string}` {
  return `${lzReceiveOption(receiveGas)}${"01"}${hex(19n, 2)}${"03"}${hex(0n, 2)}${hex(composeGas, 16)}`;
}

export const MSG_SEND = 1;
export const MSG_SEND_AND_CALL = 2;

// LayerZero's upgradeable OApps keep the endpoint immutable and leave empty sub-initializers by design.
export const OFT_UNSAFE_ALLOW = ["constructor", "state-variable-immutable", "missing-initializer-call"] as const;

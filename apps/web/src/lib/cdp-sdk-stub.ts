// wagmi's Base Account connector imports the Coinbase CDP SDK only for subscription payments, which OMNITIDE never uses.
// Aliasing it keeps that SDK (and its optional x402 deps) out of the bundle; any accidental call fails loudly.
export class CdpClient {
  constructor() {
    throw new Error("CDP subscriptions are not available in OMNITIDE");
  }
}

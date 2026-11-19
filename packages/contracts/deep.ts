// Deep Water crypto shared by web and keeper: Deep keys, multi-recipient sealed boxes, and the commitments the contracts check.
import { x25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { bytesToHex, concat, encodeAbiParameters, hexToBytes, keccak256, stringToBytes, toHex, type Address, type Hex } from "viem";

export const DEEP_MESSAGE =
  "OMNITIDE Deep Mode\n\nSign to unlock your Deep key on this device. It derives your private Deep id and view key.\nNo transaction, no gas.";

export interface DeepKeys {
  salt: Hex;
  viewPrivate: Hex;
  viewPublic: Hex;
}

/** Same wallet, same signature, same keys: the Deep id and view key can always be re-derived. */
export function deriveDeepKeys(signature: Hex): DeepKeys {
  const root = keccak256(signature);
  const salt = keccak256(concat([root, toHex("salt")]));
  const viewPrivate = keccak256(concat([root, toHex("view")]));
  return { salt, viewPrivate, viewPublic: bytesToHex(x25519.getPublicKey(hexToBytes(viewPrivate))) };
}

export const x25519Public = (secret: Hex): Hex => bytesToHex(x25519.getPublicKey(hexToBytes(secret)));

export const deepId = (owner: Address, salt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, salt]));

// ───────── sealed boxes: one random content key, wrapped once per recipient ─────────

const VERSION = 2;
const INFO = stringToBytes("omnitide-deep-v1");

function kek(shared: Uint8Array, ephPub: Uint8Array, recipient: Uint8Array) {
  return hkdf(sha256, shared, new Uint8Array([...ephPub, ...recipient]), INFO, 32);
}

/** 0x02 | n | n × (ephPub 32 | iv 12 | wrapped key 48) | iv 12 | ciphertext */
export function seal(recipients: Hex[], plaintext: string): Hex {
  if (recipients.length === 0 || recipients.length > 255) throw new Error("1..255 recipients");
  const key = randomBytes(32);
  const parts: Uint8Array[] = [new Uint8Array([VERSION, recipients.length])];
  for (const r of recipients) {
    const pub = hexToBytes(r);
    const eph = x25519.utils.randomPrivateKey();
    const ephPub = x25519.getPublicKey(eph);
    const iv = randomBytes(12);
    parts.push(ephPub, iv, gcm(kek(x25519.getSharedSecret(eph, pub), ephPub, pub), iv).encrypt(key));
  }
  const iv = randomBytes(12);
  parts.push(iv, gcm(key, iv).encrypt(stringToBytes(plaintext)));
  return bytesToHex(concat(parts));
}

/** Opens a box with any one recipient key; null if this key isn't on it or the box is damaged. */
export function open(secret: Hex, box: Hex): string | null {
  try {
    const b = hexToBytes(box);
    if (b[0] !== VERSION) return null;
    const n = b[1]!;
    const priv = hexToBytes(secret);
    const me = x25519.getPublicKey(priv);
    const body = 2 + n * 92;
    for (let i = 0; i < n; i++) {
      const o = 2 + i * 92;
      const ephPub = b.slice(o, o + 32);
      try {
        const key = gcm(kek(x25519.getSharedSecret(priv, ephPub), ephPub, me), b.slice(o + 32, o + 44)).decrypt(b.slice(o + 44, o + 92));
        return new TextDecoder().decode(gcm(key, b.slice(body, body + 12)).decrypt(b.slice(body + 12)));
      } catch {
        // not this recipient slot
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ───────── Deep books ─────────

export interface DeepPosition {
  marketId: number;
  size: string; // base units, 1e18, signed
  entry: string; // USD, 1e18
}

export interface DeepFill {
  at: number;
  kind: "deposit" | "withdraw" | "trade" | "liquidation";
  amount: string; // tdUSD units for deposit/withdraw, realized PnL for trades
  marketId?: number;
  sizeDelta?: string;
  price?: string;
  fee?: string;
  tx?: string;
}

export interface DeepBook {
  id: Hex;
  nonce: number;
  collateral: string; // tdUSD units (6 dp), never negative
  positions: DeepPosition[];
  realized: string;
  fees: string;
  updatedAt: number;
  history: DeepFill[]; // newest first, capped
}

export const detailHash = (b: DeepBook): Hex =>
  keccak256(stringToBytes(JSON.stringify({ positions: b.positions, realized: b.realized, fees: b.fees, updatedAt: b.updatedAt, history: b.history })));

/** Matches OmnitideDeepPool: keccak256(abi.encode(id, nonce, collateral, flat, detailHash)). */
export const deepCommitment = (b: DeepBook): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint64" }, { type: "uint256" }, { type: "bool" }, { type: "bytes32" }],
      [b.id, BigInt(b.nonce), BigInt(b.collateral), b.positions.length === 0, detailHash(b)],
    ),
  );

/** Disclosure Key: the Deep id plus the view key. Reads the whole book history, can't move a cent. */
export const disclosureKey = (id: Hex, viewPrivate: Hex) => `dk1_${id.slice(2)}${viewPrivate.slice(2)}`;

export function parseDisclosureKey(s: string): { id: Hex; viewPrivate: Hex } | null {
  const m = /^dk1_([0-9a-f]{64})([0-9a-f]{64})$/i.exec(s.trim());
  return m ? { id: `0x${m[1]!.toLowerCase()}`, viewPrivate: `0x${m[2]!.toLowerCase()}` } : null;
}

// ───────── Sealed Orders ─────────

export const ORDER_KIND = { limit: 0, stopLoss: 1, takeProfit: 2 } as const;

export interface SealedOrderPlain {
  marketId: number;
  kind: 1 | 2;
  sizeDelta: string; // 1e18, signed
  triggerPrice: string; // 1e18
  salt: Hex;
}

/** Matches OmnitideClearinghouse: keccak256(abi.encode(account, marketId, kind, sizeDelta, triggerPrice, salt)). */
export const sealedOrderCommitment = (account: Address, o: SealedOrderPlain): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint8" }, { type: "uint8" }, { type: "int256" }, { type: "uint256" }, { type: "bytes32" }],
      [account, o.marketId, o.kind, BigInt(o.sizeDelta), BigInt(o.triggerPrice), o.salt],
    ),
  );

export const randomSalt = (): Hex => bytesToHex(randomBytes(32));

// ───────── EIP-712 types the keeper and contracts share ─────────

export const DEEP_WITHDRAWAL_TYPES = {
  DeepWithdrawal: [
    { name: "salt", type: "bytes32" },
    { name: "amount", type: "uint256" },
    { name: "dstEid", type: "uint32" },
    { name: "receiver", type: "address" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** Off-chain trade intent the keeper executes against the pool. */
export const DEEP_INTENT_TYPES = {
  DeepTrade: [
    { name: "id", type: "bytes32" },
    { name: "marketId", type: "uint8" },
    { name: "sizeDelta", type: "int256" },
    { name: "priceLimit", type: "uint256" },
    { name: "nonce", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
  DeepRegister: [
    { name: "id", type: "bytes32" },
    { name: "salt", type: "bytes32" },
    { name: "viewKey", type: "bytes32" },
  ],
} as const;

export const deepIntentDomain = (chainId: number) => ({ name: "OMNITIDE Deep Mode", version: "1", chainId }) as const;

export const BEAM_TYPES = {
  Beam: [
    { name: "account", type: "address" },
    { name: "score", type: "uint8" },
    { name: "grade", type: "uint8" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export const CLAIM_TYPES = {
  Claim: [
    { name: "to", type: "address" },
    { name: "kind", type: "uint8" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** Arena Badges, in on-chain kind order. */
export const BADGES = [
  { kind: 0, name: "First Fill", line: "Opened a position on OMNITIDE" },
  { kind: 1, name: "Inflow Navigator", line: "Brought collateral in from another chain" },
  { kind: 2, name: "Harbor Master", line: "Moored tdUSD in Harbor" },
  { kind: 3, name: "Grade A Book", line: "Scored an A on Book Rank with positions open" },
  { kind: 4, name: "Storm Rider", line: "Held positions that survive the black swan" },
  { kind: 5, name: "Deep Diver", line: "Opened a Deep Mode book" },
  { kind: 6, name: "Council Voice", line: "Voted in the Council" },
  { kind: 7, name: "Lighthouse Keeper", line: "Shared a Lighthouse Proof across chains" },
] as const;

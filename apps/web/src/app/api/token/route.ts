import { readFile } from "node:fs/promises";
import { parseToken } from "@/lib/token";

export const dynamic = "force-dynamic";

// written on the VPS at launch, outside the app folder so deploys and vps-setup leave it alone
const FILE = process.env.TOKEN_FILE ?? `/opt/omnitide/${process.env.OMNITIDE_ENV ?? "testnet"}/token.json`;
const HIDDEN = (process.env.HOUSE_ACCOUNTS ?? "").split(",").filter(Boolean);

export async function GET() {
  let token = null;
  try {
    token = parseToken(JSON.parse(await readFile(/*turbopackIgnore: true*/ FILE, "utf8")), HIDDEN);
  } catch {
    // no launch file yet: the hero shows nothing
  }
  return Response.json({ token }, { headers: { "cache-control": "no-store" } });
}

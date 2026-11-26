import { ENV } from "@/lib/chains";
import { receipts } from "@/lib/server/receipts";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ env: ENV, receipts: await receipts() }, { headers: { "cache-control": "public, max-age=30" } });
}

import { BADGES } from "@omnitide/contracts/deep";
import { MEDAL_FINISH, badgeSvg } from "@/lib/badge-art";

// tokenURI = baseURI + kind + "/" + id; "/image" on the end serves the artwork itself
export async function GET(req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  const k = Number(kind);
  const tokenId = id.replace(/\.svg$|\/image$/, "");
  if (!Number.isInteger(k) || !BADGES[k] || !/^\d{1,10}$/.test(tokenId)) return Response.json({ error: "unknown badge" }, { status: 404 });
  const url = new URL(req.url);
  // behind the Vercel proxy the request host is the VPS, so links use the public site URL
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  if (url.searchParams.has("image") || id.endsWith(".svg")) {
    return new Response(badgeSvg(k, tokenId), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400, immutable" } });
  }
  const b = BADGES[k];
  return Response.json(
    {
      name: `${b.name} #${tokenId}`,
      description: `${b.line}. An OMNITIDE Arena Badge: minted on Robinhood Chain against a keeper attestation, free to travel as a LayerZero ONFT.`,
      image: `${origin}/api/badge/${k}/${tokenId}.svg`,
      external_url: `${origin}/terminal/arena`,
      attributes: [
        { trait_type: "Badge", value: b.name },
        { trait_type: "Finish", value: MEDAL_FINISH[k] },
        { trait_type: "Kind", value: k, display_type: "number" },
      ],
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}

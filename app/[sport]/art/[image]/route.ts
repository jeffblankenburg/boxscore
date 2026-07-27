import { NextResponse } from "next/server";
import { renderElementPng } from "@/lib/render-images";
import { getArtBoxImageUrl, uploadArtBoxImage } from "@/lib/share-storage";
import { isValidIsoDate } from "@/lib/dates";

// Public box-score art PNG at a clean same-origin path: /mlb/art/<gamePk>.png.
// The image lives in the share-images bucket, but we never expose that URL —
// this route PROXIES the bytes so the address stays on boxscore.email. If the
// image isn't stored yet, it screenshots the card, stores it, and returns the
// bytes. Immutable Cache-Control means Vercel's CDN serves every request after
// the first from the edge (no function, no bucket round-trip).

export const runtime = "nodejs";
export const maxDuration = 60;

const IMMUTABLE = "public, max-age=31536000, immutable";

function pngResponse(body: Buffer | Uint8Array, pk: number): NextResponse {
  return new NextResponse(Buffer.from(body), {
    headers: {
      "content-type": "image/png",
      "content-disposition": `inline; filename="boxscore-${pk}.png"`,
      "cache-control": IMMUTABLE,
    },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ sport: string; image: string }> }) {
  const { sport, image } = await ctx.params;
  if (sport !== "mlb") return NextResponse.json({ error: "not found" }, { status: 404 });
  const m = image.match(/^(\d+)\.png$/);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const pk = Number(m[1]);

  // Already stored → proxy the bytes (bucket URL never leaves the server).
  const existing = await getArtBoxImageUrl(pk);
  if (existing) {
    const r = await fetch(existing);
    if (r.ok) return pngResponse(Buffer.from(await r.arrayBuffer()), pk);
  }

  // Render, store, return. Chrome self-fetches this deployment's raw card.
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const dateQ = date && isValidIsoDate(date) ? `?date=${date}` : "";
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("host") ?? url.host;
  const origin = `${proto}://${host}`;

  try {
    const png = await renderElementPng({ url: `${origin}/${sport}/art/raw/${pk}${dateQ}`, selector: "[data-rb-card]" });
    await uploadArtBoxImage(pk, png);
    return pngResponse(png, pk);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

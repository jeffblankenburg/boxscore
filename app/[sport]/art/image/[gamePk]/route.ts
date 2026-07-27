import { NextResponse } from "next/server";
import { renderElementPng } from "@/lib/render-images";
import { getArtBoxImageUrl, uploadArtBoxImage } from "@/lib/share-storage";
import { isValidIsoDate } from "@/lib/dates";

// Generate-and-store endpoint for a game's box-score art PNG. If the image is
// already in the share-images bucket, redirect to its public URL; otherwise
// screenshot the /mlb/art/raw/[gamePk] card with headless Chrome, upload it to
// the bucket (same blob storage as every other share image), and redirect.
// The page points <img> straight at the bucket URL once it exists, so this
// route only runs on the first view of a game.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ sport: string; gamePk: string }> }) {
  const { sport, gamePk } = await ctx.params;
  if (sport !== "mlb") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!/^\d+$/.test(gamePk)) return NextResponse.json({ error: "bad game id" }, { status: 400 });
  const pk = Number(gamePk);

  // Already stored → serve from the bucket CDN.
  const existing = await getArtBoxImageUrl(pk);
  if (existing) return NextResponse.redirect(existing, 302);

  // Render, store, redirect. Chrome self-fetches this deployment's raw card.
  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const dateQ = date && isValidIsoDate(date) ? `?date=${date}` : "";
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("host") ?? url.host;
  const origin = `${proto}://${host}`;

  try {
    const png = await renderElementPng({ url: `${origin}/${sport}/art/raw/${pk}${dateQ}`, selector: "[data-rb-card]" });
    const publicUrl = await uploadArtBoxImage(pk, png);
    return NextResponse.redirect(publicUrl, 302);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

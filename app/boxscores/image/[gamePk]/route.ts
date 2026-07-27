import { NextResponse } from "next/server";
import { renderElementPng } from "@/lib/render-images";

// On-demand box-score share PNG for any historical game. Screenshots the
// /boxscores/raw/[gamePk] card with headless Chrome and returns image/png.
// Historical games never change, so the response is cached immutably —
// first request per game renders (~seconds), the rest are CDN-served.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ gamePk: string }> }) {
  const { gamePk } = await ctx.params;
  if (!/^\d+$/.test(gamePk)) {
    return NextResponse.json({ error: "bad game id" }, { status: 400 });
  }

  // Chrome self-fetches this deployment's own origin to render the card.
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("host") ?? url.host;
  const origin = `${proto}://${host}`;

  try {
    const png = await renderElementPng({
      url: `${origin}/boxscores/raw/${gamePk}`,
      selector: "[data-rb-card]",
    });
    return new NextResponse(Buffer.from(png), {
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="boxscore-${gamePk}.png"`,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

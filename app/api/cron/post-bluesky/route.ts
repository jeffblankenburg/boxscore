import { NextResponse } from "next/server";
import { isValidIsoDate, prettyDate, yesterdayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost } from "@/lib/social-posts";
import { deleteBlueskyPost, postToBlueskyWithImage } from "@/lib/bluesky";
import { siteOrigin } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase";
import { renderShareImages, type ManifestEntry } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const hashtag = (team: string): string => "#" + team.replace(/\s+/g, "");

function postContent(
  entry: ManifestEntry,
  pretty: string,
  digestUrl: string,
): { text: string; alt: string } {
  if (entry.type === "standings") {
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Standings · ${pretty}\n\n#MLB ${digestUrl}`,
      alt: `${name} Standings for ${pretty}.`,
    };
  }
  if (entry.type === "leaders") {
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Leaders · ${pretty}\n\n#MLB ${digestUrl}`,
      alt: `${name} Leaders as of ${pretty}.`,
    };
  }
  const tags = entry.teams
    .filter((t) => t.length > 0)
    .map(hashtag)
    .join(" ");
  return {
    text: `${entry.title} · ${pretty}\n\n${tags} #MLB ${digestUrl}`.trim(),
    alt: `Box score: ${entry.title} on ${pretty}.`,
  };
}

// Read width/height from PNG header (IHDR chunk). Used so BlueSky renders
// each image at its native aspect ratio instead of letterboxing.
function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const w = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
  const h = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
  return { width: w >>> 0, height: h >>> 0 };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const sport = url.searchParams.get("sport") ?? "mlb";
  const reset = url.searchParams.get("reset") === "1";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  if (reset) {
    const { data: prior, error: priorErr } = await supabaseAdmin()
      .from("social_posts")
      .select("remote_id, sub_id")
      .eq("platform", "bluesky")
      .eq("sport", sport)
      .eq("date", date);
    if (priorErr) {
      return NextResponse.json({ error: `reset query: ${priorErr.message}` }, { status: 500 });
    }
    for (const row of prior ?? []) {
      if (row.remote_id) {
        try { await deleteBlueskyPost(row.remote_id); } catch { /* gone */ }
      }
    }
    const { error: delErr } = await supabaseAdmin()
      .from("social_posts")
      .delete()
      .eq("platform", "bluesky")
      .eq("sport", sport)
      .eq("date", date);
    if (delErr) {
      return NextResponse.json({ error: `reset delete: ${delErr.message}` }, { status: 500 });
    }
  }

  const origin = await siteOrigin();
  const digestUrl = `${origin}/${sport}/${date}`;
  const pretty = prettyDate(date);

  // Render share images in-memory using the same renderer as the local script.
  // On Vercel this uses @sparticuz/chromium-min; locally it uses system Chrome.
  let images: Awaited<ReturnType<typeof renderShareImages>>;
  try {
    images = await renderShareImages({ date, baseUrl: origin });
  } catch (err) {
    return NextResponse.json(
      { error: `render failed: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Mirror to Supabase Storage so the admin gallery shows the latest set.
  // Failure here doesn't block posting; BlueSky uploads use the in-memory PNGs.
  try {
    await uploadShareImages({ date, images });
  } catch (err) {
    console.error(`share-storage upload failed: ${(err as Error).message}`);
  }

  let posted = 0, skipped = 0, failed = 0;
  const results: Array<{ subId: string; url?: string; error?: string }> = [];

  for (const { entry, png } of images) {
    if (await hasAlreadyPosted("bluesky", sport, date, entry.subId)) {
      skipped++;
      results.push({ subId: entry.subId, url: "(already posted)" });
      continue;
    }

    const { text, alt } = postContent(entry, pretty, digestUrl);
    const dims = readPngDimensions(png) ?? undefined;

    try {
      const { uri, url: postUrl } = await postToBlueskyWithImage({
        text, altText: alt, imageBytes: png, aspectRatio: dims,
      });
      await recordPost({
        platform: "bluesky", sport, date, subId: entry.subId,
        remoteId: uri, remoteUrl: postUrl, error: null,
      });
      posted++;
      results.push({ subId: entry.subId, url: postUrl });
      // Pace the posts so the feed reads as a series, not a burst.
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      const msg = (err as Error).message;
      await recordPost({
        platform: "bluesky", sport, date, subId: entry.subId,
        remoteId: null, remoteUrl: null, error: msg,
      });
      failed++;
      results.push({ subId: entry.subId, error: msg });
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    sport, date,
    total: images.length,
    posted, skipped, failed,
    results,
  });
}

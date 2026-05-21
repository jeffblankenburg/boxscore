import { NextResponse } from "next/server";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost } from "@/lib/social-posts";
import { deleteBlueskyPost, postToBlueskyWithImage } from "@/lib/bluesky";
import { EMAIL_LINK_BASE, siteOrigin } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";
import { imagePostContent } from "@/lib/social-content";
import { startCronRun, finishCronRun, summarizeItemErrors } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
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
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const runId = await startCronRun({ route: "post-bluesky", sport, date, trigger });

  try {

  if (reset) {
    const { data: prior, error: priorErr } = await supabaseAdmin()
      .from("social_posts")
      .select("remote_id, sub_id")
      .eq("platform", "bluesky")
      .eq("sport", sport)
      .eq("date", date);
    if (priorErr) throw new Error(`reset query: ${priorErr.message}`);
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
    if (delErr) throw new Error(`reset delete: ${delErr.message}`);
  }

  // Puppeteer's baseUrl needs the reachable host (dev → localhost, prod →
  // boxscore.email, preview → vercel.app); the digestUrl embedded in the
  // public post text always uses the canonical email/social origin.
  const origin = await siteOrigin();
  const digestUrl = `${EMAIL_LINK_BASE}/${sport}/${nextDay(date)}`;
  const pretty = prettyDate(date);

  // Render share images in-memory using the same renderer as the local script.
  // On Vercel this uses @sparticuz/chromium-min; locally it uses system Chrome.
  let images: Awaited<ReturnType<typeof renderShareImages>>;
  try {
    images = await renderShareImages({ date, baseUrl: origin });
  } catch (err) {
    throw new Error(`render failed: ${(err as Error).message}`);
  }

  // Mirror to Supabase Storage so the admin gallery + Twitter compose page
  // can show + serve the latest set. Failure here doesn't block posting —
  // BlueSky uploads use the in-memory PNGs directly.
  try {
    await uploadShareImages({ date, prettyDate: pretty, images });
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

    const { text, alt } = imagePostContent(entry, pretty, digestUrl);
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

    const result = {
      sport, date,
      total: images.length,
      posted, skipped, failed,
    };
    await finishCronRun(runId, {
      status: failed > 0 && posted === 0 ? "failed" : "ok",
      error: summarizeItemErrors(results, images.length),
      result,
    });
    return NextResponse.json({ ok: failed === 0, ...result, results });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

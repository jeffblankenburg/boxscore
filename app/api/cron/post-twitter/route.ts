import { NextResponse } from "next/server";
import { EUploadMimeType } from "twitter-api-v2";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost } from "@/lib/social-posts";
import { deleteTweet, postTweetWithImage } from "@/lib/twitter";
import { siteOrigin } from "@/lib/site";
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

  const runId = await startCronRun({ route: "post-twitter", sport, date, trigger });

  try {
    if (reset) {
      const { data: prior, error: priorErr } = await supabaseAdmin()
        .from("social_posts")
        .select("remote_id, sub_id")
        .eq("platform", "twitter")
        .eq("sport", sport)
        .eq("date", date);
      if (priorErr) throw new Error(`reset query: ${priorErr.message}`);
      for (const row of prior ?? []) {
        if (row.remote_id) {
          try { await deleteTweet(row.remote_id); } catch { /* gone */ }
        }
      }
      const { error: delErr } = await supabaseAdmin()
        .from("social_posts")
        .delete()
        .eq("platform", "twitter")
        .eq("sport", sport)
        .eq("date", date);
      if (delErr) throw new Error(`reset delete: ${delErr.message}`);
    }

    const origin = await siteOrigin();
    const editionDate = nextDay(date);
    const captionDates = {
      edition: prettyDate(editionDate),
      games: prettyDate(date),
    };

    let images: Awaited<ReturnType<typeof renderShareImages>>;
    try {
      images = await renderShareImages({ date, baseUrl: origin });
    } catch (err) {
      throw new Error(`render failed: ${(err as Error).message}`);
    }

    // Mirror to Supabase Storage so the admin gallery + compose pages can
    // serve the latest set. Failure here doesn't block posting. Storage key
    // is the EDITION date — matches og:image and `/mlb/[editionDate]`.
    try {
      await uploadShareImages({ editionDate, images });
    } catch (err) {
      console.error(`share-storage upload failed: ${(err as Error).message}`);
    }

    let posted = 0, skipped = 0, failed = 0;
    const results: Array<{ subId: string; url?: string; error?: string }> = [];

    for (const { entry, png, mime } of images) {
      // Skip the full-day image: it's still generated and stored for the
      // admin gallery, but DPR=1 (forced by chromium-min's tile-at-DPR=2 bug)
      // makes it unreadable on Twitter's feed-fit crop. Per-section images
      // post fine.
      if (entry.type === "full") {
        skipped++;
        results.push({ subId: entry.subId, url: "(skipped: full image disabled)" });
        continue;
      }
      if (await hasAlreadyPosted("twitter", sport, date, entry.subId)) {
        skipped++;
        results.push({ subId: entry.subId, url: "(already posted)" });
        continue;
      }

      // No digestUrl for Twitter: URL-bearing posts cost $0.20 vs $0.015
      // without. The bio link covers click-through.
      const { text, alt } = imagePostContent(entry, captionDates);
      const mimeType = mime === "image/jpeg" ? EUploadMimeType.Jpeg : EUploadMimeType.Png;

      try {
        const { id, url: postUrl } = await postTweetWithImage({
          text, altText: alt, imageBytes: png, mimeType,
        });
        await recordPost({
          platform: "twitter", sport, date, subId: entry.subId,
          remoteId: id, remoteUrl: postUrl, error: null,
        });
        posted++;
        results.push({ subId: entry.subId, url: postUrl });
        // Pace posts so the feed reads as a series, not a burst.
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        const msg = (err as Error).message;
        await recordPost({
          platform: "twitter", sport, date, subId: entry.subId,
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

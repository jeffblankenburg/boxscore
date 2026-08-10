import { NextResponse } from "next/server";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost } from "@/lib/social-posts";
import { blueskyAccountConfigured, blueskyTargetsForSport, deleteBlueskyPost, postToBlueskyWithImage } from "@/lib/bluesky";
import { EMAIL_LINK_BASE, siteOrigin } from "@/lib/site";
import { socialSendsAllowed } from "@/lib/sports";
import { supabaseAdmin } from "@/lib/supabase";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";
import { imagePostContent } from "@/lib/social-content";
import { resolvedOfficialMap } from "@/lib/team-hashtags";
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

  const runId = await startCronRun({ route: "post-bluesky", sport, date, trigger });

  try {

  // Cron-triggered posts only run for a publicly-launched sport with sends
  // enabled; manual admin triggers bypass so pre-launch sports can be tested.
  if (trigger !== "manual" && !(await socialSendsAllowed(sport))) {
    const result = { sport, date, skipped: "sport not public or sends disabled" };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  }

  // Skip sports whose Bluesky account isn't wired up yet (no per-league creds).
  // Other leagues skip until their BLUESKY_*_<SPORT> vars exist — never leaking
  // onto another account.
  if (!blueskyAccountConfigured(sport)) {
    const result = { sport, date, skipped: "no bluesky account configured for this sport" };
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  }

  // Account(s) this sport posts to. MLB is dual-homed this season (shared +
  // dedicated); every other sport has a single target. See blueskyTargetsForSport.
  const targets = blueskyTargetsForSport(sport);

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
        // A post's AT URI belongs to exactly one account; try each target and
        // let the non-owners fail harmlessly.
        for (const t of targets) {
          try { await deleteBlueskyPost(t, row.remote_id); } catch { /* not owner / gone */ }
        }
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
  const editionDate = nextDay(date);
  const digestUrl = `${EMAIL_LINK_BASE}/${sport}/${editionDate}`;
  const captionDates = {
    edition: prettyDate(editionDate),
    games: prettyDate(date),
  };

  // Render share images in-memory using the same renderer as the local script.
  // On Vercel this uses @sparticuz/chromium-min; locally it uses system Chrome.
  // NCAAF ships scoreboards only (Top 25 + per-conference); posting one image
  // per FBS game would be dozens of posts.
  const scoreboardsOnly = sport === "ncaaf";
  let images: Awaited<ReturnType<typeof renderShareImages>>;
  try {
    images = await renderShareImages({ date, baseUrl: origin, sport, scoreboardsOnly });
  } catch (err) {
    throw new Error(`render failed: ${(err as Error).message}`);
  }

  // Mirror to Supabase Storage so the admin gallery + Twitter compose page
  // can show + serve the latest set. Failure here doesn't block posting —
  // BlueSky uploads use the in-memory PNGs directly. Storage key is the
  // EDITION date — matches og:image and `/mlb/[editionDate]`.
  try {
    await uploadShareImages({ editionDate, images, sport });
  } catch (err) {
    console.error(`share-storage upload failed: ${(err as Error).message}`);
  }

  // Admin-editable per-team official hashtags (defaults + DB overrides).
  const officialMap = await resolvedOfficialMap(sport);

  let posted = 0, skipped = 0, failed = 0;
  const results: Array<{ subId: string; url?: string; error?: string }> = [];

  for (const { entry, png, mime, width, height } of images) {
    // Skip the full-day image: same DPR=1 readability problem as Twitter,
    // and 5+MB doesn't fit Bluesky's 2MB blob cap reliably. Still generated
    // and stored for the admin gallery.
    if (entry.type === "full") {
      skipped++;
      results.push({ subId: entry.subId, url: "(skipped: full image disabled)" });
      continue;
    }

    const { text, alt } = imagePostContent(entry, captionDates, digestUrl, sport, officialMap);
    const dims = width > 0 && height > 0 ? { width, height } : undefined;

    // Post the image to each target account. Each account gets its own dedup
    // row via the target's sub_id suffix (bare for the primary account).
    for (const target of targets) {
      const subId = `${entry.subId}${target.subIdSuffix}`;
      if (await hasAlreadyPosted("bluesky", sport, date, subId)) {
        skipped++;
        results.push({ subId, url: "(already posted)" });
        continue;
      }

      try {
        const { uri, url: postUrl } = await postToBlueskyWithImage({
          target, text, altText: alt, imageBytes: png, imageMime: mime, aspectRatio: dims,
        });
        await recordPost({
          platform: "bluesky", sport, date, subId,
          remoteId: uri, remoteUrl: postUrl, error: null,
        });
        posted++;
        results.push({ subId, url: postUrl });
        // Pace the posts so the feed reads as a series, not a burst.
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        const msg = (err as Error).message;
        await recordPost({
          platform: "bluesky", sport, date, subId,
          remoteId: null, remoteUrl: null, error: msg,
        });
        failed++;
        results.push({ subId, error: msg });
      }
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

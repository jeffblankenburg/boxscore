// Per-game MLB lineup-card poster (issue #140). Unlike the daily recap crons
// (one route per platform, fired once for yesterday's slate), this is a POLL:
// it runs every ~20 min through the day, finds today's games that are pregame
// AND inside the posting window (default first pitch within 180 min) AND have
// both lineups posted, renders each game's card once, and fans it out to every
// configured platform (X, Bluesky, Facebook, Discord league channel).
//
// Idempotent via social_posts (sub_id `lineup-{gamePk}`): a game already posted
// to a platform is skipped, so re-running the poll only picks up games whose
// lineups have since been announced. A game with no lineup yet returns null
// from loadLineupCard and is retried on the next tick.

import { NextResponse } from "next/server";
import { EUploadMimeType } from "twitter-api-v2";
import { isValidIsoDate, timeInET, todayInET } from "@/lib/dates";
import { hasAlreadyPosted, recordPost, type Platform } from "@/lib/social-posts";
import { deleteTweet, postTweetWithImage, twitterAccountConfigured } from "@/lib/twitter";
import { blueskyTargetsForSport, deleteBlueskyPost, postToBlueskyWithImage } from "@/lib/bluesky";
import { deleteFacebookPost, publishAlbum, uploadUnpublishedPhoto } from "@/lib/facebook";
import { loadLeagueWebhook, postToWebhook } from "@/lib/discord";
import { siteOrigin } from "@/lib/site";
import { socialSendsAllowed } from "@/lib/sports";
import { supabaseAdmin } from "@/lib/supabase";
import { renderElementPng } from "@/lib/render-images";
import { uploadLineupCardImage } from "@/lib/share-storage";
import { resolvedOfficialMap } from "@/lib/team-hashtags";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";
import { loadCardOdds, loadLineupCard, loadSlate, type LineupCardData } from "@/lib/sports/mlb/lineup-card";

export const runtime = "nodejs";
export const maxDuration = 300;

const SPORT = "mlb";
// How far ahead of first pitch a card may go out. 180 min = "1-3h pregame",
// which is comfortably after most teams post lineups but well before the game.
const DEFAULT_WINDOW_MIN = 180;
// Bound the render/post work in any single tick. Dedup means the total across
// the day is one render per game; this only caps a burst when many games enter
// the window at once (getaway days). Overflow is retried next tick.
const MAX_PER_RUN = 12;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function facebookConfigured(): boolean {
  return Boolean(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
}

// Caption text + accessibility alt for a card. No em dashes / middots (house
// style); hashtags are the two clubs' official tags when we have them.
function caption(data: LineupCardData, officialMap: Record<string, string | null>): { text: string; alt: string } {
  const tags = [data.away.teamName, data.home.teamName]
    .map((n) => officialMap[n])
    .filter((h): h is string => Boolean(h))
    .map((h) => `#${h}`)
    .join(" ");
  const head = `Starting lineups: ${data.away.name} at ${data.home.name}`;
  const when = `First pitch ${timeInET(data.startUtc)}${data.venue ? `, ${data.venue}` : ""}`;
  const text = [head, when, tags].filter(Boolean).join("\n");
  const aw = data.away.probable?.name ?? "TBD";
  const hp = data.home.probable?.name ?? "TBD";
  const alt =
    `${data.away.name} at ${data.home.name} starting lineups and probable pitchers ` +
    `(${data.away.abbr} ${aw} vs ${data.home.abbr} ${hp}), ${timeInET(data.startUtc)}.`;
  return { text, alt };
}

type PostResult = { platform: Platform; url?: string; skipped?: string; error?: string };

async function postToTwitter(data: LineupCardData, subId: string, text: string, alt: string, png: Uint8Array): Promise<PostResult> {
  if (!twitterAccountConfigured(SPORT)) return { platform: "twitter", skipped: "not configured" };
  if (await hasAlreadyPosted("twitter", SPORT, data.date, subId)) return { platform: "twitter", skipped: "already posted" };
  try {
    const { id, url } = await postTweetWithImage({ text, altText: alt, imageBytes: png, mimeType: EUploadMimeType.Png, sport: SPORT });
    await recordPost({ platform: "twitter", sport: SPORT, date: data.date, subId, remoteId: id, remoteUrl: url, error: null });
    return { platform: "twitter", url };
  } catch (err) {
    const msg = (err as Error).message;
    await recordPost({ platform: "twitter", sport: SPORT, date: data.date, subId, remoteId: null, remoteUrl: null, error: msg });
    return { platform: "twitter", error: msg };
  }
}

async function postToBluesky(data: LineupCardData, subId: string, text: string, alt: string, png: Uint8Array): Promise<PostResult[]> {
  const targets = blueskyTargetsForSport(SPORT);
  if (targets.length === 0) return [{ platform: "bluesky", skipped: "not configured" }];
  const out: PostResult[] = [];
  for (const target of targets) {
    const sub = `${subId}${target.subIdSuffix}`;
    if (await hasAlreadyPosted("bluesky", SPORT, data.date, sub)) { out.push({ platform: "bluesky", skipped: "already posted" }); continue; }
    try {
      const { url } = await postToBlueskyWithImage({
        target, text, altText: alt, imageBytes: png,
        aspectRatio: { width: 1080, height: 1080 },
      });
      await recordPost({ platform: "bluesky", sport: SPORT, date: data.date, subId: sub, remoteId: url, remoteUrl: url, error: null });
      out.push({ platform: "bluesky", url });
    } catch (err) {
      const msg = (err as Error).message;
      await recordPost({ platform: "bluesky", sport: SPORT, date: data.date, subId: sub, remoteId: null, remoteUrl: null, error: msg });
      out.push({ platform: "bluesky", error: msg });
    }
  }
  return out;
}

async function postToFacebook(data: LineupCardData, subId: string, text: string, imageUrl: string): Promise<PostResult> {
  if (!facebookConfigured()) return { platform: "facebook", skipped: "not configured" };
  if (await hasAlreadyPosted("facebook", SPORT, data.date, subId)) return { platform: "facebook", skipped: "already posted" };
  try {
    // A single-photo "album" is just a normal photo post with a caption.
    const fbid = await uploadUnpublishedPhoto(imageUrl);
    const { postId, url } = await publishAlbum({ message: text, mediaFbids: [fbid] });
    await recordPost({ platform: "facebook", sport: SPORT, date: data.date, subId, remoteId: postId, remoteUrl: url, error: null });
    return { platform: "facebook", url };
  } catch (err) {
    const msg = (err as Error).message;
    await recordPost({ platform: "facebook", sport: SPORT, date: data.date, subId, remoteId: null, remoteUrl: null, error: msg });
    return { platform: "facebook", error: msg };
  }
}

async function postToDiscord(data: LineupCardData, subId: string, text: string, imageUrl: string): Promise<PostResult> {
  if (await hasAlreadyPosted("discord", SPORT, data.date, subId)) return { platform: "discord", skipped: "already posted" };
  const webhook = await loadLeagueWebhook(SPORT);
  if (!webhook) return { platform: "discord", skipped: "no league webhook" };
  try {
    await postToWebhook(webhook.webhook_url, {
      embeds: [{
        title: `${data.away.name} at ${data.home.name}`,
        description: text,
        image: { url: imageUrl },
        timestamp: data.startUtc,
      }],
    });
    await recordPost({ platform: "discord", sport: SPORT, date: data.date, subId, remoteId: webhook.id, remoteUrl: imageUrl, error: null });
    return { platform: "discord", url: imageUrl };
  } catch (err) {
    const msg = (err as Error).message;
    await recordPost({ platform: "discord", sport: SPORT, date: data.date, subId, remoteId: null, remoteUrl: null, error: msg });
    return { platform: "discord", error: msg };
  }
}

// Wipe prior lineup-card posts for the date (all platforms) so a re-run
// re-posts. Best-effort remote deletes; the social_posts rows are what gate
// re-posting, so those must go regardless.
async function resetDate(date: string): Promise<void> {
  const { data: rows } = await supabaseAdmin()
    .from("social_posts")
    .select("platform, remote_id, sub_id")
    .eq("sport", SPORT)
    .eq("date", date)
    .like("sub_id", "lineup-%");
  const targets = blueskyTargetsForSport(SPORT);
  for (const row of rows ?? []) {
    if (!row.remote_id) continue;
    try {
      if (row.platform === "twitter") await deleteTweet(SPORT, row.remote_id);
      else if (row.platform === "facebook") await deleteFacebookPost(row.remote_id);
      else if (row.platform === "bluesky" && targets[0]) await deleteBlueskyPost(targets[0], row.remote_id);
    } catch { /* already gone */ }
  }
  await supabaseAdmin()
    .from("social_posts")
    .delete()
    .eq("sport", SPORT)
    .eq("date", date)
    .like("sub_id", "lineup-%");
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? todayInET();
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const reset = url.searchParams.get("reset") === "1";
  const forcePk = Number(url.searchParams.get("gamePk")) || null;   // test one game, ignore window
  const windowMin = Number(url.searchParams.get("window")) || DEFAULT_WINDOW_MIN;
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const runId = await startCronRun({ route: "post-lineups", sport: SPORT, date, trigger });

  try {
    if (trigger !== "manual" && !(await socialSendsAllowed(SPORT))) {
      const result = { date, skipped: "sport not public or sends disabled" };
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    if (reset) await resetDate(date);

    // Which games to attempt. Manual ?gamePk=… forces a single game regardless
    // of the window (for testing); otherwise scan the slate for pregame games
    // inside the posting window.
    let candidatePks: number[];
    if (forcePk) {
      candidatePks = [forcePk];
    } else {
      const now = Date.now();
      const slate = await loadSlate(date);
      candidatePks = slate
        .filter((g) => {
          if (g.state !== "Preview") return false;   // skip live/final
          const start = new Date(g.startUtc).getTime();
          if (!Number.isFinite(start)) return false;
          const minsToStart = (start - now) / 60_000;
          return minsToStart > 0 && minsToStart <= windowMin;
        })
        .map((g) => g.gamePk);
    }

    const origin = await siteOrigin();
    const officialMap = await resolvedOfficialMap(SPORT);
    // ML/run-line/total (ESPN) + NRFI (daily_odds) resolver — fetched once for
    // the whole slate, reused across every card.
    const oddsFor = await loadCardOdds(date).catch(() => null);

    let processed = 0, posted = 0, skipped = 0, failed = 0, notReady = 0;
    const games: Array<{ gamePk: number; matchup?: string; posts?: PostResult[]; note?: string }> = [];

    for (const gamePk of candidatePks) {
      if (processed >= MAX_PER_RUN) { games.push({ gamePk, note: "deferred (max per run)" }); continue; }

      const data = await loadLineupCard(gamePk);
      if (!data) { notReady++; games.push({ gamePk, note: "lineups not posted yet" }); continue; }
      if (oddsFor) data.odds = oddsFor(data.away.abbr, data.home.abbr);

      const subId = `lineup-${gamePk}`;
      // If every platform already has this game, don't even render.
      const allDone =
        (await hasAlreadyPosted("twitter", SPORT, date, subId)) &&
        (await hasAlreadyPosted("bluesky", SPORT, date, subId)) &&
        (await hasAlreadyPosted("facebook", SPORT, date, subId)) &&
        (await hasAlreadyPosted("discord", SPORT, date, subId));
      if (allDone) { skipped++; games.push({ gamePk, matchup: `${data.away.abbr}@${data.home.abbr}`, note: "already posted" }); continue; }

      processed++;
      let png: Uint8Array;
      try {
        png = await renderElementPng({ url: `${origin}/share/mlb/lineup/${gamePk}`, selector: "body" });
      } catch (err) {
        failed++;
        games.push({ gamePk, matchup: `${data.away.abbr}@${data.home.abbr}`, note: `render failed: ${(err as Error).message}` });
        continue;
      }

      // Public URL for the platforms that embed by URL (Facebook, Discord).
      let imageUrl = "";
      try { imageUrl = await uploadLineupCardImage(gamePk, date, png); }
      catch (err) { console.error(`lineup image upload failed for ${gamePk}: ${(err as Error).message}`); }

      const { text, alt } = caption(data, officialMap);
      const posts: PostResult[] = [];
      posts.push(await postToTwitter(data, subId, text, alt, png));
      posts.push(...await postToBluesky(data, subId, text, alt, png));
      if (imageUrl) {
        posts.push(await postToFacebook(data, subId, text, imageUrl));
        posts.push(await postToDiscord(data, subId, text, imageUrl));
      }

      for (const p of posts) {
        if (p.error) failed++;
        else if (p.skipped) skipped++;
        else posted++;
      }
      games.push({ gamePk, matchup: `${data.away.abbr}@${data.home.abbr}`, posts });
    }

    const result = { date, windowMin, candidates: candidatePks.length, processed, posted, skipped, failed, notReady, games };
    await finishCronRun(runId, {
      status: failed > 0 && posted === 0 ? "failed" : "ok",
      error: failed > 0 ? `${failed} platform post(s) failed` : null,
      result,
    });
    return NextResponse.json({ ok: failed === 0, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

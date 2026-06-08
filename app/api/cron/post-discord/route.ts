import { NextResponse } from "next/server";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE, siteOrigin } from "@/lib/site";
import { renderShareImages } from "@/lib/render-images";
import { uploadShareImages } from "@/lib/share-storage";
import {
  postLeagueEntry, postBoxscoresToTeams, summarize,
  type DiscordPostOutcome, type LeagueChannelEntry,
} from "@/lib/social-discord";
import { startCronRun, finishCronRun, summarizeItemErrors } from "@/lib/cron-runs";

// Daily Discord fan-out. Mirrors post-bluesky/route.ts: renders the
// share-image set for the date, uploads the PNGs to Supabase Storage
// (so embeds get stable public URLs), then posts:
//
//   - league scoreboard → sport-wide channel webhook
//   - each per-game box score → both team channels involved
//
// Idempotent via the social_posts table (platform='discord'). Re-running
// the cron skips channels that already received their post for the date.
// A single broken webhook logs + continues; the rest of the fan-out runs.

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
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const runId = await startCronRun({ route: "post-discord", sport, date, trigger });

  try {
    const origin = await siteOrigin();
    const editionDate = nextDay(date);
    const digestUrl = `${EMAIL_LINK_BASE}/${sport}/${editionDate}`;
    const prettyGamesDate = prettyDate(date);
    const prettyEditionDate = prettyDate(editionDate);

    // Re-use the same share-image rendering path as post-bluesky. Images
    // are rendered in-memory by Puppeteer, then uploaded to Supabase
    // Storage so the embed URLs are stable public links Discord can fetch.
    let images: Awaited<ReturnType<typeof renderShareImages>>;
    try {
      images = await renderShareImages({ date, baseUrl: origin });
    } catch (err) {
      throw new Error(`render failed: ${(err as Error).message}`);
    }

    let manifest: Awaited<ReturnType<typeof uploadShareImages>>;
    try {
      manifest = await uploadShareImages({ editionDate, images });
    } catch (err) {
      throw new Error(`upload failed: ${(err as Error).message}`);
    }

    // Index uploaded URLs by subId so the fan-out can look them up by
    // ManifestEntry without re-iterating the array.
    const urlBySubId = new Map<string, string>();
    for (const m of manifest.entries) urlBySubId.set(m.entry.subId, m.url);

    // League-channel posts: AL/NL standings, then AL/NL leaders, then
    // scoreboard. Scoreboard goes last so the channel's most recent
    // message — the one that surfaces in notifications and the channel
    // list — is the day's actual game results rather than a standings
    // snapshot. AL sorts before NL within each type for consistency.
    const outcomes: DiscordPostOutcome[] = [];
    const LEAGUE_ORDER: LeagueChannelEntry["type"][] = ["standings", "leaders", "scoreboard"];
    const leagueImages = images
      .filter((i): i is typeof i & { entry: LeagueChannelEntry } =>
        i.entry.type === "scoreboard" || i.entry.type === "standings" || i.entry.type === "leaders",
      )
      .sort((a, b) => {
        const typeDiff = LEAGUE_ORDER.indexOf(a.entry.type) - LEAGUE_ORDER.indexOf(b.entry.type);
        if (typeDiff !== 0) return typeDiff;
        // Within standings or leaders, AL before NL. scoreboard has no
        // league, so this branch is a no-op for that type.
        const al = (e: typeof a.entry): number =>
          e.type === "scoreboard" ? 0 : e.league === "AL" ? 0 : 1;
        return al(a.entry) - al(b.entry);
      });
    for (const { entry } of leagueImages) {
      const imageUrl = urlBySubId.get(entry.subId);
      if (!imageUrl) continue;
      outcomes.push(await postLeagueEntry({
        sport, date, prettyGamesDate, prettyEditionDate,
        entry, imageUrl, digestUrl,
      }));
    }

    // Per-game box scores — each posts to BOTH team channels.
    const boxscoreEntries = images
      .filter((i) => i.entry.type === "boxscore")
      .map((i) => ({
        entry: i.entry as Extract<typeof i.entry, { type: "boxscore" }>,
        imageUrl: urlBySubId.get(i.entry.subId),
      }))
      .filter((x): x is { entry: Extract<typeof x.entry, { type: "boxscore" }>; imageUrl: string } => !!x.imageUrl);

    const boxOutcomes = await postBoxscoresToTeams({
      sport, date, prettyGamesDate, boxscores: boxscoreEntries, digestUrl,
    });
    outcomes.push(...boxOutcomes);

    const summary = summarize(outcomes);
    const result = {
      sport, date,
      total: outcomes.length,
      posted: summary.posted,
      skipped: summary.skipped,
      failed: summary.failed,
    };
    await finishCronRun(runId, {
      status: summary.failed > 0 && summary.posted === 0 ? "failed" : "ok",
      error: summarizeItemErrors(outcomes, outcomes.length),
      result,
    });
    return NextResponse.json({ ok: summary.failed === 0, ...result, outcomes });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

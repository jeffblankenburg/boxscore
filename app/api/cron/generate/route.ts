import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { loadDailyRaw, rawToDailyData } from "@/lib/daily";
import {
  renderCanonicalContentWithAds,
  renderCanonicalEmailContentWithAds,
} from "@/lib/ad-placements";
import { upsertDigest } from "@/lib/digests";
import { upsertTeamDigest } from "@/lib/team-digests";
import { loadTeamEmailData, renderTeamEmailContent } from "@/lib/render-team-email";
import { renderTeamWebContent } from "@/lib/render-team-web";
import { teamsBySport } from "@/lib/teams";
import { adaptStatsapiDailyRaw } from "@/lib/sports/mlb/adapters/from-statsapi";
import { getCanonicalPlayerLookup } from "@/lib/canonical-players";
import { loadNbaData } from "@/lib/nba";
import { loadWnbaData } from "@/lib/wnba";
import {
  renderBasketballContent,
  renderBasketballEmailContent,
} from "@/lib/render-basketball";
import { yesterdayInET, isValidIsoDate, nextDay } from "@/lib/dates";
import { startCronRun, finishCronRun } from "@/lib/cron-runs";
import { renderScoreboardShareImage } from "@/lib/render-images";
import { uploadScoreboardShareImage } from "@/lib/share-storage";
import { siteOrigin } from "@/lib/site";

export const runtime = "nodejs";
// Team-digest generation extends the wall-clock; MLB v1 has 30 teams,
// each touching the MLB API for roster/schedule/probables. Even with the
// cached daily_raw hitting the box endpoints, per-team waves add up.
// Bump to the platform's 300s ceiling so we don't time out on heavy days.
export const maxDuration = 300;

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
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? yesterdayInET();
  const trigger = url.searchParams.get("trigger") === "manual" ? "manual" : "cron";
  const refetch = url.searchParams.get("refetch") === "true";
  // Bulk regenerate uses skip_teams=1 so each /api/cron/generate hit only
  // refreshes the league HTML — without this, regenerating ~50 dates also
  // fans out to ~30 teams per date and blows past any function timeout.
  // The daily cron at 9:00 UTC never sets this flag.
  const skipTeams = url.searchParams.get("skip_teams") === "1";
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  if (sport !== "mlb" && sport !== "nba" && sport !== "wnba") {
    return NextResponse.json(
      { error: `no generator implemented for sport=${sport}` },
      { status: 501 },
    );
  }

  let runId: string | null = null;
  try {
    runId = await startCronRun({ route: "generate", sport, date, trigger });

    if (sport === "mlb") {
      // League digest renders from the canonical model (lib/sports/mlb).
      // Same DailyRaw underneath; we just adapt it twice — once into the
      // canonical bundle for the renderers, and once into the legacy
      // DailyData for the team-digest loop below (still on the legacy
      // path) and for the `mode` field passed to upsertDigest.
      const raw = await loadDailyRaw(date, { refetch });
      await getCanonicalPlayerLookup();
      const canonical = adaptStatsapiDailyRaw(date, raw);
      const data = rawToDailyData(raw, date);

      // renderCanonical*ContentWithAds renders the canonical HTML and
      // splices in any live placements for (sport, edition_date). If
      // ads_enabled is OFF, scope check fails, or any layer throws, they
      // return the base HTML unchanged — the digest still ships. See
      // safety comments in lib/ad-placements.ts.
      const html = await renderCanonicalContentWithAds(canonical, sport);
      const email_html = await renderCanonicalEmailContentWithAds(canonical, sport);
      await upsertDigest({
        sport, date, html, email_html,
        game_count: canonical.games.length,
        mode: data.mode,
      });

      // Per-team digests cached alongside the league digest. Running them
      // here (rather than on-demand in send-team-email) lets the public web
      // page at /[sport]/[slug]/[date] serve static HTML for every team —
      // including teams without subscribers, since those pages should still
      // be browseable. Per-team errors are isolated so one team's data
      // failure doesn't tank the whole cron.
      //
      // Skipped during bulk regenerate (skip_teams=1) — the bulk action is
      // almost always used to roll out a league-template change; team
      // digests would multiply the wall-clock 30x and bust function timeouts.
      const teams = skipTeams ? [] : teamsBySport(sport);
      let teamOk = 0;
      const teamFails: string[] = [];
      for (const team of teams) {
        try {
          const td = await loadTeamEmailData(team, date);
          const teamHtml = renderTeamWebContent(td);
          const teamEmailHtml = renderTeamEmailContent(td);
          const hasGame = !!(
            td.yesterdayGame &&
            td.yesterdayGame.box &&
            td.yesterdayGame.game.status.codedGameState === "F"
          );
          await upsertTeamDigest({
            sport, team_slug: team.slug, date,
            has_game: hasGame, mode: data.mode,
            html: teamHtml, email_html: teamEmailHtml,
          });
          teamOk++;
        } catch (err) {
          const msg = (err as Error).message;
          console.error(`[generate] team ${team.slug} failed: ${msg}`);
          teamFails.push(`${team.slug}: ${msg}`);
        }
      }

      // Daily scoreboard share-image — the 1200×630 PNG used as the og:image
      // on /mlb/[editionDate] link previews and the lead image on the daily
      // Twitter/Bluesky/Facebook posts. Render failures are recorded in the
      // result but do NOT fail the cron — the digest itself is the critical
      // product. Skipped during bulk regenerate (skip_teams=1) since launching
      // Puppeteer per date would blow the function timeout; backfill is a
      // separate flow.
      let scoreboard_image_url: string | null = null;
      let scoreboard_image_error: string | null = null;
      // Skip the scoreboard image entirely on days with no completed games
      // (All-Star break, offseason) — a blank grid isn't worth shipping.
      const hasCompletedGames = canonical.games.some((g) => g.status === "final");
      if (!skipTeams && hasCompletedGames) {
        try {
          const editionDate = nextDay(date);
          const origin = await siteOrigin();
          const tImg = Date.now();
          const { png, width, height } = await renderScoreboardShareImage({
            editionDate, baseUrl: origin,
          });
          const { publicUrl } = await uploadScoreboardShareImage({
            editionDate, png,
          });
          scoreboard_image_url = publicUrl;
          console.log(`[generate] scoreboard ${editionDate} ${width}×${height} (${png.length} bytes) in ${Date.now() - tImg}ms`);
        } catch (err) {
          scoreboard_image_error = (err as Error).message;
          console.error(`[generate] scoreboard render failed: ${scoreboard_image_error}`);
        }
      }

      const result = {
        sport, date,
        mode: data.mode,
        game_count: data.games.length,
        html_bytes: html.length,
        email_bytes: email_html.length,
        teams_generated: teamOk,
        teams_failed: teamFails.length,
        ...(teamFails.length > 0 ? { team_failures: teamFails.slice(0, 5) } : {}),
        ...(scoreboard_image_url ? { scoreboard_image_url } : {}),
        ...(scoreboard_image_error ? { scoreboard_image_error } : {}),
      };
      // A new edition (or a regenerated one) means the sitemap's dated URL
      // list has changed — bust the 24h ISR cache so crawlers see the new
      // entries immediately instead of waiting for the natural expiry.
      revalidatePath("/sitemap.xml");
      await finishCronRun(runId, { status: "ok", result });
      return NextResponse.json({ ok: true, ...result });
    }

    // Basketball (nba | wnba): load → render → upsert. Same shape as MLB
    // above; the only difference is the data loader and the renderer used.
    const bb = sport === "nba"
      ? await loadNbaData(date, { refetch })
      : await loadWnbaData(date, { refetch });
    const html = renderBasketballContent(bb);
    const email_html = renderBasketballEmailContent(bb);
    await upsertDigest({
      sport, date, html, email_html, game_count: bb.games.length,
    });
    const finals = bb.games.filter((g) => g.event.status === "final").length;
    const result = {
      sport, date,
      game_count: bb.games.length,
      final_count: finals,
      conference_count: bb.standings.conferences.length,
      season: bb.season,
      html_bytes: html.length,
      email_bytes: email_html.length,
    };
    revalidatePath("/sitemap.xml");
    await finishCronRun(runId, { status: "ok", result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = (err as Error).message;
    await finishCronRun(runId, { status: "failed", error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

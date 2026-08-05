// Renders a team digest for /admin/preview/[sport]/[team]'s iframe. surface=web
// renders the web body in the newspaper shell; surface=email wraps the email
// body in teamDailyEmail. Both render LIVE (not from the team_digests cache),
// so the preview works for admin_only sports whose public page 404s and before
// the generate cron has run.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { findTeam, type Sport } from "@/lib/teams";
import { isValidIsoDate, nextDay, prettyDate, yesterdayInET } from "@/lib/dates";
import { loadTeamEmailData, renderTeamEmailContent } from "@/lib/render-team-email";
import { renderTeamWebContent } from "@/lib/render-team-web";
import { loadBasketballTeamData } from "@/lib/basketball-team";
import {
  renderBasketballTeamContent,
  renderBasketballTeamEmailContent,
} from "@/lib/render-basketball-team";
import { teamDailyEmail } from "@/lib/emails/templates";
import { getAnnouncement } from "@/lib/announcements";
import { siteOrigin } from "@/lib/site";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

const VALID_SPORTS = new Set(["mlb", "nba", "wnba"]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sport: string; team: string }> },
) {
  const { sport, team: slug } = await params;
  if (!VALID_SPORTS.has(sport)) {
    return new NextResponse("Bad sport", { status: 400 });
  }
  const team = findTeam(sport as Sport, slug);
  if (!team) return new NextResponse("Unknown team", { status: 404 });

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const date = dateParam && isValidIsoDate(dateParam) ? dateParam : yesterdayInET();
  const surface = url.searchParams.get("surface") === "web" ? "web" : "email";
  const isBasketball = sport === "nba" || sport === "wnba";

  if (surface === "web") {
    const webBody = isBasketball
      ? renderBasketballTeamContent(await loadBasketballTeamData(sport, slug, date))
      : renderTeamWebContent(await loadTeamEmailData(team, date));
    const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
<style>${globalsCss}</style>
</head>
<body><div class="newspaper">${webBody}</div></body>
</html>`;
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const origin = await siteOrigin();
  const body = isBasketball
    ? renderBasketballTeamEmailContent(await loadBasketballTeamData(sport, slug, date))
    : renderTeamEmailContent(await loadTeamEmailData(team, date));
  const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;

  const { html } = teamDailyEmail({
    sport,
    teamName: team.name,
    digestDate: date,
    digestPrettyDate: prettyDate(date),
    digestUrl: `${origin}/${sport}/${team.slug}/${nextDay(date)}`,
    unsubscribeUrl: `${origin}/u/admin-preview`,
    manageUrl: `${origin}/settings`,
    gamesUrl: `${origin}/games`,
    tipJarUrl: BRAND.tipJarUrl,
    announcementBanner,
    digestEmailHtml: body,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Renders the team email HTML for /admin/preview/[sport]/[team]'s iframe
// when surface=email. Web surface points the iframe at the public team
// page (/{sport}/{slug}/{date}) directly, so this route only covers email.

import { NextResponse } from "next/server";
import { findTeam, type Sport } from "@/lib/teams";
import { isValidIsoDate, prettyDate, yesterdayInET } from "@/lib/dates";
import { loadTeamEmailData, renderTeamEmailContent } from "@/lib/render-team-email";
import { teamDailyEmail } from "@/lib/emails/templates";
import { getAnnouncement } from "@/lib/announcements";
import { siteOrigin } from "@/lib/site";

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

  const origin = await siteOrigin();
  const data = await loadTeamEmailData(team, date);
  const body = renderTeamEmailContent(data);
  const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;

  const { html } = teamDailyEmail({
    teamName: team.name,
    digestDate: date,
    digestPrettyDate: prettyDate(date),
    digestUrl: `${origin}/${sport}/${team.slug}/${date}`,
    unsubscribeUrl: `${origin}/u/admin-preview`,
    manageUrl: `${origin}/settings`,
    announcementBanner,
    digestEmailHtml: body,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

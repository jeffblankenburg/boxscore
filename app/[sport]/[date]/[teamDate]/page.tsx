import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate, prevDay, nextDay, yesterdayInET } from "@/lib/dates";
import { getTeamDigest } from "@/lib/team-digests";
import { isSportVisible } from "@/lib/sports";
import { isAdminSession } from "@/lib/admin-auth";
import { findTeam, type Sport } from "@/lib/teams";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { DateHeaderCalendar } from "@/app/DateHeaderCalendar";
import { loadFootballTeamData } from "@/lib/sports/football/team-data";
import { renderFootballTeamContent } from "@/lib/sports/football/render/team";
import type { FootballLeague } from "@/lib/sports/football/types";

// /{sport}/{slug}/{date} — a specific team's digest for a specific date.
// Folder is named [teamDate] simply because Next.js requires unique segment
// names at each depth; conceptually this is "the date when the parent
// segment is a team slug". The parent ([date] folder) handles 2-segment
// URLs and branches on date-vs-slug.

export const dynamicParams = true;
export const revalidate = false;

export async function generateMetadata({ params }: {
  params: Promise<{ sport: string; date: string; teamDate: string }>;
}) {
  const { sport, date: slug, teamDate: date } = await params;
  const team = findTeam(sport as Sport, slug);
  if (!team || !isValidIsoDate(date)) return {};
  // URL date IS the edition date.
  return {
    title: `${team.name} Box Score — ${prettyDate(date)} | boxscore`,
    description: `${team.name} box score and recap for ${prettyDate(date)}.`,
    alternates: {
      canonical: `${EMAIL_LINK_BASE}/${sport}/${date}/${team.slug}`,
    },
  };
}

export default async function TeamDatePage({ params }: {
  params: Promise<{ sport: string; date: string; teamDate: string }>;
}) {
  const { sport, date: slug, teamDate: date } = await params;
  // Admins can view admin_only sports pre-launch (NFL/NCAAF); the public 404s.
  if (!isSportVisible(sport, { includeAdminOnly: await isAdminSession() })) notFound();
  if (!isValidIsoDate(date)) notFound();
  const team = findTeam(sport as Sport, slug);
  if (!team) notFound();

  // URL segment is edition_date; the underlying data is keyed by games_date.
  const gamesDate = prevDay(date);
  const today = nextDay(yesterdayInET());

  // Football team pages render live (ISR), point-in-time as of gamesDate —
  // there's no stored team_digest for football (web-only). Mirrors the
  // 2-segment latest route, just anchored to a specific date.
  if (sport === "nfl" || sport === "ncaaf") {
    const fbData = await loadFootballTeamData(sport as FootballLeague, team.slug, gamesDate);
    if (!fbData) notFound();
    return (
      <div>
        <div dangerouslySetInnerHTML={{ __html: renderFootballTeamContent(fbData) }} />
        <DateHeaderCalendar sport={sport} currentDate={date} today={today} teamSlug={team.slug} />
      </div>
    );
  }

  const cached = await getTeamDigest(sport, team.slug, gamesDate);
  if (!cached) notFound();

  return (
    <div>
      <div dangerouslySetInnerHTML={{ __html: cached.html }} />
      <DateHeaderCalendar
        sport={sport}
        currentDate={date}
        today={today}
        teamSlug={team.slug}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate, prevDay, nextDay, yesterdayInET } from "@/lib/dates";
import { getTeamDigest } from "@/lib/team-digests";
import { isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { DateHeaderCalendar } from "@/app/DateHeaderCalendar";

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
  if (!(await isSportVisible(sport))) notFound();
  if (!isValidIsoDate(date)) notFound();
  const team = findTeam(sport as Sport, slug);
  if (!team) notFound();

  // URL segment is edition_date; team_digests row is keyed by games_date.
  const gamesDate = prevDay(date);
  const cached = await getTeamDigest(sport, team.slug, gamesDate);
  if (!cached) notFound();

  const today = nextDay(yesterdayInET());
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

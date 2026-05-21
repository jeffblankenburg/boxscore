import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate, prevDay, nextDay } from "@/lib/dates";
import { getTeamDigest, hasInSeasonTeamDigest } from "@/lib/team-digests";
import { isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";

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
  // Browser tab + share metadata use the edition date — matches the
  // masthead inside the page (games_date + 1).
  const editionDate = prettyDate(nextDay(date));
  return {
    title: `${team.name} — ${editionDate} | boxscore`,
    description: `${team.name} digest for ${editionDate}.`,
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

  const [cached, hasPrev, hasNext] = await Promise.all([
    getTeamDigest(sport, team.slug, date),
    hasInSeasonTeamDigest(sport, team.slug, prevDay(date)),
    hasInSeasonTeamDigest(sport, team.slug, nextDay(date)),
  ]);
  if (!cached) notFound();

  const classes = [
    hasNext ? null : "no-next-day",
    hasPrev ? null : "no-prev-day",
  ].filter(Boolean).join(" ") || undefined;
  return <div className={classes} dangerouslySetInnerHTML={{ __html: cached.html }} />;
}

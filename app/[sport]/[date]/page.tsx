import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate, prevDay, nextDay } from "@/lib/dates";
import { getDigest, hasInSeasonDigest } from "@/lib/digests";
import { getLatestTeamDigest, hasInSeasonTeamDigest } from "@/lib/team-digests";
import { getSportById, isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";
import { PaperMasthead } from "@/app/PaperMasthead";

export const dynamicParams = true;
export const revalidate = false;

// The second path segment is either an ISO date (league digest) or a team
// slug (team's latest digest). Format is regex-distinguishable — dates are
// YYYY-MM-DD, slugs are 2–4 lowercase letters — so the page handler picks
// the branch by inspection. No /team prefix.
export async function generateMetadata({ params }: { params: Promise<{ sport: string; date: string }> }) {
  const { sport, date } = await params;
  const row = await getSportById(sport);
  if (!row || row.visibility !== "public") return {};

  if (isValidIsoDate(date)) {
    // Browser tab + share metadata use the edition date — matches the
    // masthead inside the page (which is games_date + 1).
    const editionDate = prettyDate(nextDay(date));
    return {
      title: `${row.name} — ${editionDate} | boxscore`,
      description: `Daily ${row.name} digest for ${editionDate}.`,
    };
  }
  const team = findTeam(sport as Sport, date);
  if (team) {
    return {
      title: `${team.name} | boxscore`,
      description: `Daily ${team.name} digest.`,
    };
  }
  return {};
}

export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; date: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { sport, date } = await params;
  if (!(await isSportVisible(sport))) notFound();

  // Branch A: date-shaped → league digest (the original behavior).
  if (isValidIsoDate(date)) {
    // Per-date existence check: hide the prev/next arrow when the literal
    // ±1-day URL doesn't point at an in-season cached digest. Simpler and
    // more correct than bounds-based logic — works across the multi-month
    // gap between seasons.
    const [digest, hasPrev, hasNext] = await Promise.all([
      getDigest(sport, date),
      hasInSeasonDigest(sport, prevDay(date)),
      hasInSeasonDigest(sport, nextDay(date)),
    ]);
    if (!digest) notFound();
    const { paper } = await searchParams;
    const paperMode = paper === "1";
    const classes = [
      paperMode ? "paper-mode" : null,
      hasNext ? null : "no-next-day",
      hasPrev ? null : "no-prev-day",
    ].filter(Boolean).join(" ") || undefined;
    return (
      <div className={classes}>
        {paperMode && <PaperMasthead date={date} />}
        <div dangerouslySetInnerHTML={{ __html: digest.html }} />
      </div>
    );
  }

  // Branch B: team-slug-shaped → latest cached team digest. The page lives
  // at /[sport]/[slug] and renders whatever's most recent in team_digests.
  // Visiting a specific date uses the 3-segment route. By definition this
  // IS the latest cached date for the team, so the next-day arrow is
  // always hidden here; check whether the prev calendar day has data.
  const team = findTeam(sport as Sport, date);
  if (!team) notFound();
  const cached = await getLatestTeamDigest(sport, team.slug);
  if (!cached) notFound();
  const teamHasPrev = await hasInSeasonTeamDigest(sport, team.slug, prevDay(cached.date));
  const teamClasses = [
    "no-next-day",
    teamHasPrev ? null : "no-prev-day",
  ].filter(Boolean).join(" ");
  return <div className={teamClasses} dangerouslySetInnerHTML={{ __html: cached.html }} />;
}

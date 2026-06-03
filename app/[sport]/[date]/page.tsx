import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate, prevDay, nextDay } from "@/lib/dates";
import { getDigest, hasInSeasonDigest } from "@/lib/digests";
import { getLatestTeamDigest, hasInSeasonTeamDigest } from "@/lib/team-digests";
import { getSportById, isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";
import { getScoreboardShareImageUrl } from "@/lib/share-storage";
import { EMAIL_LINK_BASE } from "@/lib/site";
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
    // URL date IS the edition date now (the day labeled on the masthead).
    // Storage and metadata both use that string directly.
    const editionDate = date;
    const title = `${row.name} — ${prettyDate(editionDate)} | boxscore`;
    const description = `Daily ${row.name} digest for ${prettyDate(editionDate)}.`;

    // OpenGraph + Twitter share-image. Only MLB renders a daily image right
    // now (via the cron in step 3). Other sports return null and fall through
    // to plain title+description; link previews on those URLs use the site's
    // favicon as today. When NBA/WNBA go public, each gets its own renderer
    // and the lookup widens.
    const shareImageUrl = sport === "mlb"
      ? await getScoreboardShareImageUrl(editionDate)
      : null;

    if (!shareImageUrl) return { title, description };

    const ogTitle = `${row.name} — ${prettyDate(editionDate)}`;
    return {
      title, description,
      openGraph: {
        title: ogTitle,
        description,
        url: `${EMAIL_LINK_BASE}/${sport}/${editionDate}`,
        siteName: "boxscore",
        type: "article",
        // Declared dimensions are the design size (1200×630) per the OG spec
        // convention; the actual file is 2x retina (2400×1260) but social
        // platforms downscale on display. Aspect ratio is what matters.
        images: [{
          url: shareImageUrl,
          width: 1200,
          height: 630,
          alt: `${row.name} scoreboard for ${prettyDate(editionDate)}`,
        }],
      },
      twitter: {
        card: "summary_large_image",
        title: ogTitle,
        description,
        images: [shareImageUrl],
      },
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

  // Branch A: date-shaped → league digest. URL segment is the EDITION
  // date; the underlying digest is keyed by games_date = edition − 1.
  if (isValidIsoDate(date)) {
    const editionDate = date;
    const gamesDate = prevDay(editionDate);
    // Existence checks for prev/next arrows look at adjacent EDITION
    // dates, which translate to gamesDate ±1 from the current one.
    const [digest, hasPrev, hasNext] = await Promise.all([
      getDigest(sport, gamesDate),
      hasInSeasonDigest(sport, prevDay(gamesDate)),
      hasInSeasonDigest(sport, nextDay(gamesDate)),
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
        {paperMode && <PaperMasthead date={editionDate} />}
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

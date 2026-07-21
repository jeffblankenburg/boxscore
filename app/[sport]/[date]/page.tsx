import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate, prevDay, nextDay, yesterdayInET } from "@/lib/dates";
import { getDigest } from "@/lib/digests";
import { getLatestTeamDigest } from "@/lib/team-digests";
import type { Metadata } from "next";
import { getSportById, isSportVisible } from "@/lib/sports";
import { findTeam, type Sport } from "@/lib/teams";
import { getScoreboardShareImageUrl } from "@/lib/share-storage";
import { isAdminSession } from "@/lib/admin-auth";
import { loadFootballTeamData, teamEditionDate as footballTeamEditionDate } from "@/lib/sports/football/team-data";
import { renderFootballTeamContent } from "@/lib/sports/football/render/team";
import type { FootballLeague } from "@/lib/sports/football/types";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { PaperMasthead } from "@/app/PaperMasthead";
import { DateHeaderCalendar } from "@/app/DateHeaderCalendar";

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
    const title = `${row.name} Box Scores — ${prettyDate(editionDate)} | boxscore`;
    const description = `Daily ${row.name} box scores, standings, and stat leaders for ${prettyDate(editionDate)}.`;
    const canonicalUrl = `${EMAIL_LINK_BASE}/${sport}/${editionDate}`;

    // OpenGraph + Twitter share-image. Only MLB renders a daily image right
    // now (via the cron in step 3). Other sports return null and fall through
    // to plain title+description; link previews on those URLs use the site's
    // favicon as today. When NBA/WNBA go public, each gets its own renderer
    // and the lookup widens.
    const shareImageUrl = sport === "mlb"
      ? await getScoreboardShareImageUrl(editionDate)
      : null;

    const base: Metadata = {
      title,
      description,
      alternates: { canonical: canonicalUrl },
    };
    if (!shareImageUrl) return base;

    const ogTitle = `${row.name} — ${prettyDate(editionDate)}`;
    return {
      ...base,
      openGraph: {
        title: ogTitle,
        description,
        url: canonicalUrl,
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
    const meta: Metadata = {
      title: `${team.name} Box Scores and Recap | boxscore`,
      description: `${team.name} game recaps, box scores, and season stats. Updated daily.`,
    };
    // Canonical points to the dated team URL — /[sport]/[slug] and
    // /[sport]/[date]/[slug] serve the same content for the latest date,
    // and without canonical Google splits ranking signal between them.
    // The dated URL is the right canonical because it's stable: links to
    // it accumulate authority instead of pointing at a moving target.
    const latest = await getLatestTeamDigest(sport, team.slug);
    if (latest) {
      const editionDate = nextDay(latest.date);
      meta.alternates = {
        canonical: `${EMAIL_LINK_BASE}/${sport}/${editionDate}/${team.slug}`,
      };
    }
    return meta;
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
  // Admins can view admin_only sports pre-launch (NFL); the public still 404s.
  if (!isSportVisible(sport, { includeAdminOnly: await isAdminSession() })) notFound();

  // Branch A: date-shaped → league digest. URL segment is the EDITION
  // date; the underlying digest is keyed by games_date = edition − 1.
  if (isValidIsoDate(date)) {
    const editionDate = date;
    const gamesDate = prevDay(editionDate);
    const digest = await getDigest(sport, gamesDate);
    if (!digest) notFound();
    const { paper } = await searchParams;
    const paperMode = paper === "1";
    const today = nextDay(yesterdayInET());
    return (
      <div className={paperMode ? "paper-mode" : undefined}>
        {paperMode && <PaperMasthead date={editionDate} />}
        <div dangerouslySetInnerHTML={{ __html: digest.html }} />
        <DateHeaderCalendar sport={sport} currentDate={editionDate} today={today} />
      </div>
    );
  }

  // Branch B: team-slug-shaped → the team's page.
  const team = findTeam(sport as Sport, date);
  if (!team) notFound();

  // Football renders team pages live (ISR) rather than from team_digests —
  // web-only, so there's no email_html to precompute, and live loading keeps
  // the nightly cron off the per-athlete ESPN endpoints. See
  // lib/sports/football/team-data.ts.
  if (sport === "nfl" || sport === "ncaaf") {
    const fbData = await loadFootballTeamData(sport as FootballLeague, team.slug);
    if (!fbData) notFound();
    const fbToday = nextDay(yesterdayInET());
    const fbEdition = footballTeamEditionDate(fbData) ?? fbToday;
    const fbSchema = {
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      "@id": `${EMAIL_LINK_BASE}/${sport}/${team.slug}`,
      name: team.name,
      url: `${EMAIL_LINK_BASE}/${sport}/${team.slug}`,
      sport: "American Football",
    };
    return (
      <div>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(fbSchema) }}
        />
        <div dangerouslySetInnerHTML={{ __html: renderFootballTeamContent(fbData) }} />
        <DateHeaderCalendar
          sport={sport}
          currentDate={fbEdition}
          today={fbToday}
          teamSlug={team.slug}
        />
      </div>
    );
  }

  const cached = await getLatestTeamDigest(sport, team.slug);
  if (!cached) notFound();
  const teamEditionDate = nextDay(cached.date);
  const today = nextDay(yesterdayInET());
  // SportsTeam schema on the team-latest URL (which is also the canonical
  // for this team's content). Tells search + AI bots that /[sport]/[slug]
  // IS the team entity page; subordinate dated pages cite back to it.
  const schema = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    "@id": `${EMAIL_LINK_BASE}/${sport}/${team.slug}`,
    name: team.name,
    url: `${EMAIL_LINK_BASE}/${sport}/${team.slug}`,
    sport: sport === "mlb" ? "Baseball" : sport,
  };
  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <div dangerouslySetInnerHTML={{ __html: cached.html }} />
      <DateHeaderCalendar
        sport={sport}
        currentDate={teamEditionDate}
        today={today}
        teamSlug={team.slug}
      />
    </div>
  );
}

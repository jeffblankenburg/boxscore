import { notFound } from "next/navigation";
import { todayInET, yesterdayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { getVisibleSports } from "@/lib/sports";
import { renderMasthead, mastheadNavSports } from "@/lib/masthead";
import {
  LEADER_PAGES, leaderPageForSlug, loadFullLeaderboard, renderLeaderTableHtml,
} from "@/lib/sports/mlb/leaders-full";
import "./leaders.css";

// Full-season leaderboard for one stat: every ranked player, AL left, NL right.
// ISR — regenerated hourly so the numbers track the season without a live fetch
// on every request (see the Supabase compute-load note in project memory).
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string; category: string }>;
}) {
  const { sport, category } = await params;
  const config = sport === "mlb" ? leaderPageForSlug(category) : undefined;
  if (!config) return {};
  const season = todayInET().slice(0, 4);
  const title = `${config.label} Leaders (${season}) | boxscore`;
  const desc = `Every qualifying MLB player ranked by ${config.label.toLowerCase()} for the ${season} season, American League and National League.`;
  const url = `${EMAIL_LINK_BASE}/mlb/leaders/${config.slug}`;
  return {
    title,
    description: desc,
    alternates: { canonical: `/mlb/leaders/${config.slug}` },
    openGraph: { title, description: desc, url, siteName: "boxscore", type: "website" },
    twitter: { card: "summary", title, description: desc },
  };
}

export default async function LeadersPage({
  params,
}: {
  params: Promise<{ sport: string; category: string }>;
}) {
  const { sport, category } = await params;
  if (sport !== "mlb") notFound();
  const config = leaderPageForSlug(category);
  if (!config) notFound();

  const season = Number(todayInET().slice(0, 4));
  const board = await loadFullLeaderboard(config, season);

  const q = board.qualifier;
  const qualifierNote = q
    ? `Qualified players only: minimum ${q.perGame} ${q.unit} per team game (${q.threshold} ${q.thresholdUnit} through ${q.teamGames} team games).`
    : `No minimum — every player who recorded the stat, ranked top to bottom.`;

  // Same site header the digest carries (logo + all-sports nav + dateline), so
  // a leaderboard page reads as part of the paper, not an orphaned view.
  const navSports = mastheadNavSports(await getVisibleSports());
  const masthead = renderMasthead({ date: yesterdayInET(), sport: "mlb", surface: "web", navSports });

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: masthead }} />
      {/* Reuse the masthead's own nav classes so this reads as a second row of
          the sport line — identical spacing/type by construction. */}
      <nav className="masthead-nav lb-statnav" aria-label="Leader categories">
        {LEADER_PAGES.map((p) => (
          <a
            key={p.slug}
            href={`/mlb/leaders/${p.slug}`}
            title={p.label}
            className={p.slug === config.slug ? "masthead-nav-link is-current" : "masthead-nav-link"}
          >
            {p.valueLabel}
          </a>
        ))}
      </nav>
      <div className="lb-page">
      <h1 className="lb-title">{config.label}</h1>
      <p className="lb-subtitle">{season} season</p>
      <p className="lb-qualifier">{qualifierNote}</p>

      <div className="lb-cols">
        <div
          className="lb-col"
          dangerouslySetInnerHTML={{ __html: renderLeaderTableHtml("American League", board.al, config) }}
        />
        <div
          className="lb-col"
          dangerouslySetInnerHTML={{ __html: renderLeaderTableHtml("National League", board.nl, config) }}
        />
      </div>
      </div>
    </>
  );
}

import { notFound } from "next/navigation";
import { yesterdayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { getVisibleSports, isSportVisible, getSportById } from "@/lib/sports";
import { renderMasthead, mastheadNavSports } from "@/lib/masthead";
import { leadersProvider, renderLeaderColumnHtml } from "@/lib/sports/leaders";
import "./leaders.css";

// Full-season leaderboard for one stat: every ranked player, in one or two
// columns depending on the sport (MLB AL/NL, NHL single). Sport-agnostic — the
// per-sport provider (lib/sports/leaders.ts) supplies the data and columns.
// ISR — regenerated hourly so the numbers track the season without a live fetch
// on every request (see the Supabase compute-load note in project memory).
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string; category: string }>;
}) {
  const { sport, category } = await params;
  const provider = leadersProvider(sport);
  const meta = provider?.categories.find((c) => c.slug === category);
  if (!meta) return {};
  const row = await getSportById(sport);
  const league = row?.name ?? sport.toUpperCase();
  const title = `${meta.label} Leaders | ${league} | boxscore`;
  const desc = `Every qualifying ${league} player ranked by ${meta.label.toLowerCase()}, top to bottom.`;
  const url = `${EMAIL_LINK_BASE}/${sport}/leaders/${meta.slug}`;
  return {
    title,
    description: desc,
    alternates: { canonical: `/${sport}/leaders/${meta.slug}` },
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
  // Only public sports get leaderboards; admin_only sports 404 pre-launch (same
  // gate as the digest pages).
  if (!(await isSportVisible(sport))) notFound();
  const provider = leadersProvider(sport);
  if (!provider) notFound();
  const board = await provider.load(category);
  if (!board) notFound();

  // Same site header the digest carries (logo + all-sports nav + dateline), so
  // a leaderboard page reads as part of the paper, not an orphaned view.
  const navSports = mastheadNavSports(await getVisibleSports());
  const masthead = renderMasthead({ date: yesterdayInET(), sport, surface: "web", navSports });
  const singleCol = board.columns.length === 1;

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: masthead }} />
      {/* Stat sub-nav — reuses the masthead's own nav classes so it reads as a
          second row of the sport line (identical spacing/type by construction). */}
      <nav className="masthead-nav lb-statnav" aria-label="Leader categories">
        {provider.categories.map((c) => (
          <a
            key={c.slug}
            href={`/${sport}/leaders/${c.slug}`}
            title={c.label}
            className={c.slug === board.category.slug ? "masthead-nav-link is-current" : "masthead-nav-link"}
          >
            {c.valueLabel}
          </a>
        ))}
      </nav>
      <div className="lb-page">
        <h1 className="lb-title">{board.category.label}</h1>
        <p className="lb-subtitle">{board.season} season</p>
        {board.qualifierNote && <p className="lb-qualifier">{board.qualifierNote}</p>}

        <div className={singleCol ? "lb-cols lb-cols-single" : "lb-cols"}>
          {board.columns.map((col, i) => (
            <div
              key={i}
              className="lb-col"
              dangerouslySetInnerHTML={{ __html: renderLeaderColumnHtml(col, board.category.valueLabel) }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

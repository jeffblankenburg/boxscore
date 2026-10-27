import { buildHomeEdition } from "@/lib/home-edition";
import { getVisibleSports } from "@/lib/sports";
import { mastheadNavSports, renderMasthead } from "@/lib/masthead";
import { yesterdayInET } from "@/lib/dates";
import { BRAND } from "@/lib/brand";

// The home page: the complete edition — every in-season sport's yesterday box
// scores — under the same masthead (sport nav + dateline) every /[sport] page
// uses, so the header is identical site-wide.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const edition = await buildHomeEdition();
  const empty = edition.length === 0;
  // Same masthead as the digests: sport nav + dateline. No current sport is
  // bolded on the home page; the dateline shows the edition date (yesterday + 1).
  const navSports = mastheadNavSports(await getVisibleSports());
  const masthead = renderMasthead({ date: yesterdayInET(), sport: "", surface: "web", navSports });

  return (
    <main className="home">
      <div dangerouslySetInnerHTML={{ __html: masthead }} />

      {/* Home-only tagline bar — a second masthead-style strip under the
          dateline, styled to match the sports nav above it. */}
      <div className="home-tagline">{BRAND.tagline}</div>

      {empty && <p className="home-empty">No games yesterday. Check back after tonight&rsquo;s slate.</p>}

      {/* Newspaper columns via CSS multi-column: the browser flows these cells
          into 3 / 2 / 1 columns by viewport width (never narrower than a box
          needs) and balances them by height. A league header drops in whenever
          the league changes; break-inside:avoid keeps a box from splitting
          across a column break. */}
      <div className="home-cols">
        {edition.map((cell, i) => {
          const showHeader = i === 0 || edition[i - 1]!.leagueId !== cell.leagueId;
          return (
            <div className="home-cell" key={i}>
              {showHeader && (
                <h2 className="home-sport-head">
                  <a href={`/${cell.leagueId}`}>{cell.leagueName}</a>
                </h2>
              )}
              <div className="home-game" dangerouslySetInnerHTML={{ __html: cell.html }} />
            </div>
          );
        })}
      </div>

      <section className="home-premium">
        <div className="home-premium-kicker">Premium</div>
        <p>Model picks and pre-game lineup cheatsheets, by sport. Launching after the World Series.</p>
      </section>
    </main>
  );
}

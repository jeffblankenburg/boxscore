import { buildHomeEdition, splitColumns } from "@/lib/home-edition";
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
  const columns = splitColumns(edition, 3);
  // Same masthead as the digests: sport nav + dateline. No current sport is
  // bolded on the home page; the dateline shows the edition date (yesterday + 1).
  const navSports = mastheadNavSports(await getVisibleSports());
  const masthead = renderMasthead({ date: yesterdayInET(), sport: "", surface: "web", navSports });

  return (
    <main className="home">
      <div dangerouslySetInnerHTML={{ __html: masthead }} />

      <section className="home-subscribe">
        <p>The daily box score for every sport, free in your inbox.</p>
        <a className="home-subscribe-btn" href={BRAND.subscribeUrl}>Subscribe free &rarr;</a>
      </section>

      {empty && <p className="home-empty">No games yesterday. Check back after tonight&rsquo;s slate.</p>}

      {/* Explicit newspaper columns: each column is topped with a league header
          (a league continuing from the previous column shows its header again),
          so every column's first game lands on the same line. */}
      <div className="home-cols">
        {columns.map((col, ci) => (
          <div className="home-col" key={ci}>
            {col.map((cell, i) => {
              const showHeader = i === 0 || col[i - 1]!.leagueId !== cell.leagueId;
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
        ))}
      </div>

      <section className="home-premium">
        <div className="home-premium-kicker">Premium</div>
        <p>Model picks and pre-game lineup cheatsheets, by sport. Launching after the World Series.</p>
      </section>
    </main>
  );
}

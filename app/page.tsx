import { buildHomeEdition } from "@/lib/home-edition";
import { todayInET, prettyDate } from "@/lib/dates";
import { BRAND } from "@/lib/brand";

// The home page: a newspaper front page and the complete edition — every
// in-season sport's yesterday box scores, each under a linked section header
// that leads to the full digest (standings, leaders, …) at /[sport].
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const today = todayInET();
  const edition = await buildHomeEdition();
  const empty = edition.length === 0;

  return (
    <main className="home">
      <div className="home-nameplate">
        <h1 className="home-wordmark">{BRAND.name}</h1>
        <div className="home-dateline">{prettyDate(today)}</div>
        <div className="home-tagline">{BRAND.tagline}</div>
      </div>

      <section className="home-subscribe">
        <p>The daily box score for every sport, free in your inbox.</p>
        <a className="home-subscribe-btn" href={BRAND.subscribeUrl}>Subscribe free &rarr;</a>
      </section>

      {empty && <p className="home-empty">No games yesterday. Check back after tonight&rsquo;s slate.</p>}

      {/* Column-major (newspaper agate): games flow down each column then over to
          the next, so each league's games stay contiguous under its header. */}
      <div className="home-flow">
        {edition.map((cell, i) => (
          <div className="home-cell" key={i}>
            {cell.header && (
              <h2 className="home-sport-head">
                <a href={`/${cell.header.id}`}>{cell.header.name} &rarr;</a>
              </h2>
            )}
            <div className="home-game" dangerouslySetInnerHTML={{ __html: cell.html }} />
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

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Games | boxscore",
  robots: { index: false },          // unindex while in development
};

type GameEntry = {
  slug: string;
  title: string;
  desc: string;
  status: "live" | "soon";
};

// Single source of truth for the menu. Only "live" games are listed —
// the unbuilt ones (Guess the Year / Guess the Player) come back when
// they ship. Card Sharks-style stat comparison ships as Stat Sharks
// (the Hi/Lo idea, renamed).
const GAMES: GameEntry[] = [
  {
    slug: "linescordle",
    title: "Linescordle",
    desc: "Guess the player name from their game line. Wordle-style letter feedback.",
    status: "live",
  },
  {
    slug: "statsharks",
    title: "Stat Sharks",
    desc: "Two players, two seasons. Pick whose stat is higher. Build a streak.",
    status: "live",
  },
  {
    slug: "time-machine",
    title: "Time Machine",
    desc: "Guess the year of a real box score. Six tries, higher / lower hints.",
    status: "live",
  },
];

export default function GamesLanding() {
  return (
    <>
      <header className="g-hero">
        <h1>Games</h1>
        <p>Daily puzzles from 75+ years of MLB box scores.</p>
      </header>

      <nav className="g-menu" aria-label="Available games">
        {GAMES.map((g) =>
          g.status === "live" ? (
            <a key={g.slug} href={`/games/${g.slug}`} className="g-card g-card-live">
              <div>
                <p className="g-card-title">{g.title}</p>
                <p className="g-card-desc">{g.desc}</p>
              </div>
              <span className="g-card-status g-card-status-play">Play</span>
            </a>
          ) : (
            <div
              key={g.slug}
              className="g-card g-card-soon"
              aria-disabled="true"
              role="link"
            >
              <div>
                <p className="g-card-title">{g.title}</p>
                <p className="g-card-desc">{g.desc}</p>
              </div>
              <span className="g-card-status g-card-status-soon">Soon</span>
            </div>
          ),
        )}
      </nav>
    </>
  );
}

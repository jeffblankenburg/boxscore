import { GAME_ICONS } from "./icons";
import { DailyStatus } from "./daily-status";
import { todayInET } from "@/lib/dates";

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

// Single source of truth for the menu. Linescordle is intentionally
// omitted — the difficulty knob isn't right yet (without hints it's
// brutal; with the autocomplete suggestions it solves in ~4 by
// brute-force). The route still works for anyone with a bookmark; it
// just isn't surfaced. Restore the entry when the gameplay tuning lands.
const GAMES: GameEntry[] = [
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
  const today = todayInET();
  return (
    <>
      <header className="g-hero">
        <h1>Games</h1>
        <p>Daily puzzles from 75+ years of MLB box scores.</p>
      </header>

      <nav className="g-menu" aria-label="Available games">
        {GAMES.map((g) => {
          const Icon = GAME_ICONS[g.slug];
          const body = (
            <>
              <span className="g-card-icon">
                {Icon ? <Icon /> : null}
              </span>
              <div className="g-card-body">
                <p className="g-card-title">{g.title}</p>
                <p className="g-card-desc">{g.desc}</p>
                {g.status === "live" ? (
                  <DailyStatus slug={g.slug} playedOn={today} />
                ) : null}
              </div>
              <span
                className={`g-card-status g-card-status-${g.status === "live" ? "play" : "soon"}`}
              >
                {g.status === "live" ? "Play" : "Soon"}
              </span>
            </>
          );
          return g.status === "live" ? (
            <a key={g.slug} href={`/games/${g.slug}`} className="g-card g-card-live">
              {body}
            </a>
          ) : (
            <div
              key={g.slug}
              className="g-card g-card-soon"
              aria-disabled="true"
              role="link"
            >
              {body}
            </div>
          );
        })}
      </nav>
    </>
  );
}

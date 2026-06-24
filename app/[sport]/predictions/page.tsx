import { notFound } from "next/navigation";
import { todayInET, timeInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { loadPredictionsForDate } from "@/lib/sports/mlb/predictions-data";
import type { GamePrediction, PredictionSide } from "@/lib/sports/mlb/predictions";
import "./predictions.css";

export const revalidate = 300;
export const dynamic = "force-dynamic";

const META_TITLE = "Daily Predictions | boxscore";
const META_DESC =
  "Daily MLB win-probability and NRFI (no-runs-in-the-first-inning) predictions for tonight's slate. Built on pythagorean expectation, log5, and league-average matchup factors.";
const META_URL = `${EMAIL_LINK_BASE}/mlb/predictions`;
const META_IMG = `${EMAIL_LINK_BASE}/icon.png`;

export const metadata = {
  title: META_TITLE,
  description: META_DESC,
  alternates: { canonical: "/mlb/predictions" },
  openGraph: {
    title: META_TITLE, description: META_DESC, url: META_URL,
    siteName: "boxscore", type: "website",
    images: [{ url: META_IMG, alt: "boxscore" }],
  },
  twitter: { card: "summary", title: META_TITLE, description: META_DESC, images: [META_IMG] },
};

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}
function fmt2(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
function teamHref(abbr: string): string {
  return `/mlb/${abbr.toLowerCase()}`;
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export default async function PredictionsPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();

  const today = todayInET();
  const result = await loadPredictionsForDate(today);

  return (
    <div className="pr-page">
      <h1 className="pr-title">Daily Predictions</h1>
      <p className="pr-subtitle">
        {prettyDate(today)} &middot; {result.gameCount} game{result.gameCount === 1 ? "" : "s"}
      </p>

      <p className="pr-note">
        WIN combines Bill James pythagorean expectation (runs scored / runs allowed) with log5 matchup, a +.040
        home-field bump, and each starter&apos;s ERA delta from league average (4.20).
        NRFI starts from the .57 league baseline and is modulated by both lineups&apos; runs-per-game and both
        starters&apos; ERA. v1 does not use first-inning-specific splits, bullpen quality, or park factors.
        Commonly used equations &mdash; we will not beat sharps with this. The point is a transparent baseline.
      </p>

      {result.games.length === 0 ? (
        <p className="pr-empty">No games on the slate today.</p>
      ) : (
        <div className="pr-scroll">
          <table className="pr-table">
            <thead>
              <tr>
                <th className="pr-col-time">Time</th>
                <th className="pr-col-side">Away</th>
                <th className="pr-col-side">Home</th>
                <th>Away W%</th>
                <th>Home W%</th>
                <th>NRFI</th>
                <th>Pick</th>
                <th className="pr-col-conf">Conf</th>
              </tr>
            </thead>
            <tbody>
              {result.games.map((g) => (
                <PredictionRow key={g.gamePk} game={g} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PredictionRow({ game }: { game: GamePrediction }) {
  return (
    <tr>
      <td className="pr-col-time">{timeInET(game.startTime)}</td>
      <td className="pr-col-side">
        <SideCell side={game.away} />
      </td>
      <td className="pr-col-side">
        <SideCell side={game.home} />
      </td>
      <td className={game.favorite === "away" ? "pr-fav" : ""}>{pct(game.away.winProbability)}</td>
      <td className={game.favorite === "home" ? "pr-fav" : ""}>{pct(game.home.winProbability)}</td>
      <td className={game.nrfiProbability > 0.5 ? "pr-fav" : ""}>{pct(game.nrfiProbability)}</td>
      <td className="pr-pick">
        {game.favorite === "even"
          ? <span className="pr-pick-even">Even</span>
          : <a className="pr-team-link" href={teamHref(game.favorite === "home" ? game.home.abbr : game.away.abbr)}>
              {game.favorite === "home" ? game.home.abbr : game.away.abbr}
            </a>}
      </td>
      <td className="pr-col-conf">
        <ConfidenceBar value={game.winConfidence} />
      </td>
    </tr>
  );
}

function SideCell({ side }: { side: PredictionSide }) {
  return (
    <>
      <a className="pr-team-link" href={teamHref(side.abbr)}>{side.abbr}</a>
      <span className="pr-record"> ({side.record.wins}-{side.record.losses})</span>
      {side.probableSp && (
        <div className="pr-sp">
          {side.probableSp.name}
          <span className="pr-sp-era"> ({fmt2(side.probableSp.era)})</span>
        </div>
      )}
    </>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pctNum = Math.round(value * 100);
  const filled = Math.min(10, Math.max(0, Math.round(pctNum / 10)));
  const blocks = "█".repeat(filled) + "░".repeat(10 - filled);
  return <span className="pr-conf-bar" title={`${pctNum}% confidence`}>{blocks}</span>;
}

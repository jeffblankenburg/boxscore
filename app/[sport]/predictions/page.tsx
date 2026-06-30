import { notFound } from "next/navigation";
import { todayInET, timeInET, prevDay } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { loadPredictionsForDate } from "@/lib/sports/mlb/predictions-data";
import {
  winPlayFor,
  nrfiPlayFor,
  ML_PLAY_THRESHOLD,
  NRFI_PLAY_THRESHOLD,
  type GamePrediction,
  type PredictionSide,
  type WinPlay,
  type NrfiPlay,
} from "@/lib/sports/mlb/predictions";
import {
  loadPredictionOutcomesForDate,
  loadPredictionAccuracy,
  outcomeWinPlay,
  outcomeNrfiPlay,
  type PlayAccuracySummary,
  type GamePredictionOutcome,
} from "@/lib/sports/mlb/predictions-history";
import { readPredictionsRenderBlob } from "@/lib/sports/mlb/predictions-cache";
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
  const yesterday = prevDay(today);

  // Read the pre-rendered blob first — both crons (predictions-snapshot
  // and predictions-comparator) rebuild it after they write data, so
  // this is current within hours. Live compute is the fallback for the
  // first request after a model bump (model_version mismatch returns
  // null) or before today's first cron has run.
  let result: Awaited<ReturnType<typeof loadPredictionsForDate>>;
  let yesterdayOutcomes: GamePredictionOutcome[];
  let rolling7:      PlayAccuracySummary;
  let rolling30:     PlayAccuracySummary;
  let rollingSeason: PlayAccuracySummary | null;
  let seasonDays = 0;

  const cached = await readPredictionsRenderBlob(today);
  if (cached) {
    result            = cached.slate;
    yesterdayOutcomes = cached.outcomes;
    rolling7          = cached.rolling7;
    rolling30         = cached.rolling30;
    rollingSeason     = cached.rollingSeason;
    seasonDays        = cached.seasonDays;
  } else {
    // Cold path — same loaders the cache would have called. Wait on
    // all in parallel. Page is slow here (~20s on a fresh serverless
    // instance) but functional; next cron run repairs the cache.
    [result, yesterdayOutcomes, rolling7, rolling30] = await Promise.all([
      loadPredictionsForDate(today),
      loadPredictionOutcomesForDate(yesterday),
      loadPredictionAccuracy(7,  yesterday),
      loadPredictionAccuracy(30, yesterday),
    ]);
    rollingSeason = null;
  }

  const plays = result.games
    .map((g) => ({ game: g, win: winPlayFor(g), nrfi: nrfiPlayFor(g) }))
    .filter((p) => p.win !== null || p.nrfi !== null);

  return (
    <div className="pr-page">
      <h1 className="pr-title">Daily Predictions</h1>
      <p className="pr-subtitle">
        {prettyDate(today)} &middot; {result.gameCount} game{result.gameCount === 1 ? "" : "s"}
        {plays.length > 0 && <> &middot; <strong>{plays.length} play{plays.length === 1 ? "" : "s"}</strong></>}
      </p>

      <p className="pr-note">
        WIN combines pythagorean expectation (blended 60% recent / 40% season RS/RA),
        log5 matchup, a +.040 home-field bump, each starter&apos;s ERA delta (also recent-blended),
        and each team&apos;s bullpen ERA scaled to ~3.5 IP/game.
        NRFI starts from the .57 league baseline and is modulated by both lineups&apos;
        actual 1st-inning runs-per-game, each starter&apos;s actual 1st-inning ERA,
        and a static 3-year park-factor index for the home venue — all from cached box scores.
        The raw model output is then shrunk toward 50% by an empirical calibration factor
        (fit on graded games) so the displayed probability matches observed frequency.{" "}
        <strong>
          We flag a play at {(ML_PLAY_THRESHOLD * 100).toFixed(1)}%+ calibrated probability.
        </strong>{" "}
        Below that, the model&apos;s signal isn&apos;t strong enough to clear typical book prices.
        Doesn&apos;t use: batter-vs-pitcher handedness splits, bullpen fatigue,
        umpire tendencies, or weather.
      </p>

      <PlaysSection plays={plays} date={today} />

      <Recap
        yesterday={yesterday}
        outcomes={yesterdayOutcomes}
        rolling7={rolling7}
        rolling30={rolling30}
        rollingSeason={rollingSeason}
        seasonDays={seasonDays}
      />

      <h2 className="pr-section-h">All games</h2>
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
                <th className="pr-col-play">Play</th>
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
  const winPlay = winPlayFor(game);
  const nrfiPlay = nrfiPlayFor(game);
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
      <td className="pr-col-play">
        <PlayBadges winPlay={winPlay} nrfiPlay={nrfiPlay} />
      </td>
    </tr>
  );
}

function PlayBadges({ winPlay, nrfiPlay }: { winPlay: WinPlay | null; nrfiPlay: NrfiPlay | null }) {
  if (!winPlay && !nrfiPlay) {
    return <span className="pr-na">—</span>;
  }
  return (
    <span className="pr-play-stack">
      {winPlay && (
        <span className={`pr-play-badge pr-play-ml${winPlay.strong ? " pr-play-strong" : ""}`}>
          ML {winPlay.abbr} {pct(winPlay.winPct)}
        </span>
      )}
      {nrfiPlay && (
        <span className={`pr-play-badge pr-play-nrfi${nrfiPlay.strong ? " pr-play-strong" : ""}`}>
          {nrfiPlay.side} {pct(nrfiPlay.probability)}
        </span>
      )}
    </span>
  );
}

function PlaysSection({
  plays,
  date,
}: {
  plays: Array<{ game: GamePrediction; win: WinPlay | null; nrfi: NrfiPlay | null }>;
  date: string;
}) {
  void date;
  return (
    <section className="pr-plays">
      <h2 className="pr-plays-head">Today&apos;s Plays</h2>
      {plays.length === 0 ? (
        <p className="pr-plays-empty">
          No games clear the {Math.round(ML_PLAY_THRESHOLD * 100)}% ML or
          {" "}{Math.round(NRFI_PLAY_THRESHOLD * 100)}% NRFI thresholds tonight. Pass.
        </p>
      ) : (
        <div className="pr-scroll">
          <table className="pr-plays-table">
            <thead>
              <tr>
                <th className="pr-col-time">Time</th>
                <th>Matchup</th>
                <th>ML play</th>
                <th>NRFI play</th>
              </tr>
            </thead>
            <tbody>
              {plays.map(({ game, win, nrfi }) => (
                <tr key={game.gamePk}>
                  <td className="pr-col-time">{timeInET(game.startTime)}</td>
                  <td className="pr-pick-cell">
                    <a className="pr-team-link" href={teamHref(game.away.abbr)}>{game.away.abbr}</a>
                    {" @ "}
                    <a className="pr-team-link" href={teamHref(game.home.abbr)}>{game.home.abbr}</a>
                  </td>
                  <td>
                    {win
                      ? <span className={`pr-play-badge pr-play-ml${win.strong ? " pr-play-strong" : ""}`}>
                          ML {win.abbr} {pct(win.winPct)}
                        </span>
                      : <span className="pr-na">—</span>}
                  </td>
                  <td>
                    {nrfi
                      ? <span className={`pr-play-badge pr-play-nrfi${nrfi.strong ? " pr-play-strong" : ""}`}>
                          {nrfi.side} {pct(nrfi.probability)}
                        </span>
                      : <span className="pr-na">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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

// ─── How we did ─────────────────────────────────────────────────────────

function pctOrDash(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function Recap({
  yesterday,
  outcomes,
  rolling7,
  rolling30,
  rollingSeason,
  seasonDays,
}: {
  yesterday: string;
  outcomes: GamePredictionOutcome[];
  rolling7: PlayAccuracySummary;
  rolling30: PlayAccuracySummary;
  rollingSeason: PlayAccuracySummary | null;
  seasonDays: number;
}) {
  // Filter yesterday's grades to plays only — games we didn't bet
  // shouldn't show up in the success ledger.
  const playedRows = outcomes
    .map((o) => ({ o, win: outcomeWinPlay(o), nrfi: outcomeNrfiPlay(o) }))
    .filter((p) => p.win !== null || p.nrfi !== null);

  const hasHistory = rolling30.mlPlays > 0 || rolling30.nrfiPlays > 0 || playedRows.length > 0;
  if (!hasHistory) return null;

  const seasonLabel = seasonDays > 0 ? `Season (${seasonDays}d)` : "Season";

  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">How our plays did</h2>
      <div className="pr-recap-stats">
        <PlayStat label="7d ML plays" plays={rolling7.mlPlays} hits={rolling7.mlPlayHits} rate={rolling7.mlHitRate} />
        <PlayStat label="7d NRFI plays" plays={rolling7.nrfiPlays} hits={rolling7.nrfiPlayHits} rate={rolling7.nrfiHitRate} />
        <PlayStat label="30d ML plays" plays={rolling30.mlPlays} hits={rolling30.mlPlayHits} rate={rolling30.mlHitRate} />
        <PlayStat label="30d NRFI plays" plays={rolling30.nrfiPlays} hits={rolling30.nrfiPlayHits} rate={rolling30.nrfiHitRate} />
        {rollingSeason && (
          <>
            <PlayStat label={`${seasonLabel} ML plays`} plays={rollingSeason.mlPlays} hits={rollingSeason.mlPlayHits} rate={rollingSeason.mlHitRate} />
            <PlayStat label={`${seasonLabel} NRFI plays`} plays={rollingSeason.nrfiPlays} hits={rollingSeason.nrfiPlayHits} rate={rollingSeason.nrfiHitRate} />
          </>
        )}
      </div>
      {playedRows.length > 0 && (
        <>
          <div className="pr-recap-subhead">Yesterday ({prettyDate(yesterday)})</div>
          <div className="pr-scroll">
            <table className="pr-recap-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Final</th>
                  <th>ML play</th>
                  <th>NRFI play</th>
                </tr>
              </thead>
              <tbody>
                {playedRows.map(({ o, win, nrfi }) => (
                  <YesterdayRow key={o.gamePk} o={o} win={win} nrfi={nrfi} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function PlayStat({
  label,
  plays,
  hits,
  rate,
}: {
  label: string;
  plays: number;
  hits: number;
  rate: number | null;
}) {
  return (
    <div className="pr-stat-block">
      <div className="pr-stat-label">{label}</div>
      <div className="pr-stat-value">{pctOrDash(rate)}</div>
      <div className="pr-stat-sub">{plays > 0 ? `${hits} of ${plays}` : "no plays in window"}</div>
    </div>
  );
}

function YesterdayRow({
  o,
  win,
  nrfi,
}: {
  o: GamePredictionOutcome;
  win: WinPlay | null;
  nrfi: NrfiPlay | null;
}) {
  const finalScore =
    o.awayScore !== null && o.homeScore !== null
      ? `${o.awayAbbr} ${o.awayScore} · ${o.homeAbbr} ${o.homeScore}`
      : <span className="pr-na">{o.status}</span>;

  return (
    <tr>
      <td className="pr-pick-cell">{o.awayAbbr} @ {o.homeAbbr}</td>
      <td>{finalScore}</td>
      <td>
        {win
          ? <PlayCell badgeClass="pr-play-ml" strong={win.strong} label={`ML ${win.abbr} ${pct(win.winPct)}`} hit={o.winCorrect} />
          : <span className="pr-na">—</span>}
      </td>
      <td>
        {nrfi
          ? <PlayCell badgeClass="pr-play-nrfi" strong={nrfi.strong} label={`${nrfi.side} ${pct(nrfi.probability)}`} hit={o.nrfiCorrect} />
          : <span className="pr-na">—</span>}
      </td>
    </tr>
  );
}

function PlayCell({
  badgeClass,
  strong,
  label,
  hit,
}: {
  badgeClass: string;
  strong: boolean;
  label: string;
  hit: boolean | null;
}) {
  return (
    <span className="pr-play-cell">
      <span className={`pr-play-badge ${badgeClass}${strong ? " pr-play-strong" : ""}`}>{label}</span>
      {hit === null
        ? <span className="pr-na"> —</span>
        : hit
          ? <span className="pr-hit"> ✓</span>
          : <span className="pr-miss"> ✗</span>}
    </span>
  );
}

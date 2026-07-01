import { notFound } from "next/navigation";
import { todayInET, timeInET, prevDay } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { loadPredictionsForDate } from "@/lib/sports/mlb/predictions-data";
import {
  winPlayFor,
  nrfiPlayFor,
  bestOfSlateWinPlay,
  bestOfSlateNrfiPlay,
  type GamePrediction,
  type WinPlay,
  type NrfiPlay,
} from "@/lib/sports/mlb/predictions";
import {
  loadPredictionOutcomesForDate,
  loadPredictionAccuracy,
  loadPlayRoi,
  loadSeasonHistory,
  outcomeWinPlay,
  outcomeNrfiPlay,
  type PlayAccuracySummary,
  type PlayRoiSummary,
  type GamePredictionOutcome,
  type SeasonHistoryDay,
} from "@/lib/sports/mlb/predictions-history";
import { readPredictionsRenderBlob } from "@/lib/sports/mlb/predictions-cache";
import "./predictions.css";

// Data is once-a-day. Cache the rendered HTML aggressively — the two
// crons that own this data (predictions-snapshot, predictions-comparator)
// call revalidatePath("/mlb/predictions") after they rebuild the
// blob, so the page invalidates the moment new data lands rather than
// waiting for the timer. The 1-hour fallback covers anything missed.
export const revalidate = 3600;

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
  let roi7:      PlayRoiSummary | null = null;
  let roi30:     PlayRoiSummary | null = null;
  let roiSeason: PlayRoiSummary | null = null;
  let seasonHistory: SeasonHistoryDay[] = [];
  let seasonDays = 0;

  const cached = await readPredictionsRenderBlob(today);
  if (cached) {
    result            = cached.slate;
    yesterdayOutcomes = cached.outcomes;
    rolling7          = cached.rolling7;
    rolling30         = cached.rolling30;
    rollingSeason     = cached.rollingSeason;
    roi7              = cached.roi7;
    roi30             = cached.roi30;
    roiSeason         = cached.roiSeason;
    seasonDays        = cached.seasonDays;
    seasonHistory     = cached.seasonHistory;
  } else {
    // Cold path — same loaders the cache would have called. Wait on
    // all in parallel. Page is slow here (~20s on a fresh serverless
    // instance) but functional; next cron run repairs the cache.
    const seasonStart = `${today.slice(0, 4)}-03-01`;
    [result, yesterdayOutcomes, rolling7, rolling30, seasonHistory, roi7, roi30] = await Promise.all([
      loadPredictionsForDate(today),
      loadPredictionOutcomesForDate(yesterday),
      loadPredictionAccuracy(7,  yesterday),
      loadPredictionAccuracy(30, yesterday),
      loadSeasonHistory(seasonStart, yesterday),
      loadPlayRoi(7,  yesterday),
      loadPlayRoi(30, yesterday),
    ]);
    rollingSeason = null;
  }

  const plays = buildTodaysPlays(result.games);

  return (
    <div className="pr-page">
      <h1 className="pr-title">Daily Predictions</h1>
      <p className="pr-subtitle">
        {prettyDate(today)} &middot; {result.gameCount} game{result.gameCount === 1 ? "" : "s"}
        {plays.length > 0 && <> &middot; <strong>{plays.length} play{plays.length === 1 ? "" : "s"}</strong></>}
      </p>

      <PlaysSection plays={plays} date={today} />

      <YesterdayResults yesterday={yesterday} outcomes={yesterdayOutcomes} />

      <StatBoxes
        rolling7={rolling7}
        rolling30={rolling30}
        rollingSeason={rollingSeason}
        roi7={roi7}
        roi30={roi30}
        roiSeason={roiSeason}
        seasonDays={seasonDays}
      />

      <SeasonHistorySection days={seasonHistory} />
    </div>
  );
}

/** Build today's pick list with the always-pick rule: every day shows
 *  at least one ML and one NRFI play, even if nothing clears threshold.
 *  Threshold qualifiers are listed first; if no ML qualifier exists we
 *  attach the slate's strongest favorite, and same for NRFI. */
function buildTodaysPlays(
  games: GamePrediction[],
): Array<{ game: GamePrediction; win: WinPlay | null; nrfi: NrfiPlay | null }> {
  if (games.length === 0) return [];

  const byPk = new Map<number, { game: GamePrediction; win: WinPlay | null; nrfi: NrfiPlay | null }>();
  for (const g of games) {
    const win = winPlayFor(g);
    const nrfi = nrfiPlayFor(g);
    if (win || nrfi) byPk.set(g.gamePk, { game: g, win, nrfi });
  }

  const hasMl   = Array.from(byPk.values()).some((p) => p.win !== null);
  const hasNrfi = Array.from(byPk.values()).some((p) => p.nrfi !== null);

  if (!hasMl) {
    const fb = bestOfSlateWinPlay(games);
    if (fb) {
      const game = games.find((g) => g.gamePk === fb.gamePk);
      if (game) {
        const existing = byPk.get(fb.gamePk);
        if (existing) existing.win = fb.play;
        else byPk.set(fb.gamePk, { game, win: fb.play, nrfi: null });
      }
    }
  }
  if (!hasNrfi) {
    const fb = bestOfSlateNrfiPlay(games);
    if (fb) {
      const game = games.find((g) => g.gamePk === fb.gamePk);
      if (game) {
        const existing = byPk.get(fb.gamePk);
        if (existing) existing.nrfi = fb.play;
        else byPk.set(fb.gamePk, { game, win: null, nrfi: fb.play });
      }
    }
  }

  return Array.from(byPk.values()).sort((a, b) =>
    a.game.startTime.localeCompare(b.game.startTime),
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
        <p className="pr-plays-empty">No games on the slate today.</p>
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

function pctOrDash(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function YesterdayResults({
  yesterday,
  outcomes,
}: {
  yesterday: string;
  outcomes: GamePredictionOutcome[];
}) {
  const playedRows = outcomes
    .map((o) => ({ o, win: outcomeWinPlay(o), nrfi: outcomeNrfiPlay(o) }))
    .filter((p) => p.win !== null || p.nrfi !== null);

  if (playedRows.length === 0) return null;

  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">Yesterday&apos;s Results</h2>
      <div className="pr-recap-subhead">{prettyDate(yesterday)}</div>
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
    </section>
  );
}

function StatBoxes({
  rolling7,
  rolling30,
  rollingSeason,
  roi7,
  roi30,
  roiSeason,
  seasonDays,
}: {
  rolling7: PlayAccuracySummary;
  rolling30: PlayAccuracySummary;
  rollingSeason: PlayAccuracySummary | null;
  roi7: PlayRoiSummary | null;
  roi30: PlayRoiSummary | null;
  roiSeason: PlayRoiSummary | null;
  seasonDays: number;
}) {
  const hasAny = rolling30.mlPlays > 0 || rolling30.nrfiPlays > 0 || rolling7.mlPlays > 0 || rolling7.nrfiPlays > 0;
  if (!hasAny) return null;

  const seasonLabel = seasonDays > 0 ? `Season (${seasonDays}d)` : "Season";

  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">Win Percentages</h2>
      <div className="pr-stat-grid">
        <WindowStat label="Last 7 days" summary={rolling7} roi={roi7} />
        <WindowStat label="Last 30 days" summary={rolling30} roi={roi30} />
        {rollingSeason && <WindowStat label={seasonLabel} summary={rollingSeason} roi={roiSeason} />}
      </div>
    </section>
  );
}

function WindowStat({
  label,
  summary,
  roi,
}: {
  label: string;
  summary: PlayAccuracySummary;
  roi: PlayRoiSummary | null;
}) {
  return (
    <div className="pr-window-box">
      <div className="pr-window-label">{label}</div>
      <div className="pr-window-row">
        <span className="pr-window-tag">ML</span>
        <span className="pr-window-pct">{pctOrDash(summary.mlHitRate)}</span>
        <span className="pr-window-sub">{summary.mlPlays > 0 ? `${summary.mlPlayHits} of ${summary.mlPlays}` : "—"}</span>
      </div>
      {roi && roi.mlPlaysWithOdds > 0 && (
        <div className="pr-window-row pr-window-row-roi">
          <span className="pr-window-tag pr-window-tag-sub">${roi.stake}/play</span>
          <span className={`pr-window-pl${roi.mlProfit >= 0 ? " pr-window-pl-pos" : " pr-window-pl-neg"}`}>
            {formatDollarSigned(roi.mlProfit)}
          </span>
          <span className="pr-window-sub">{formatPctSigned(roi.mlRoi)} ROI</span>
        </div>
      )}
      <div className="pr-window-row">
        <span className="pr-window-tag">NRFI</span>
        <span className="pr-window-pct">{pctOrDash(summary.nrfiHitRate)}</span>
        <span className="pr-window-sub">{summary.nrfiPlays > 0 ? `${summary.nrfiPlayHits} of ${summary.nrfiPlays}` : "—"}</span>
      </div>
      {roi && roi.nrfiPlaysWithOdds > 0 && (
        <div className="pr-window-row pr-window-row-roi">
          <span className="pr-window-tag pr-window-tag-sub">${roi.stake}/play</span>
          <span className={`pr-window-pl${roi.nrfiProfit >= 0 ? " pr-window-pl-pos" : " pr-window-pl-neg"}`}>
            {formatDollarSigned(roi.nrfiProfit)}
          </span>
          <span className="pr-window-sub">{formatPctSigned(roi.nrfiRoi)} ROI</span>
        </div>
      )}
    </div>
  );
}

function formatDollarSigned(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
function formatPctSigned(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(v) * 100).toFixed(1)}%`;
}

function SeasonHistorySection({ days }: { days: SeasonHistoryDay[] }) {
  if (days.length === 0) return null;
  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">Season Picks</h2>
      <div className="pr-scroll">
        <table className="pr-recap-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Game</th>
              <th>Final</th>
              <th>ML play</th>
              <th>NRFI play</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <SeasonHistoryRow key={d.date} day={d} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeasonHistoryRow({ day }: { day: SeasonHistoryDay }) {
  const game = day.game;
  const finalScore =
    game && game.awayScore !== null && game.homeScore !== null
      ? `${game.awayAbbr} ${game.awayScore} · ${game.homeAbbr} ${game.homeScore}`
      : <span className="pr-na">{game?.status ?? "—"}</span>;
  return (
    <tr>
      <td className="pr-col-time">{shortDate(day.date)}</td>
      <td className="pr-pick-cell">
        {game ? `${game.awayAbbr} @ ${game.homeAbbr}` : "—"}
      </td>
      <td>{finalScore}</td>
      <td>
        {day.mlPlay
          ? <PlayCell badgeClass="pr-play-ml" strong={day.mlPlay.strong} label={day.mlPlay.label} hit={day.mlPlay.hit} />
          : <span className="pr-na">—</span>}
      </td>
      <td>
        {day.nrfiPlay
          ? <PlayCell badgeClass="pr-play-nrfi" strong={day.nrfiPlay.strong} label={day.nrfiPlay.label} hit={day.nrfiPlay.hit} />
          : <span className="pr-na">—</span>}
      </td>
    </tr>
  );
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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

import { notFound } from "next/navigation";
import { todayInET, timeInET, prevDay } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { loadPredictionsForDate } from "@/lib/sports/mlb/predictions-data";
import {
  selectDailyCard,
  cardCandidateFor,
  nrfiSideLabel,
  type GamePrediction,
  type WinPlay,
  type NrfiPlay,
} from "@/lib/sports/mlb/predictions";
import {
  loadPredictionOutcomesForDate,
  loadPredictionAccuracy,
  loadPlayRoi,
  loadSeasonHistory,
  loadOddsForDate,
  type PlayAccuracySummary,
  type PlayRoiSummary,
  type GamePredictionOutcome,
  type SeasonHistoryDay,
  type SeasonHistoryGame,
  type DayOdds,
} from "@/lib/sports/mlb/predictions-history";
import { americanToProfitMultiplier } from "@/lib/sports/mlb/clv";
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
  "Daily MLB win-probability and NRFI (no-runs-in-the-first-inning) predictions for tonight's slate. Built on a run-distribution model that derives moneyline and first-inning odds from one expected-runs engine.";
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

  // Yesterday's and today's odds — small, dedicated fetches. Today's
  // odds gate the ML play selection (heavy chalk and underdogs are
  // filtered), so this must run for the plays list to be honest.
  const [yesterdayOdds, todayOdds] = await Promise.all([
    loadOddsForDate(yesterday),
    loadOddsForDate(today),
  ]);

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
    // Mirror daysSinceSeasonStart from predictions-cache — used as the
    // window for the season-to-date accuracy and ROI boxes.
    seasonDays = Math.max(
      1,
      Math.round(
        (new Date(`${today}T00:00:00Z`).getTime() -
         new Date(`${seasonStart}T00:00:00Z`).getTime()) / 86_400_000,
      ),
    );
    [result, yesterdayOutcomes, rolling7, rolling30, rollingSeason, seasonHistory, roi7, roi30, roiSeason] = await Promise.all([
      loadPredictionsForDate(today),
      loadPredictionOutcomesForDate(yesterday),
      loadPredictionAccuracy(7,          yesterday),
      loadPredictionAccuracy(30,         yesterday),
      loadPredictionAccuracy(seasonDays, yesterday),
      loadSeasonHistory(seasonStart, yesterday),
      loadPlayRoi(7,          yesterday),
      loadPlayRoi(30,         yesterday),
      loadPlayRoi(seasonDays, yesterday),
    ]);
  }

  const plays = buildTodaysPlays(result.games, todayOdds);

  return (
    <div className="pr-page">
      <h1 className="pr-title">Daily Predictions</h1>
      <p className="pr-subtitle">
        {prettyDate(today)} &middot; {result.gameCount} game{result.gameCount === 1 ? "" : "s"}
        {plays.length > 0 && <> &middot; <strong>{plays.length} play{plays.length === 1 ? "" : "s"}</strong></>}
      </p>

      <PlaysSection plays={plays} date={today} />

      <YesterdayResults yesterday={yesterday} outcomes={yesterdayOutcomes} odds={yesterdayOdds} />

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

/** Build today's card: the capped 5-pick set (2 ML by EV edge + 2 NRFI
 *  by conviction + 1 flex), grouped by game for the table. A game can
 *  contribute both its ML and NRFI pick if both make the card. */
function buildTodaysPlays(
  games: GamePrediction[],
  todayOdds: DayOdds,
): Array<{ game: GamePrediction; win: WinPlay | null; nrfi: NrfiPlay | null }> {
  if (games.length === 0) return [];

  const card = selectDailyCard(
    games.map((g) => cardCandidateFor(g.gamePk, g.away.winProbability, g.home.winProbability, g.nrfiProbability, todayOdds.mlByGamePk.get(g.gamePk))),
  );
  const gameByPk = new Map(games.map((g) => [g.gamePk, g]));
  const byPk = new Map<number, { game: GamePrediction; win: WinPlay | null; nrfi: NrfiPlay | null }>();
  for (const p of card) {
    const game = gameByPk.get(p.gamePk);
    if (!game) continue;
    const entry = byPk.get(p.gamePk) ?? { game, win: null, nrfi: null };
    if (p.market === "ML") {
      entry.win = { side: p.side as "away" | "home", abbr: p.side === "home" ? game.home.abbr : game.away.abbr, winPct: p.probability, strong: p.strong, dog: p.dog };
    } else {
      entry.nrfi = { side: p.side as "NRFI" | "YRFI", probability: p.probability, strong: p.strong };
    }
    byPk.set(p.gamePk, entry);
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
                <th>Play</th>
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
                  <td className="pr-plays-play">
                    {!win && !nrfi && <span className="pr-na">—</span>}
                    {win && <span className="pr-play-plain">{win.abbr} ML{win.dog ? " 🐕" : ""}</span>}
                    {nrfi && <span className="pr-play-plain">{nrfiSideLabel(nrfi.side)}</span>}
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
  odds,
}: {
  yesterday: string;
  outcomes: GamePredictionOutcome[];
  odds: DayOdds;
}) {
  // Same capped 5-pick card as buildTodaysPlays / the stat loaders —
  // graded against yesterday's outcomes.
  const oByPk = new Map(outcomes.map((o) => [o.gamePk, o]));
  const card = selectDailyCard(
    outcomes.map((o) => cardCandidateFor(o.gamePk, o.awayWinPct, o.homeWinPct, o.nrfiPct, odds.mlByGamePk.get(o.gamePk))),
  );
  const rowsByPk = new Map<number, { o: GamePredictionOutcome; win: WinPlay | null; nrfi: NrfiPlay | null }>();
  for (const p of card) {
    const o = oByPk.get(p.gamePk);
    if (!o) continue;
    const entry = rowsByPk.get(p.gamePk) ?? { o, win: null, nrfi: null };
    if (p.market === "ML") {
      entry.win = { side: p.side as "away" | "home", abbr: p.side === "home" ? o.homeAbbr : o.awayAbbr, winPct: p.probability, strong: p.strong, dog: p.dog };
    } else {
      entry.nrfi = { side: p.side as "NRFI" | "YRFI", probability: p.probability, strong: p.strong };
    }
    rowsByPk.set(p.gamePk, entry);
  }
  const playedRows = Array.from(rowsByPk.values()).sort((a, b) => a.o.gamePk - b.o.gamePk);

  if (playedRows.length === 0) return null;

  // Day total P/L across the card's priced picks.
  let dayTotal = 0, priced = 0, anyPartial = false;
  for (const { o, win, nrfi } of playedRows) {
    const { profit, partial } = pickProfit(o, win, nrfi, odds);
    if (profit !== null) { dayTotal += profit; priced++; }
    if (partial) anyPartial = true;
  }

  return (
    <section className="pr-recap pr-yesterday">
      <h2 className="pr-recap-head">Yesterday&apos;s Results</h2>
      <div className="pr-recap-subhead">{prettyDate(yesterday)}</div>
      <div className="pr-scroll">
        <table className="pr-recap-table pr-yesterday-table">
          <thead>
            <tr>
              <th>Final</th>
              <th>Play</th>
              <th>Odds</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {playedRows.map(({ o, win, nrfi }) => (
              <YesterdayRow key={o.gamePk} o={o} win={win} nrfi={nrfi} odds={odds} />
            ))}
          </tbody>
          {priced > 0 && (
            <tfoot>
              <tr className="pr-yesterday-total">
                <td colSpan={3}>Day total</td>
                <td className="pr-yesterday-profit">
                  <span className={dayTotal >= 0 ? "pr-profit-pos" : "pr-profit-neg"}>{formatProfit(dayTotal)}</span>
                  {anyPartial && <span className="pr-profit-partial" title="Some odds missing">*</span>}
                </td>
              </tr>
            </tfoot>
          )}
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

const SEASON_PICKS_DAYS = 14;

function SeasonHistorySection({ days }: { days: SeasonHistoryDay[] }) {
  if (days.length === 0) return null;
  const shown = days.slice(0, SEASON_PICKS_DAYS);
  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">Season Picks</h2>
      <div className="pr-recap-subhead">Last {shown.length} days</div>
      <div className="pr-scroll">
        <table className="pr-recap-table pr-season-table">
          <thead>
            <tr>
              <th className="pr-season-date-head">Date</th>
              <th className="pr-season-box-head">Box Score</th>
              <th className="pr-season-result-head">Result</th>
            </tr>
          </thead>
          <tbody>
            {shown.flatMap((d) =>
              d.games.map((g, gi) => (
                <tr key={`${d.date}|${g.gamePk}`}>
                  {gi === 0 && (
                    <td className="pr-season-date" rowSpan={d.games.length}>
                      <span className="pr-season-date-label">{shortDate(d.date)}</span>
                      {d.profit !== null && (
                        <span className={`pr-day-pl ${d.profit >= 0 ? "pr-profit-pos" : "pr-profit-neg"}`}>
                          {formatProfit(d.profit)}{d.profitPartial ? "*" : ""}
                        </span>
                      )}
                    </td>
                  )}
                  <td className="pr-season-box"><BoxScoreCell game={g} /></td>
                  <td className="pr-season-result"><ResultCell game={g} /></td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoxScoreCell({ game }: { game: SeasonHistoryGame }) {
  const ls = game.linescore;
  if (!ls) {
    return <span className="pr-na">{game.awayAbbr} @ {game.homeAbbr}</span>;
  }
  // Determine the widest single-inning cell width across both teams,
  // then pad. Keeps columns aligned even when a 10+ inning happens.
  const innings = ls.innings.slice(0, 9);
  let width = 1;
  for (const i of innings) {
    if (i.a != null) width = Math.max(width, String(i.a).length);
    if (i.h != null) width = Math.max(width, String(i.h).length);
  }
  const fmtCell = (v: number | null): string => (v == null ? "-".padStart(width) : String(v).padStart(width));
  const fmtInns = (side: "a" | "h"): string => {
    const cells: string[] = [];
    for (let i = 0; i < 9; i++) {
      const inn = innings[i];
      cells.push(fmtCell(inn ? (side === "a" ? inn.a : inn.h) : null));
    }
    // Group by threes (1-3, 4-6, 7-9) with spaces between groups only
    // when width > 1; otherwise a single space between the groups keeps
    // the line tight.
    const gap = width === 1 ? " " : "  ";
    return `${cells.slice(0,3).join(width === 1 ? "" : " ")}${gap}${cells.slice(3,6).join(width === 1 ? "" : " ")}${gap}${cells.slice(6,9).join(width === 1 ? "" : " ")}`;
  };
  const fmtTot = (t: { r: number | null; h: number | null; e: number | null }): string =>
    `${(t.r ?? 0).toString().padStart(2)} ${(t.h ?? 0).toString().padStart(2)} ${(t.e ?? 0).toString().padStart(1)}`;
  return (
    <span className="pr-linescore">
      <span className="pr-linescore-row">
        <span className="pr-linescore-team">{game.awayAbbr}</span>
        <span className="pr-linescore-inn">{fmtInns("a")}</span>
        <span className="pr-linescore-tot">{fmtTot(ls.away)}</span>
      </span>
      <span className="pr-linescore-row">
        <span className="pr-linescore-team">{game.homeAbbr}</span>
        <span className="pr-linescore-inn">{fmtInns("h")}</span>
        <span className="pr-linescore-tot">{fmtTot(ls.home)}</span>
      </span>
    </span>
  );
}

function ResultCell({ game }: { game: SeasonHistoryGame }) {
  if (!game.mlPick && !game.nrfiPick) return <span className="pr-na">—</span>;
  return (
    <span className="pr-result-stack">
      {game.mlPick && (
        <PlayCell
          badgeClass="pr-play-ml"
          strong={game.mlPick.strong}
          label={`${game.mlPick.label} ML${game.mlPick.dog ? " 🐕" : ""}`}
          hit={game.mlPick.hit}
        />
      )}
      {game.nrfiPick && (
        <PlayCell
          badgeClass="pr-play-nrfi"
          strong={game.nrfiPick.strong}
          label={game.nrfiPick.label}
          hit={game.nrfiPick.hit}
        />
      )}
    </span>
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
  odds,
}: {
  o: GamePredictionOutcome;
  win: WinPlay | null;
  nrfi: NrfiPlay | null;
  odds: DayOdds;
}) {
  const finalScore =
    o.awayScore !== null && o.homeScore !== null
      ? `${o.awayAbbr} ${o.awayScore} · ${o.homeAbbr} ${o.homeScore}`
      : <span className="pr-na">{o.status}</span>;

  const oddsCells: string[] = [];
  if (win && o.winCorrect !== null) {
    const mlOdds = odds.mlByGamePk.get(o.gamePk);
    const price = win.side === "away" ? mlOdds?.away : mlOdds?.home;
    oddsCells.push(price == null ? "—" : formatOdds(price));
  }
  if (nrfi && o.nrfiCorrect !== null) {
    const nrfiOdds = odds.nrfiByGamePk.get(o.gamePk);
    const price = nrfi.side === "NRFI" ? nrfiOdds?.nrfi : nrfiOdds?.yrfi;
    oddsCells.push(price == null ? "—" : formatOdds(price));
  }
  const { profit: totalProfit, partial: missingOdds } = pickProfit(o, win, nrfi, odds);

  return (
    <tr>
      <td>{finalScore}</td>
      <td className="pr-yesterday-play">
        {!win && !nrfi && <span className="pr-na">—</span>}
        {win && <PlayCell badgeClass="pr-play-ml" strong={win.strong} label={`${win.abbr} ML${win.dog ? " 🐕" : ""}`} hit={o.winCorrect} />}
        {nrfi && <PlayCell badgeClass="pr-play-nrfi" strong={nrfi.strong} label={nrfiSideLabel(nrfi.side)} hit={o.nrfiCorrect} />}
      </td>
      <td className="pr-yesterday-odds">
        {oddsCells.length === 0
          ? <span className="pr-na">—</span>
          : oddsCells.join(" / ")}
      </td>
      <td className="pr-yesterday-profit">
        {totalProfit === null
          ? <span className="pr-na">—</span>
          : <span className={totalProfit >= 0 ? "pr-profit-pos" : "pr-profit-neg"}>
              {formatProfit(totalProfit)}
            </span>}
        {missingOdds && totalProfit !== null && <span className="pr-profit-partial" title="Some odds missing">*</span>}
      </td>
    </tr>
  );
}

function formatProfit(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
function formatOdds(v: number): string {
  return v >= 0 ? `+${v}` : `${v}`;
}

/** $10/play P/L for one game's card picks against captured odds — used
 *  per-row and summed for the day total. `partial` = a picked side had no
 *  captured price (excluded from the sum). */
const YESTERDAY_STAKE = 10;
function pickProfit(
  o: GamePredictionOutcome,
  win: WinPlay | null,
  nrfi: NrfiPlay | null,
  odds: DayOdds,
): { profit: number | null; partial: boolean } {
  const profits: number[] = [];
  let partial = false;
  if (win && o.winCorrect !== null) {
    const price = win.side === "away" ? odds.mlByGamePk.get(o.gamePk)?.away : odds.mlByGamePk.get(o.gamePk)?.home;
    if (price == null) partial = true;
    else profits.push(o.winCorrect ? YESTERDAY_STAKE * americanToProfitMultiplier(price) : -YESTERDAY_STAKE);
  }
  if (nrfi && o.nrfiCorrect !== null) {
    const price = nrfi.side === "NRFI" ? odds.nrfiByGamePk.get(o.gamePk)?.nrfi : odds.nrfiByGamePk.get(o.gamePk)?.yrfi;
    if (price == null) partial = true;
    else profits.push(o.nrfiCorrect ? YESTERDAY_STAKE * americanToProfitMultiplier(price) : -YESTERDAY_STAKE);
  }
  return { profit: profits.length > 0 ? profits.reduce((a, b) => a + b, 0) : null, partial };
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
  // Outcome is coded two ways for colorblind safety: color (green/red)
  // AND strikethrough on misses. No ✓/✗ — the styling carries it.
  const outcomeClass = hit === true ? " pr-play-hit" : hit === false ? " pr-play-miss" : "";
  return (
    <span className="pr-play-cell">
      <span className={`pr-play-badge ${badgeClass}${strong ? " pr-play-strong" : ""}${outcomeClass}`}>{label}</span>
    </span>
  );
}

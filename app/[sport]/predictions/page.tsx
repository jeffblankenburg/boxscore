import { notFound } from "next/navigation";
import { todayInET, timeInET, prevDay, volumeNumber, issueNumber } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { loadPredictionsForDate } from "@/lib/sports/mlb/predictions-data";
import {
  selectDailyCard,
  cardCandidateFor,
  cardSize,
  type GamePrediction,
  type WinPlay,
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
import { headers } from "next/headers";
import { getSessionSubscriber } from "@/lib/subscriber-session";
import { hasPredictionsAccess } from "@/lib/predictions-entitlements";
import { canActivateTrial } from "@/lib/predictions-trial";
import { checkoutOpen } from "@/lib/predictions-checkout";
import { stripePublishableKey } from "@/lib/stripe";
import { sellableSkus, RECURRING_SKUS } from "@/lib/predictions-pricing";
import { PredictionsStorefront } from "./PredictionsStorefront";
import "./predictions.css";
import "./subscribe/subscribe.css";

// Per-subscriber paywall gating (session + entitlement) makes this dynamic.
// The heavy once-a-day computation still comes from the cached render blob
// (readPredictionsRenderBlob) — dynamic here only re-reads that blob + checks
// access, so it stays cheap. Today's PICKS are the paid surface; everything
// else (results, win %, season history) is public.
export const dynamic = "force-dynamic";

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
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ spw?: string }>;
}) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();
  const { spw } = await searchParams;

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
    [result, yesterdayOutcomes, rolling7, rolling30, rollingSeason, roi7, roi30, roiSeason] = await Promise.all([
      loadPredictionsForDate(today),
      loadPredictionOutcomesForDate(yesterday),
      loadPredictionAccuracy(7,          yesterday),
      loadPredictionAccuracy(30,         yesterday),
      loadPredictionAccuracy(seasonDays, yesterday),
      loadPlayRoi(7,          yesterday),
      loadPlayRoi(30,         yesterday),
      loadPlayRoi(seasonDays, yesterday),
    ]);
  }

  // Season Picks paginates by 7-day week, navigable via ?spw=<end ISO>.
  // Default window ends yesterday (the latest graded day). This is a cheap
  // read, loaded per request regardless of the blob so navigation works.
  const SEASON_FLOOR = `${today.slice(0, 4)}-03-26`; // first graded day of the season
  const winEndReq = spw && /^\d{4}-\d{2}-\d{2}$/.test(spw) ? spw : yesterday;
  const winEnd = winEndReq > yesterday ? yesterday : winEndReq;
  const winStart = shiftDays(winEnd, -(SEASON_PICKS_WEEK - 1));
  const weekDays = await loadSeasonHistory(winStart, winEnd);

  // 30-day profit calendar — an at-a-glance overview above the day-by-day
  // Season Picks. Public track record, shown to everyone.
  const calStart = shiftDays(yesterday, -(PROFIT_CAL_DAYS - 1));
  const calendarDays = await loadSeasonHistory(calStart, yesterday);
  const hasNewer = winEnd < yesterday;
  const newerEnd = hasNewer ? (shiftDays(winEnd, SEASON_PICKS_WEEK) > yesterday ? yesterday : shiftDays(winEnd, SEASON_PICKS_WEEK)) : null;
  const hasOlder = winStart > SEASON_FLOOR;
  const olderEnd = hasOlder ? shiftDays(winStart, -1) : null;

  // The card ranks by EV, which needs the day's lines. Those are captured
  // by the snapshot cron at 10:30 AM ET — before that, there are games but
  // no odds, so we show a "picks lock at" notice instead of provisional
  // picks that would change once the lines post.
  const picksPending = result.gameCount > 0 && todayOdds.mlByGamePk.size === 0;
  const plays = picksPending ? [] : buildTodaysPlays(result.games, todayOdds);

  // Paywall gating. The storefront (pricing + inline checkout) shows only when
  // checkout is open (the launch flag) AND the viewer isn't entitled — so
  // pre-launch the page stays fully public exactly as before. Today's PICKS
  // are the paid surface; everything below (results, win %, season history) is
  // public to everyone.
  const subscriber = await getSessionSubscriber();
  const entitled = subscriber ? await hasPredictionsAccess(subscriber.id, "mlb", today) : false;
  const isAdmin = subscriber?.isAdmin === true;
  const paywallActive = checkoutOpen();
  // Admins always see the picks (dogfood, like the picks-email cron) AND the
  // storefront (to preview the buy flow) — both, regardless of entitlement.
  const showTodaysPicks = !paywallActive || entitled || isAdmin;
  const showStorefront = paywallActive && (isAdmin || !entitled);
  // Eligible existing subscribers can self-activate a one-time free trial.
  const trialEligible = showStorefront && subscriber ? await canActivateTrial(subscriber.id) : false;

  const skus = sellableSkus(today).filter((s): s is "week" | "month" => s === "week" || s === "month");
  const plans = skus.map((sku) => {
    const cents = RECURRING_SKUS.find((r) => r.sku === sku)!.amountCents;
    return {
      sku,
      label: sku === "week" ? "Weekly" : "Monthly",
      priceLabel: `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`,
      sub: sku === "week" ? "7 days · cancel anytime" : "31 days · cancel anytime",
    };
  });
  const h = await headers();
  const host = h.get("host") ?? "boxscore.email";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const successUrl = `${proto}://${host}/mlb/predictions/subscribe/success`;

  return (
    <div className="pr-page">
      {/* Newspaper dateline, same band as the /mlb digest — double top rule,
          italic date, Vol./Issue. today is the games date, which matches the
          edition date /mlb shows, so the issue number lines up. */}
      <div className="dateline">
        <div className="dateline-row"><span className="dateline-text">{prettyDate(today)}</span></div>
        <div className="dateline-issue-no">Vol. {volumeNumber(today)}, Issue {issueNumber(today)}</div>
      </div>

      {showStorefront && (
        <PredictionsStorefront
          publishableKey={stripePublishableKey()}
          plans={plans}
          successUrl={successUrl}
          gameCount={result.gameCount}
          picksPending={picksPending}
          trialEligible={trialEligible}
        />
      )}

      {showTodaysPicks && <PlaysSection plays={plays} pending={picksPending} />}

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

      <ProfitCalendar days={calendarDays} startIso={calStart} endIso={yesterday} />

      <SeasonHistorySection
        days={weekDays}
        rangeStart={winStart}
        rangeEnd={winEnd}
        olderHref={olderEnd ? `?spw=${olderEnd}` : null}
        newerHref={newerEnd ? `?spw=${newerEnd}` : null}
      />
    </div>
  );
}

/** Build today's card: the top-EV ML plays, count = 20% of the slate.
 *  ML-only (NRFI dropped from the page). */
function buildTodaysPlays(
  games: GamePrediction[],
  todayOdds: DayOdds,
): Array<{ game: GamePrediction; win: WinPlay }> {
  if (games.length === 0) return [];

  const card = selectDailyCard(
    games.map((g) => cardCandidateFor(g.gamePk, g.away.winProbability, g.home.winProbability, todayOdds.mlByGamePk.get(g.gamePk))),
    cardSize(games.length),
  );
  const gameByPk = new Map(games.map((g) => [g.gamePk, g]));
  const rows: Array<{ game: GamePrediction; win: WinPlay }> = [];
  for (const p of card) {
    const game = gameByPk.get(p.gamePk);
    if (!game) continue;
    rows.push({
      game,
      win: { side: p.side, abbr: p.side === "home" ? game.home.abbr : game.away.abbr, winPct: p.winPct, strong: p.strong, dog: p.dog },
    });
  }
  return rows.sort((a, b) => a.game.startTime.localeCompare(b.game.startTime));
}

const PICKS_LOCK_LABEL = "10:30 AM ET";

function PlaysSection({
  plays,
  pending,
}: {
  plays: Array<{ game: GamePrediction; win: WinPlay }>;
  pending: boolean;
}) {
  return (
    <section className="pr-recap pr-framed">
      <h2 className="pr-recap-head">Today&apos;s Plays</h2>
      {pending ? (
        <p className="pr-recap-empty">
          Today&apos;s picks lock at <strong>{PICKS_LOCK_LABEL}</strong>, once the morning lines are set. Check back then.
        </p>
      ) : plays.length === 0 ? (
        <p className="pr-recap-empty">No games on the slate today.</p>
      ) : (
        <div className="pr-scroll">
          <table className="pr-recap-table pr-framed-table">
            <thead>
              <tr>
                <th className="pr-col-time">Time</th>
                <th>Matchup</th>
                <th className="pr-plays-play">Play</th>
              </tr>
            </thead>
            <tbody>
              {plays.map(({ game, win }) => (
                <tr key={game.gamePk}>
                  <td className="pr-col-time">{timeInET(game.startTime)}</td>
                  <td className="pr-pick-cell">
                    <a className="pr-team-link" href={teamHref(game.away.abbr)}>{game.away.abbr}</a>
                    {" @ "}
                    <a className="pr-team-link" href={teamHref(game.home.abbr)}>{game.home.abbr}</a>
                  </td>
                  <td className="pr-plays-play">
                    <span className="pr-play-plain">{win.abbr}{win.dog ? " 🐕" : ""}</span>
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
  // Same ML card as buildTodaysPlays / the stat loaders — graded against
  // yesterday's outcomes.
  const oByPk = new Map(outcomes.map((o) => [o.gamePk, o]));
  const card = selectDailyCard(
    outcomes.map((o) => cardCandidateFor(o.gamePk, o.awayWinPct, o.homeWinPct, odds.mlByGamePk.get(o.gamePk))),
    cardSize(outcomes.length),
  );
  const playedRows: Array<{ o: GamePredictionOutcome; win: WinPlay }> = [];
  for (const p of card) {
    const o = oByPk.get(p.gamePk);
    if (!o) continue;
    playedRows.push({ o, win: { side: p.side, abbr: p.side === "home" ? o.homeAbbr : o.awayAbbr, winPct: p.winPct, strong: p.strong, dog: p.dog } });
  }
  playedRows.sort((a, b) => a.o.gamePk - b.o.gamePk);

  if (playedRows.length === 0) return null;

  // Day total P/L across the card's priced picks.
  let dayTotal = 0, priced = 0, anyPartial = false;
  for (const { o, win } of playedRows) {
    const { profit, partial } = pickProfit(o, win, odds);
    if (profit !== null) { dayTotal += profit; priced++; }
    if (partial) anyPartial = true;
  }

  return (
    <section className="pr-recap pr-yesterday pr-framed">
      <h2 className="pr-recap-head">Results for {weekdayMonthDay(yesterday)}</h2>
      <div className="pr-scroll">
        <table className="pr-recap-table pr-yesterday-table pr-framed-table">
          <thead>
            <tr>
              <th>Final</th>
              <th>Play</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {playedRows.map(({ o, win }) => (
              <YesterdayRow key={o.gamePk} o={o} win={win} odds={odds} />
            ))}
          </tbody>
          {priced > 0 && (
            <tfoot>
              <tr className="pr-yesterday-total">
                <td colSpan={2}>{longMonthDay(yesterday)} Total</td>
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
  const hasAny = rolling30.mlPlays > 0 || rolling7.mlPlays > 0;
  if (!hasAny) return null;

  const rows: Array<{ label: string; s: PlayAccuracySummary; roi: PlayRoiSummary | null }> = [
    { label: "Last 7", s: rolling7, roi: roi7 },
    { label: "Last 30", s: rolling30, roi: roi30 },
    ...(rollingSeason ? [{ label: "Season", s: rollingSeason, roi: roiSeason }] : []),
  ];

  return (
    <section className="pr-recap pr-framed">
      <h2 className="pr-recap-head">Win Percentages</h2>
      <table className="pr-recap-table pr-winpct-table pr-framed-table">
        <thead>
          <tr>
            <th>Window</th>
            <th>Hit</th>
            <th>Record</th>
            <th>Profit</th>
            <th>ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, s, roi }) => {
            const priced = roi && roi.mlPlaysWithOdds > 0;
            const pl = priced ? (roi!.mlProfit >= 0 ? "pr-profit-pos" : "pr-profit-neg") : "";
            return (
              <tr key={label}>
                <td>{label}</td>
                <td className="pr-winpct-num pr-winpct-hit">{pctOrDash(s.mlHitRate)}</td>
                <td className="pr-winpct-num">{s.mlPlays > 0 ? `${s.mlPlayHits}/${s.mlPlays}` : "—"}</td>
                <td className="pr-winpct-num">
                  {priced ? <span className={pl}>{formatDollarWhole(roi!.mlProfit)}</span> : "—"}
                </td>
                <td className="pr-winpct-num">
                  {priced ? <span className={pl}>{formatPctSigned(roi!.mlRoi)}</span> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="pr-caption">Profit and ROI assume a flat $10 moneyline wager per pick.</p>
    </section>
  );
}

function formatPctSigned(v: number | null): string {
  if (v == null) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${(Math.abs(v) * 100).toFixed(1)}%`;
}
/** Whole-dollar P/L, e.g. +$947 — compact enough for the 5-column Win%
 *  table at 400px (the cents live in the day totals). */
function formatDollarWhole(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.round(Math.abs(v))}`;
}

const SEASON_PICKS_WEEK = 7;
const PROFIT_CAL_DAYS = 30;

/** Shift an ISO date by n days (UTC). */
function shiftDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Weekday index (0=Sun) of an ISO date, in UTC. */
function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const CAL_DOW = ["S", "M", "T", "W", "T", "F", "S"];

/** A month-style grid of the last PROFIT_CAL_DAYS days, each cell tinted by the
 *  day's $10/play P/L — an at-a-glance overview above the day-by-day results. */
function ProfitCalendar({ days, startIso, endIso }: { days: SeasonHistoryDay[]; startIso: string; endIso: string }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  // Pad the window out to whole Sun–Sat weeks so the grid is rectangular.
  const gridStart = shiftDays(startIso, -weekdayOf(startIso));
  const gridEnd = shiftDays(endIso, 6 - weekdayOf(endIso));
  const cells: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = shiftDays(d, 1)) cells.push(d);
  const weeks: string[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">Last 30 Days</h2>
      <div className="pr-cal">
        <div className="pr-cal-row pr-cal-dow-row">
          {CAL_DOW.map((w, i) => <div key={i} className="pr-cal-dow">{w}</div>)}
        </div>
        {weeks.map((week) => (
          <div className="pr-cal-row" key={week[0]}>
            {week.map((date) => {
              const inRange = date >= startIso && date <= endIso;
              const day = inRange ? byDate.get(date) : undefined;
              const hasProfit = !!day && day.profit !== null;
              const cls = hasProfit ? (day!.profit! >= 0 ? "pr-cal-pos" : "pr-cal-neg") : inRange ? "pr-cal-in" : "pr-cal-out";
              return (
                <div className={`pr-cal-cell ${cls}`} key={date}>
                  {inRange && <span className="pr-cal-dom">{Number(date.slice(8, 10))}</span>}
                  {hasProfit && <span className="pr-cal-amt">{formatDollarWhole(day!.profit!)}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="pr-caption">Daily P/L, flat $10 per moneyline pick.</p>
    </section>
  );
}

function SeasonHistorySection({
  days,
  rangeStart,
  rangeEnd,
  olderHref,
  newerHref,
}: {
  days: SeasonHistoryDay[];
  rangeStart: string;
  rangeEnd: string;
  olderHref: string | null;
  newerHref: string | null;
}) {
  return (
    <section className="pr-recap">
      <h2 className="pr-recap-head">Season Picks</h2>
      <nav className="pr-week-nav">
        {olderHref
          ? <a className="pr-week-link" href={olderHref}>‹ Older</a>
          : <span className="pr-week-link pr-week-off">‹ Older</span>}
        <span className="pr-week-range">{shortDate(rangeStart)} – {shortDate(rangeEnd)}</span>
        {newerHref
          ? <a className="pr-week-link" href={newerHref}>Newer ›</a>
          : <span className="pr-week-link pr-week-off">Newer ›</span>}
      </nav>
      {days.length === 0 ? (
        <p className="pr-recap-empty">No graded picks this week.</p>
      ) : days.map((d) => (
        <div className="pr-day" key={d.date}>
          <div className="pr-day-head">
            <span className="pr-day-date">{weekdayMonthDay(d.date)}</span>
            {d.profit !== null && (
              <span className={d.profit >= 0 ? "pr-profit-pos" : "pr-profit-neg"}>
                {formatProfit(d.profit)}{d.profitPartial ? "*" : ""}
              </span>
            )}
          </div>
          {d.games.map((g) => (
            <div
              className={`pr-game${g.mlPick?.hit === true ? " pr-game-won" : g.mlPick?.hit === false ? " pr-game-lost" : ""}`}
              key={g.gamePk}
            >
              <a className="pr-box-link" href={`/mlb/${d.date}`}>
                <BoxScoreLine game={g} />
                {g.mlPick && (
                  <div className="pr-pick">
                    <span className={`pr-pick-team ${g.mlPick.hit === true ? "pr-play-hit" : g.mlPick.hit === false ? "pr-play-miss" : ""}`}>
                      {g.mlPick.label}{g.mlPick.dog ? " 🐕" : ""}
                    </span>
                    {g.mlPick.profit != null && (
                      <span className={`pr-pick-pl ${g.mlPick.profit >= 0 ? "pr-profit-pos" : "pr-profit-neg"}`}>{formatProfit(g.mlPick.profit)}</span>
                    )}
                  </div>
                )}
              </a>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** Full-width linescore beneath a game — team | innings | R H E. Handles
 *  up to 12 innings and 2-digit values; each column padded to its widest
 *  value so away/home align. */
function BoxScoreLine({ game }: { game: SeasonHistoryGame }) {
  const ls = game.linescore;
  if (!ls) return null;
  const count = Math.min(12, Math.max(9, ls.innings.length));
  const innings = ls.innings.slice(0, count);
  let w = 1;
  for (const i of innings) {
    if (i.a != null) w = Math.max(w, String(i.a).length);
    if (i.h != null) w = Math.max(w, String(i.h).length);
  }
  const cell = (v: number | null): string => (v == null ? "·".padStart(w) : String(v).padStart(w));
  const innRow = (side: "a" | "h"): string => {
    const cells: string[] = [];
    for (let i = 0; i < count; i++) {
      const inn = innings[i];
      cells.push(cell(inn ? (side === "a" ? inn.a : inn.h) : null));
    }
    const groups: string[] = [];
    for (let i = 0; i < cells.length; i += 3) groups.push(cells.slice(i, i + 3).join(" "));
    return groups.join("  ");
  };
  const tot = (t: { r: number | null; h: number | null; e: number | null }): string =>
    `${String(t.r ?? 0).padStart(2)} ${String(t.h ?? 0).padStart(2)} ${String(t.e ?? 0).padStart(2)}`;
  return (
    <div className="pr-linescore">
      <div className="pr-linescore-row">
        <span className="pr-linescore-team">{game.awayAbbr}</span>
        <span className="pr-linescore-inn">{innRow("a")}</span>
        <span className="pr-linescore-tot">{tot(ls.away)}</span>
      </div>
      <div className="pr-linescore-row">
        <span className="pr-linescore-team">{game.homeAbbr}</span>
        <span className="pr-linescore-inn">{innRow("h")}</span>
        <span className="pr-linescore-tot">{tot(ls.home)}</span>
      </div>
    </div>
  );
}

function longMonthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}
/** "Jul 23" — short month + day, for compact ranges. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
/** "Thursday, July 23" — weekday + month + day, no year. */
function weekdayMonthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

function YesterdayRow({
  o,
  win,
  odds,
}: {
  o: GamePredictionOutcome;
  win: WinPlay;
  odds: DayOdds;
}) {
  const finalScore =
    o.awayScore !== null && o.homeScore !== null
      ? `${o.awayAbbr} ${o.awayScore} · ${o.homeAbbr} ${o.homeScore}`
      : <span className="pr-na">{o.status}</span>;

  const { profit: totalProfit, partial: missingOdds } = pickProfit(o, win, odds);

  return (
    <tr>
      <td>{finalScore}</td>
      <td className="pr-yesterday-play">
        <PlayCell badgeClass="pr-play-ml" strong={win.strong} label={`${win.abbr}${win.dog ? " 🐕" : ""}`} hit={o.winCorrect} />
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

/** $10 P/L for one game's ML card pick against the captured price — used
 *  per-row and summed for the day total. `partial` = the pick had no
 *  captured price (excluded from the sum). */
const YESTERDAY_STAKE = 10;
function pickProfit(
  o: GamePredictionOutcome,
  win: WinPlay,
  odds: DayOdds,
): { profit: number | null; partial: boolean } {
  const profits: number[] = [];
  let partial = false;
  if (o.winCorrect !== null) {
    const price = win.side === "away" ? odds.mlByGamePk.get(o.gamePk)?.away : odds.mlByGamePk.get(o.gamePk)?.home;
    if (price == null) partial = true;
    else profits.push(o.winCorrect ? YESTERDAY_STAKE * americanToProfitMultiplier(price) : -YESTERDAY_STAKE);
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

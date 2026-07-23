import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { yesterdayInET, todayInET, isValidIsoDate } from "@/lib/dates";
import {
  rebuildPredictionsRenderCache,
  warmPredictionsPage,
} from "@/lib/sports/mlb/predictions-cache";
import { siteOrigin } from "@/lib/site";
import { mlClv, nrfiClv } from "@/lib/sports/mlb/clv";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Bits of daily_raw.payload we read for scoring.
type DailyRawLineInning = { num?: number; home?: { runs?: number }; away?: { runs?: number } };
type DailyRawLineTeam   = { runs?: number; hits?: number; errors?: number };
type DailyRawScheduleGame = {
  gamePk?: number;
  gameDate?: string;                                          // ISO UTC; scheduled first pitch
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: {
    away?: { score?: number; team?: { id?: number } };
    home?: { score?: number; team?: { id?: number } };
  };
  linescore?: {
    innings?: DailyRawLineInning[];
    teams?: {
      away?: DailyRawLineTeam;
      home?: DailyRawLineTeam;
    };
  };
};
type DailyRawSchedule = {
  dates?: Array<{ games?: DailyRawScheduleGame[] }>;
};

type DailyRawBoxLinescore = {
  innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
};
type DailyRawBoxGame = {
  boxscore?: {
    teams?: {
      away?: { teamStats?: { batting?: { runs?: number } } };
      home?: { teamStats?: { batting?: { runs?: number } } };
    };
  };
  scoringPlays?: unknown;
  linescore?: DailyRawBoxLinescore;
};

// Full linescore shape written into prediction_results.linescore. Matches
// SeasonHistoryLinescore in lib/sports/mlb/predictions-history.ts, which
// is what the /mlb/predictions Season Picks table reads. Before this,
// only scripts/backfill-prediction-linescore.ts populated the column —
// so days after the last manual backfill run rendered as "AWAY @ HOME"
// with no box score (observed 7/5: null linescores from 7/1 onward).
// Now the comparator writes it on every scoring pass.
type Linescore = {
  innings: Array<{ a: number | null; h: number | null }>;
  away: { r: number | null; h: number | null; e: number | null };
  home: { r: number | null; h: number | null; e: number | null };
};

type GameOutcome = {
  status: string;
  awayScore: number | null;
  homeScore: number | null;
  awayFirstInning: number | null;
  homeFirstInning: number | null;
  linescore: Linescore | null;
};

function extractLinescore(scheduleGame: DailyRawScheduleGame): Linescore | null {
  const ls = scheduleGame.linescore;
  if (!ls) return null;
  const innings = (ls.innings ?? []).map((i) => ({
    a: typeof i.away?.runs === "number" ? i.away.runs : null,
    h: typeof i.home?.runs === "number" ? i.home.runs : null,
  }));
  const away = {
    r: ls.teams?.away?.runs   ?? null,
    h: ls.teams?.away?.hits   ?? null,
    e: ls.teams?.away?.errors ?? null,
  };
  const home = {
    r: ls.teams?.home?.runs   ?? null,
    h: ls.teams?.home?.hits   ?? null,
    e: ls.teams?.home?.errors ?? null,
  };
  if (innings.length === 0 && away.r === null && home.r === null) return null;
  return { innings, away, home };
}

function gameOutcomeFromRaw(
  gamePk: number,
  schedule: DailyRawSchedule | undefined,
  games: Record<string, DailyRawBoxGame> | undefined,
): GameOutcome | null {
  const scheduleGame = (schedule?.dates ?? [])
    .flatMap((d) => d.games ?? [])
    .find((g) => g.gamePk === gamePk);
  if (!scheduleGame) return null;
  const status = scheduleGame.status?.detailedState
    ?? scheduleGame.status?.abstractGameState
    ?? "unknown";
  const awayScore = scheduleGame.teams?.away?.score ?? null;
  const homeScore = scheduleGame.teams?.home?.score ?? null;

  // First inning runs — prefer schedule linescore.innings (always present
  // on final games), fall back to per-game box payload.
  let inning1Away: number | null = null;
  let inning1Home: number | null = null;
  const innings = scheduleGame.linescore?.innings
    ?? games?.[String(gamePk)]?.linescore?.innings;
  if (Array.isArray(innings)) {
    const first = innings.find((i) => i.num === 1);
    if (first) {
      inning1Away = typeof first.away?.runs === "number" ? first.away.runs : null;
      inning1Home = typeof first.home?.runs === "number" ? first.home.runs : null;
    }
  }
  return {
    status, awayScore, homeScore,
    awayFirstInning: inning1Away,
    homeFirstInning: inning1Home,
    linescore: extractLinescore(scheduleGame),
  };
}

type PredictionRow = {
  sport: string;
  date: string;
  game_pk: number;
  model_version: string;
  away_win_pct: number;
  home_win_pct: number;
  nrfi_pct: number;
};

type DailyRawPayload = {
  schedule?: DailyRawSchedule;
  games?: Record<string, DailyRawBoxGame>;
};

function scoreOne(pred: PredictionRow, outcome: GameOutcome) {
  const isFinal = outcome.status.toLowerCase().includes("final");
  let actual_winner: "away" | "home" | null = null;
  let win_correct: boolean | null = null;
  let win_brier: number | null = null;
  let actual_nrfi: boolean | null = null;
  let nrfi_correct: boolean | null = null;
  let nrfi_brier: number | null = null;

  if (isFinal && outcome.awayScore !== null && outcome.homeScore !== null && outcome.awayScore !== outcome.homeScore) {
    actual_winner = outcome.homeScore > outcome.awayScore ? "home" : "away";
    const predictedFavorite = pred.home_win_pct > pred.away_win_pct ? "home" : "away";
    win_correct = actual_winner === predictedFavorite;
    const homeWon = actual_winner === "home" ? 1 : 0;
    win_brier = Math.pow(pred.home_win_pct - homeWon, 2);
  }
  if (
    isFinal
    && outcome.awayFirstInning !== null
    && outcome.homeFirstInning !== null
  ) {
    actual_nrfi = (outcome.awayFirstInning + outcome.homeFirstInning) === 0;
    const predictedNrfi = pred.nrfi_pct >= 0.5;
    nrfi_correct = predictedNrfi === actual_nrfi;
    const nrfiHappened = actual_nrfi ? 1 : 0;
    nrfi_brier = Math.pow(pred.nrfi_pct - nrfiHappened, 2);
  }
  return { actual_winner, win_correct, win_brier, actual_nrfi, nrfi_correct, nrfi_brier };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const sport = url.searchParams.get("sport") ?? "mlb";
  const date = url.searchParams.get("date") ?? yesterdayInET();
  if (sport !== "mlb") {
    return NextResponse.json({ error: `no comparator for sport=${sport}` }, { status: 501 });
  }
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // 1. Pull predictions for the target date.
  const { data: preds } = await sb
    .from("daily_predictions")
    .select("sport, date, game_pk, model_version, away_win_pct, home_win_pct, nrfi_pct")
    .eq("sport", sport)
    .eq("date", date);
  if (!preds || preds.length === 0) {
    return NextResponse.json({ ok: true, date, scored: 0, note: "no predictions for date" });
  }

  // 2. Pull that date's daily_raw — has the schedule (with linescore) and
  //    boxscores we need to compute outcomes.
  const { data: rawRows } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", sport)
    .eq("date", date)
    .limit(1);
  const payload = (rawRows?.[0]?.payload as DailyRawPayload | undefined) ?? {};

  // 2b. Derive open + close prices per game from daily_odds (append-only
  // since migration 0071). "Open" = earliest capture per (game, book);
  // "close" = latest capture whose captured_at is still strictly BEFORE
  // that game's scheduled first pitch (from schedule.gameDate). This is
  // the sharp definition — we want the market's last word on the game
  // before it locked, not any capture that happened after first pitch
  // (which would be a delisted or in-play line for the afternoon slate).
  // ML lines from ESPN→DraftKings; NRFI from FanDuel.
  type OddsCaptureRow = {
    game_pk: number;
    book: string;
    captured_at: string;
    away_ml_odds: number | null;
    home_ml_odds: number | null;
    nrfi_odds: number | null;
    yrfi_odds: number | null;
  };
  const { data: oddsCaptures } = await sb.from("daily_odds")
    .select("game_pk, book, captured_at, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds")
    .eq("sport", sport).eq("date", date)
    .in("book", ["DraftKings", "FanDuel"])
    .order("captured_at", { ascending: true });

  // Build first-pitch time per gamePk from the schedule payload. Games
  // without a gameDate (rare — mostly stub rows for TBD reschedules)
  // treat "close" as "any capture on this date" i.e. we fall back to the
  // latest capture regardless of time.
  const firstPitchByPk = new Map<number, number>();      // gamePk → epoch ms
  for (const scheduleDate of payload.schedule?.dates ?? []) {
    for (const g of scheduleDate.games ?? []) {
      if (typeof g.gamePk === "number" && typeof g.gameDate === "string") {
        const ms = Date.parse(g.gameDate);
        if (Number.isFinite(ms)) firstPitchByPk.set(g.gamePk, ms);
      }
    }
  }

  type OddsPickPerBook = {
    open: OddsCaptureRow | null;
    close: OddsCaptureRow | null;
  };
  const perGameByBook = new Map<number, { DraftKings: OddsPickPerBook; FanDuel: OddsPickPerBook }>();
  for (const cap of ((oddsCaptures ?? []) as OddsCaptureRow[])) {
    if (cap.book !== "DraftKings" && cap.book !== "FanDuel") continue;
    let entry = perGameByBook.get(cap.game_pk);
    if (!entry) {
      entry = {
        DraftKings: { open: null, close: null },
        FanDuel:    { open: null, close: null },
      };
      perGameByBook.set(cap.game_pk, entry);
    }
    const slot = entry[cap.book as "DraftKings" | "FanDuel"];
    // Rows are pre-sorted by captured_at ASC, so the FIRST match sets
    // open and any later match overwrites close — as long as it's still
    // before first pitch (or unbounded when we lack a first-pitch time).
    if (slot.open === null) slot.open = cap;
    const capMs = Date.parse(cap.captured_at);
    const pitchMs = firstPitchByPk.get(cap.game_pk) ?? Number.POSITIVE_INFINITY;
    if (Number.isFinite(capMs) && capMs < pitchMs) slot.close = cap;
  }

  function pickForGame(gp: number) {
    const entry = perGameByBook.get(gp);
    const dkOpen  = entry?.DraftKings.open  ?? null;
    const dkClose = entry?.DraftKings.close ?? null;
    const fdOpen  = entry?.FanDuel.open     ?? null;
    const fdClose = entry?.FanDuel.close    ?? null;
    return {
      open_away_ml_odds:  dkOpen?.away_ml_odds  ?? null,
      open_home_ml_odds:  dkOpen?.home_ml_odds  ?? null,
      close_away_ml_odds: dkClose?.away_ml_odds ?? null,
      close_home_ml_odds: dkClose?.home_ml_odds ?? null,
      open_nrfi_odds:  fdOpen?.nrfi_odds  ?? null,
      open_yrfi_odds:  fdOpen?.yrfi_odds  ?? null,
      close_nrfi_odds: fdClose?.nrfi_odds ?? null,
      close_yrfi_odds: fdClose?.yrfi_odds ?? null,
    };
  }

  // 3. Score each prediction and upsert.
  const rows = preds.map((p) => {
    const odds = pickForGame(p.game_pk);
    const outcome = gameOutcomeFromRaw(p.game_pk, payload.schedule, payload.games);
    if (!outcome) {
      return {
        ...p,
        status: "missing",
        away_score: null, home_score: null,
        away_first_inning: null, home_first_inning: null,
        actual_winner: null, actual_nrfi: null,
        win_correct: null, nrfi_correct: null,
        win_brier: null, nrfi_brier: null,
        linescore: null,
        ...odds,
      };
    }
    const derived = scoreOne(p, outcome);
    return {
      ...p,
      status: outcome.status,
      away_score: outcome.awayScore,
      home_score: outcome.homeScore,
      away_first_inning: outcome.awayFirstInning,
      home_first_inning: outcome.homeFirstInning,
      linescore: outcome.linescore,
      ...derived,
      ...odds,
    };
  });

  const { error } = await sb
    .from("prediction_results")
    .upsert(rows, { onConflict: "sport,date,game_pk,model_version" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Grade the daily card (daily_picks) for this date — every card_version
  // present, same policy as grading every model_version. Graded price is
  // closing preferred / opening fallback: closing is what a subscriber
  // could actually still get near lock, opening is better than dropping
  // the pick from ROI when the poll missed the close. Non-fatal.
  let cardGraded = 0, cardHits = 0;
  let cardError: string | null = null;
  try {
    type PickRow = { game_pk: number; market: string; subject: string; card_version: string; side: string };
    const { data: pickRows } = await sb
      .from("daily_picks")
      .select("game_pk, market, subject, card_version, side")
      .eq("sport", sport)
      .eq("date", date);
    for (const p of ((pickRows ?? []) as PickRow[])) {
      const outcome = gameOutcomeFromRaw(p.game_pk, payload.schedule, payload.games);
      const odds = pickForGame(p.game_pk);
      let won: boolean | null = null;
      let gradedOdds: number | null = null;
      if (outcome && outcome.status.toLowerCase().includes("final")) {
        if (p.market === "ML" && outcome.awayScore !== null && outcome.homeScore !== null && outcome.awayScore !== outcome.homeScore) {
          won = (outcome.homeScore > outcome.awayScore) === (p.side === "home");
          gradedOdds = odds.close_home_ml_odds ?? odds.open_home_ml_odds;
        }
        if (p.market === "NRFI" && outcome.awayFirstInning !== null && outcome.homeFirstInning !== null) {
          const actualNrfi = outcome.awayFirstInning + outcome.homeFirstInning === 0;
          won = actualNrfi === (p.side === "NRFI");
          gradedOdds = p.side === "NRFI"
            ? (odds.close_nrfi_odds ?? odds.open_nrfi_odds)
            : (odds.close_yrfi_odds ?? odds.open_yrfi_odds);
        }
      }
      const { error: gradeErr } = await sb
        .from("daily_picks")
        .update({
          status: outcome?.status ?? "missing",
          won,
          odds_american: gradedOdds,
          graded_at: new Date().toISOString(),
        })
        .eq("sport", sport).eq("date", date).eq("game_pk", p.game_pk)
        .eq("market", p.market).eq("subject", p.subject).eq("card_version", p.card_version);
      if (gradeErr) {
        console.warn(`[predictions-comparator] card grade ${date}/${p.game_pk}/${p.market} failed: ${gradeErr.message}`);
        continue;
      }
      if (won !== null) { cardGraded++; if (won) cardHits++; }
    }
  } catch (e) {
    cardError = (e as Error).message;
    console.warn(`[predictions-comparator] card grading failed: ${cardError}`);
  }

  // Linescore self-heal. Since 2026-07-05 the comparator writes the
  // linescore JSONB inline on every scoring pass, but rows scored before
  // that day (and rows the pre-2026-07-05 comparator wrote for the days
  // 07-01/07-03/07-04 without linescore) still show `null` on the Season
  // Picks table on /mlb/predictions. Scan the last 7 days for any row
  // with null linescore, fetch each date's daily_raw once, and update.
  // Bounded work — the null-set gets smaller over time and eventually
  // this heal becomes a no-op.
  let healedCount = 0;
  try {
    const healStart = new Date(date + "T00:00:00Z");
    healStart.setUTCDate(healStart.getUTCDate() - 7);
    const healStartIso = healStart.toISOString().slice(0, 10);
    const { data: healRows } = await sb.from("prediction_results")
      .select("date, game_pk")
      .eq("sport", sport)
      .gte("date", healStartIso)
      .lte("date", date)
      .is("linescore", null);
    const nullByDate = new Map<string, number[]>();
    for (const r of (healRows ?? []) as Array<{ date: string; game_pk: number }>) {
      const list = nullByDate.get(r.date) ?? [];
      list.push(r.game_pk);
      nullByDate.set(r.date, list);
    }
    for (const [healDate, gamePks] of nullByDate) {
      // The date we're currently scoring already used its daily_raw in
      // the main pass — no need to re-fetch. For prior days pull once
      // per date.
      let healPayload: DailyRawPayload = payload;
      if (healDate !== date) {
        const { data: healRaw } = await sb.from("daily_raw")
          .select("payload").eq("sport", sport).eq("date", healDate).limit(1);
        healPayload = (healRaw?.[0]?.payload as DailyRawPayload | undefined) ?? {};
      }
      for (const gamePk of gamePks) {
        const scheduleGame = (healPayload.schedule?.dates ?? [])
          .flatMap((d) => d.games ?? [])
          .find((g) => g.gamePk === gamePk);
        if (!scheduleGame) continue;
        const ls = extractLinescore(scheduleGame);
        if (!ls) continue;
        const { error: updateErr } = await sb.from("prediction_results")
          .update({ linescore: ls })
          .eq("sport", sport)
          .eq("date", healDate)
          .eq("game_pk", gamePk);
        if (updateErr) {
          console.warn(`[predictions-comparator] heal ${healDate}/${gamePk} failed: ${updateErr.message}`);
          continue;
        }
        healedCount++;
      }
    }
  } catch (e) {
    // Heal is best-effort — a failure here shouldn't fail the whole cron.
    console.warn(`[predictions-comparator] linescore heal failed: ${(e as Error).message}`);
  }

  // Quick rollup so the cron logs convey what happened.
  const final = rows.filter((r) => r.win_correct !== null);
  const winHits = final.filter((r) => r.win_correct).length;
  const nrfiFinal = rows.filter((r) => r.nrfi_correct !== null);
  const nrfiHits = nrfiFinal.filter((r) => r.nrfi_correct).length;

  // CLV rollup. Per-side de-vigged CLV in probability points; positive
  // = we took a better price than the market closed at. We report the
  // ML CLV averaged across the home-picked side (predictions.ts always
  // picks home when it plays ML; see winPlayFor) and the NRFI CLV
  // averaged across whichever side we picked (nrfi_pct >= 0.5 → NRFI,
  // else YRFI). Games missing either open or close odds are excluded
  // from the denominator. Uses ALL games on the slate, not just plays
  // that cleared threshold, because CLV is a MODEL-level signal — the
  // question "does our probability move in the market's direction?" is
  // meaningful even on games we wouldn't have bet.
  let mlClvCount = 0, mlClvSum = 0;
  let nrfiClvCount = 0, nrfiClvSum = 0;
  for (const r of rows) {
    const ml = mlClv({
      openAwayOdds:  r.open_away_ml_odds,
      openHomeOdds:  r.open_home_ml_odds,
      closeAwayOdds: r.close_away_ml_odds,
      closeHomeOdds: r.close_home_ml_odds,
    });
    // We pick the model's favored side. Home when home_win_pct > 0.5,
    // else away. (winPlayFor picks the home side above threshold; for
    // rollup we want the modeled favorite regardless of threshold.)
    const mlSide = Number(r.home_win_pct) >= 0.5 ? ml.home : ml.away;
    if (mlSide !== null) { mlClvSum += mlSide; mlClvCount++; }

    const nrfi = nrfiClv({
      openNrfiOdds:  r.open_nrfi_odds,
      openYrfiOdds:  r.open_yrfi_odds,
      closeNrfiOdds: r.close_nrfi_odds,
      closeYrfiOdds: r.close_yrfi_odds,
    });
    const nrfiSide = Number(r.nrfi_pct) >= 0.5 ? nrfi.nrfi : nrfi.yrfi;
    if (nrfiSide !== null) { nrfiClvSum += nrfiSide; nrfiClvCount++; }
  }
  const mlClvAvg   = mlClvCount   > 0 ? mlClvSum   / mlClvCount   : null;
  const nrfiClvAvg = nrfiClvCount > 0 ? nrfiClvSum / nrfiClvCount : null;

  // Refresh the /mlb/predictions render cache for TODAY, bust the
  // route cache, and warm it with a real request so the cron itself
  // performs the first-hit render. Real visitors only see fully
  // cached HTML.
  let cacheError: string | null = null;
  let warm: Awaited<ReturnType<typeof warmPredictionsPage>> | null = null;
  try {
    await rebuildPredictionsRenderCache(todayInET());
    revalidatePath("/mlb/predictions");
    const origin = await siteOrigin();
    warm = await warmPredictionsPage(origin);
    if (!warm.ok) {
      console.error(`[predictions-comparator] warm-fetch ${warm.status ?? "—"} after ${warm.durationMs}ms: ${warm.error ?? "non-2xx"}`);
    }
  } catch (e) {
    cacheError = (e as Error).message;
    console.error(`[predictions-comparator] cache rebuild failed: ${cacheError}`);
  }

  return NextResponse.json({
    ok: true,
    date,
    scored: rows.length,
    finals: final.length,
    win_accuracy: final.length > 0 ? winHits / final.length : null,
    nrfi_accuracy: nrfiFinal.length > 0 ? nrfiHits / nrfiFinal.length : null,
    ml_clv_pp: mlClvAvg,
    ml_clv_n: mlClvCount,
    nrfi_clv_pp: nrfiClvAvg,
    nrfi_clv_n: nrfiClvCount,
    card_graded: cardGraded,
    card_hits: cardHits,
    ...(cardError ? { card_error: cardError } : {}),
    linescore_healed: healedCount,
    ...(cacheError ? { cache_error: cacheError } : {}),
    ...(warm ? { warm_status: warm.status, warm_ms: warm.durationMs } : {}),
  });
}

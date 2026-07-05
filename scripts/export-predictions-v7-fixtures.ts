// One-off exporter that dumps CSVs for the v7 predictions fit + backtest
// work into docs/predictions-v7/fixtures/. Rerun any time you want a
// fresh snapshot; each output is fully rewritten.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/export-predictions-v7-fixtures.ts
//
// Outputs (all CSV, header row first):
//   linescores_2024.csv           gamePk, date, inning, half, runs
//   linescores_2025.csv           gamePk, date, inning, half, runs
//   linescores_2026.csv           gamePk, date, inning, half, runs      (from daily_raw)
//   daily_predictions.csv         sport, date, game_pk, model_version, away_team_id, home_team_id, away_win_pct, home_win_pct, nrfi_pct, inputs_json
//   prediction_results.csv        sport, date, game_pk, model_version, status, away_score, home_score, away_first_inning, home_first_inning, actual_winner, actual_nrfi, win_correct, nrfi_correct, win_brier, nrfi_brier, open_away_ml_odds, open_home_ml_odds, open_nrfi_odds, open_yrfi_odds, close_away_ml_odds, close_home_ml_odds, close_nrfi_odds, close_yrfi_odds
//   daily_odds_first.csv          sport, date, game_pk, book, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds, captured_at
//
// The 2024/2025 linescores come from historical_games + historical_boxscores.
// The 2026 linescores come from daily_raw (this season is still in progress
// so it hasn't been rolled into historical_* yet).

import { promises as fs } from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "../lib/supabase";

const OUT_DIR = path.resolve(process.cwd(), "docs/predictions-v7/fixtures");
const PAGE = 1000;

async function ensureOutDir() {
  await fs.mkdir(OUT_DIR, { recursive: true });
}

// PostgREST has a 1000-row default cap even on a plain range query, and
// unfiltered `.select()` silently returns only that first page. Every
// export in this file paginates explicitly.
async function paginate<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : (typeof v === "object" ? JSON.stringify(v) : String(v));
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replaceAll("\"", "\"\"")}"`;
  }
  return s;
}

async function writeCsv(filename: string, header: string[], rows: unknown[][]) {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  await fs.writeFile(path.join(OUT_DIR, filename), lines.join("\n") + "\n");
  console.log(`  wrote ${filename}: ${rows.length} rows`);
}

// ─── Linescores: 2024, 2025 (historical) ──────────────────────────────

type HistoricalGameRef = { game_pk: number; game_date: string };
type LinescoreRow = { game_pk: number; linescore_raw: unknown };
type StatsapiInning = { num?: number; away?: { runs?: number }; home?: { runs?: number } };
type StatsapiLinescore = { innings?: StatsapiInning[] };

async function exportHistoricalLinescoresForSeason(season: number) {
  const sb = supabaseAdmin();
  console.log(`Linescores ${season}: fetching game refs…`);
  const games = await paginate<HistoricalGameRef>(
    (from, to) => sb.from("historical_games")
      .select("game_pk, game_date")
      .eq("season", season)
      .order("game_pk", { ascending: true })
      .range(from, to),
    `historical_games ${season}`,
  );
  console.log(`  ${games.length} games in ${season}`);
  const byPk = new Map(games.map((g) => [g.game_pk, g.game_date]));

  // Fetch boxscore linescores in game_pk-ordered batches so we can stream
  // straight into the row buffer instead of holding both indexes in memory.
  const rows: Array<[number, string, number, "T" | "B", number]> = [];
  const pkList = [...byPk.keys()];
  const BATCH = 500;                                          // ~500 gamePks fits comfortably in a PostgREST IN(...) URL
  for (let i = 0; i < pkList.length; i += BATCH) {
    const chunk = pkList.slice(i, i + BATCH);
    const { data, error } = await sb.from("historical_boxscores")
      .select("game_pk, linescore_raw")
      .in("game_pk", chunk);
    if (error) throw new Error(`historical_boxscores batch: ${error.message}`);
    for (const r of ((data ?? []) as LinescoreRow[])) {
      const ls = r.linescore_raw as StatsapiLinescore | null | undefined;
      const innings = ls?.innings ?? [];
      const date = byPk.get(r.game_pk) ?? "";
      for (const inn of innings) {
        if (typeof inn.num !== "number") continue;
        if (typeof inn.away?.runs === "number") {
          rows.push([r.game_pk, date, inn.num, "T", inn.away.runs]);
        }
        if (typeof inn.home?.runs === "number") {
          rows.push([r.game_pk, date, inn.num, "B", inn.home.runs]);
        }
      }
    }
    if (i > 0 && i % 5000 === 0) console.log(`    boxscore batch @ ${i}/${pkList.length}`);
  }
  await writeCsv(
    `linescores_${season}.csv`,
    ["game_pk", "date", "inning", "half", "runs"],
    rows,
  );
}

// ─── Linescores: 2026 (from daily_raw, in-progress season) ────────────

type DailyRawScheduleGame = {
  gamePk?: number;
  status?: { detailedState?: string };
  linescore?: { innings?: StatsapiInning[] };
};
type DailyRawPayload = {
  schedule?: { dates?: Array<{ games?: DailyRawScheduleGame[] }> };
};

async function exportCurrentSeasonLinescores() {
  const sb = supabaseAdmin();
  console.log("Linescores 2026 (from daily_raw)…");
  // daily_raw payloads are ~1MB each — pulling a season in one query
  // trips the pooler's statement_timeout. List dates first, then fetch
  // per-date payloads serially.
  const { data: dateRows, error: dateErr } = await sb.from("daily_raw")
    .select("date")
    .eq("sport", "mlb")
    .gte("date", "2026-01-01")
    .lte("date", "2026-12-31")
    .order("date", { ascending: true });
  if (dateErr) throw new Error(`daily_raw dates: ${dateErr.message}`);
  const dates = ((dateRows ?? []) as Array<{ date: string }>).map((r) => r.date);
  console.log(`  ${dates.length} daily_raw rows`);

  const rows: Array<[number, string, number, "T" | "B", number]> = [];
  for (const date of dates) {
    const { data: raw, error: rawErr } = await sb.from("daily_raw")
      .select("date, payload")
      .eq("sport", "mlb")
      .eq("date", date)
      .maybeSingle<{ date: string; payload: DailyRawPayload }>();
    if (rawErr) { console.warn(`  ${date}: ${rawErr.message}`); continue; }
    if (!raw) continue;
    const games = (raw.payload?.schedule?.dates ?? []).flatMap((d) => d.games ?? []);
    for (const g of games) {
      if (typeof g.gamePk !== "number") continue;
      // Only score final games. Suspended / postponed rows would emit
      // truncated linescores that skew the fit.
      const status = g.status?.detailedState ?? "";
      if (!status.toLowerCase().includes("final")) continue;
      for (const inn of (g.linescore?.innings ?? [])) {
        if (typeof inn.num !== "number") continue;
        if (typeof inn.away?.runs === "number") {
          rows.push([g.gamePk, raw.date, inn.num, "T", inn.away.runs]);
        }
        if (typeof inn.home?.runs === "number") {
          rows.push([g.gamePk, raw.date, inn.num, "B", inn.home.runs]);
        }
      }
    }
  }
  await writeCsv(
    `linescores_2026.csv`,
    ["game_pk", "date", "inning", "half", "runs"],
    rows,
  );
}

// ─── daily_predictions ────────────────────────────────────────────────

type DailyPredictionRow = {
  sport: string;
  date: string;
  game_pk: number;
  model_version: string;
  away_team_id: number | null;
  home_team_id: number | null;
  away_win_pct: number;
  home_win_pct: number;
  nrfi_pct: number;
  inputs: unknown;
};

async function exportDailyPredictions() {
  const sb = supabaseAdmin();
  console.log("daily_predictions…");
  const rows = await paginate<DailyPredictionRow>(
    (from, to) => sb.from("daily_predictions")
      .select("sport, date, game_pk, model_version, away_team_id, home_team_id, away_win_pct, home_win_pct, nrfi_pct, inputs")
      .eq("sport", "mlb")
      .order("date", { ascending: true })
      .order("game_pk", { ascending: true })
      .range(from, to),
    "daily_predictions",
  );
  await writeCsv(
    "daily_predictions.csv",
    [
      "sport", "date", "game_pk", "model_version",
      "away_team_id", "home_team_id",
      "away_win_pct", "home_win_pct", "nrfi_pct",
      "inputs_json",
    ],
    rows.map((r) => [
      r.sport, r.date, r.game_pk, r.model_version,
      r.away_team_id, r.home_team_id,
      r.away_win_pct, r.home_win_pct, r.nrfi_pct,
      r.inputs,
    ]),
  );
}

// ─── prediction_results ───────────────────────────────────────────────

type PredictionResultRow = {
  sport: string; date: string; game_pk: number; model_version: string;
  status: string;
  away_score: number | null; home_score: number | null;
  away_first_inning: number | null; home_first_inning: number | null;
  actual_winner: string | null; actual_nrfi: boolean | null;
  win_correct: boolean | null; nrfi_correct: boolean | null;
  win_brier: number | null; nrfi_brier: number | null;
  open_away_ml_odds: number | null; open_home_ml_odds: number | null;
  open_nrfi_odds: number | null; open_yrfi_odds: number | null;
  close_away_ml_odds: number | null; close_home_ml_odds: number | null;
  close_nrfi_odds: number | null; close_yrfi_odds: number | null;
};

async function exportPredictionResults() {
  const sb = supabaseAdmin();
  console.log("prediction_results…");
  const rows = await paginate<PredictionResultRow>(
    (from, to) => sb.from("prediction_results")
      .select(
        "sport, date, game_pk, model_version, status, away_score, home_score, " +
        "away_first_inning, home_first_inning, actual_winner, actual_nrfi, " +
        "win_correct, nrfi_correct, win_brier, nrfi_brier, " +
        "open_away_ml_odds, open_home_ml_odds, open_nrfi_odds, open_yrfi_odds, " +
        "close_away_ml_odds, close_home_ml_odds, close_nrfi_odds, close_yrfi_odds",
      )
      .eq("sport", "mlb")
      .order("date", { ascending: true })
      .order("game_pk", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: PredictionResultRow[] | null; error: { message: string } | null }>,
    "prediction_results",
  );
  await writeCsv(
    "prediction_results.csv",
    [
      "sport", "date", "game_pk", "model_version",
      "status", "away_score", "home_score",
      "away_first_inning", "home_first_inning",
      "actual_winner", "actual_nrfi",
      "win_correct", "nrfi_correct", "win_brier", "nrfi_brier",
      "open_away_ml_odds", "open_home_ml_odds", "open_nrfi_odds", "open_yrfi_odds",
      "close_away_ml_odds", "close_home_ml_odds", "close_nrfi_odds", "close_yrfi_odds",
    ],
    rows.map((r) => [
      r.sport, r.date, r.game_pk, r.model_version,
      r.status, r.away_score, r.home_score,
      r.away_first_inning, r.home_first_inning,
      r.actual_winner, r.actual_nrfi,
      r.win_correct, r.nrfi_correct, r.win_brier, r.nrfi_brier,
      r.open_away_ml_odds, r.open_home_ml_odds, r.open_nrfi_odds, r.open_yrfi_odds,
      r.close_away_ml_odds, r.close_home_ml_odds, r.close_nrfi_odds, r.close_yrfi_odds,
    ]),
  );
}

// ─── daily_odds_first (opening prices) ────────────────────────────────

type DailyOddsFirstRow = {
  sport: string; date: string; game_pk: number; book: string;
  away_ml_odds: number | null; home_ml_odds: number | null;
  nrfi_odds: number | null; yrfi_odds: number | null;
  captured_at: string;
};

async function exportDailyOddsFirst() {
  const sb = supabaseAdmin();
  console.log("daily_odds_first…");
  const rows = await paginate<DailyOddsFirstRow>(
    (from, to) => sb.from("daily_odds_first")
      .select("sport, date, game_pk, book, away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds, captured_at")
      .eq("sport", "mlb")
      .order("date", { ascending: true })
      .order("game_pk", { ascending: true })
      .order("book", { ascending: true })
      .range(from, to),
    "daily_odds_first",
  );
  await writeCsv(
    "daily_odds_first.csv",
    ["sport", "date", "game_pk", "book", "away_ml_odds", "home_ml_odds", "nrfi_odds", "yrfi_odds", "captured_at"],
    rows.map((r) => [
      r.sport, r.date, r.game_pk, r.book,
      r.away_ml_odds, r.home_ml_odds, r.nrfi_odds, r.yrfi_odds, r.captured_at,
    ]),
  );
}

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  await ensureOutDir();
  console.log(`Writing to ${OUT_DIR}`);
  await exportHistoricalLinescoresForSeason(2024);
  await exportHistoricalLinescoresForSeason(2025);
  await exportCurrentSeasonLinescores();
  await exportDailyPredictions();
  await exportPredictionResults();
  await exportDailyOddsFirst();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });

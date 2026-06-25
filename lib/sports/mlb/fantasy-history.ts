// Read side of the fantasy system. Reads daily_fantasy_results (written
// by the fantasy-comparator cron) to surface projected-vs-actual on
// /mlb/fantasy.
//
// Two cuts:
//   - yesterday: per-player projected + actual, with biggest beats and
//     biggest misses for the page's "Yesterday" section.
//   - rolling: aggregate MAE (mean absolute error) over the last N days,
//     so the page can show "we're tracking ~X points off per projection."

import { supabaseAdmin } from "@/lib/supabase";

type RawResultRow = {
  date:          string;
  player_id:     number;
  full_name:     string;
  team_abbr:     string;
  opp_abbr:      string;
  is_home:       boolean;
  category:      string;
  proj_score:    string | number;
  batting_order: number | null;
  lineup_status: string;
  game_pk:       number | null;
  game_status:   string | null;
  played:        boolean;
  actual_score:  string | number | null;
  actual_stats:  Record<string, number>;
  delta:         string | number | null;
};

export type FantasyResultRow = {
  date:         string;
  playerId:     number;
  fullName:     string;
  teamAbbr:     string;
  oppAbbr:      string;
  isHome:       boolean;
  category:     string;
  projScore:    number;
  battingOrder: number | null;
  lineupStatus: string;
  gamePk:       number | null;
  gameStatus:   string | null;
  played:       boolean;
  actualScore:  number | null;
  actualStats:  Record<string, number>;
  delta:        number | null;
};

export type FantasyAccuracySummary = {
  /** Players who appeared in their game (denominator for MAE). */
  played:    number;
  /** Mean absolute error (|actual - proj|) over played-only rows. */
  mae:       number | null;
  /** Mean signed bias — positive = projections under-shooting. */
  bias:      number | null;
  /** Pearson correlation between proj and actual — 0 to 1, the higher the better. */
  correlation: number | null;
};

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function numOr0(v: string | number | null | undefined): number {
  return num(v) ?? 0;
}

function toRow(r: RawResultRow): FantasyResultRow {
  return {
    date:         r.date,
    playerId:     r.player_id,
    fullName:     r.full_name,
    teamAbbr:     r.team_abbr,
    oppAbbr:      r.opp_abbr,
    isHome:       r.is_home,
    category:     r.category,
    projScore:    numOr0(r.proj_score),
    battingOrder: r.batting_order,
    lineupStatus: r.lineup_status,
    gamePk:       r.game_pk,
    gameStatus:   r.game_status,
    played:       r.played,
    actualScore:  num(r.actual_score),
    actualStats:  r.actual_stats ?? {},
    delta:        num(r.delta),
  };
}

// All yesterday's results, sorted by largest beat first. Caller slices
// "top beats" off the front and "top misses" off the back.
export async function loadFantasyResultsForDate(date: string): Promise<FantasyResultRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("daily_fantasy_results")
    .select(
      "date, player_id, full_name, team_abbr, opp_abbr, is_home, category, " +
      "proj_score, batting_order, lineup_status, game_pk, game_status, " +
      "played, actual_score, actual_stats, delta",
    )
    .eq("sport", "mlb")
    .eq("date", date)
    .order("delta", { ascending: false, nullsFirst: false });
  if (error) return [];
  const rows = ((data ?? []) as unknown) as RawResultRow[];
  return rows.map(toRow);
}

// Rolling MAE + bias + correlation across last `days` days inclusive of
// `endDate`. Skips non-played rows so the metric is "when the player
// took the field, how close was the projection."
export async function loadFantasyAccuracy(days: number, endDate: string): Promise<FantasyAccuracySummary> {
  const end = new Date(endDate + "T00:00:00Z");
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("daily_fantasy_results")
    .select("proj_score, actual_score, delta, played")
    .eq("sport", "mlb")
    .gte("date", startIso)
    .lte("date", endIso)
    .eq("played", true);
  if (error) return { played: 0, mae: null, bias: null, correlation: null };

  const rows = ((data ?? []) as unknown) as Array<{
    proj_score: string | number; actual_score: string | number | null;
    delta: string | number | null; played: boolean;
  }>;
  const points = rows
    .map((r) => ({ proj: numOr0(r.proj_score), actual: num(r.actual_score), delta: num(r.delta) }))
    .filter((p): p is { proj: number; actual: number; delta: number } => p.actual !== null && p.delta !== null);

  const n = points.length;
  if (n === 0) return { played: 0, mae: null, bias: null, correlation: null };

  const mae  = points.reduce((s, p) => s + Math.abs(p.delta), 0) / n;
  const bias = points.reduce((s, p) => s + p.delta, 0) / n;

  // Pearson r — straightforward enough that pulling in a stats library
  // would be overkill for a single metric.
  const meanProj   = points.reduce((s, p) => s + p.proj,   0) / n;
  const meanActual = points.reduce((s, p) => s + p.actual, 0) / n;
  let num1 = 0, denProj = 0, denActual = 0;
  for (const p of points) {
    const dp = p.proj - meanProj;
    const da = p.actual - meanActual;
    num1 += dp * da;
    denProj += dp * dp;
    denActual += da * da;
  }
  const correlation = denProj === 0 || denActual === 0
    ? null
    : num1 / Math.sqrt(denProj * denActual);

  return { played: n, mae, bias, correlation };
}

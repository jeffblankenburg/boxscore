// Justifies dropping the home-only ML pick restriction for v7.1.
//
// v6 restricted ML plays to home teams because its away picks hit only
// 50-55% (home hit 61.6%) — see winPlayFor's history. v7.1's run-
// distribution model is calibrated symmetrically, so that restriction
// throws away good away picks. Measured over the backfilled 2026 season
// (opening DraftKings odds, $10/play), 2026-07-23:
//
//   A: home-only + band (old)  509 plays  61.7% hit  +5.1% ROI
//   B: both-sides, no band     970 plays  61.5% hit  +7.9% ROI
//   C: both-sides + odds band  760 plays  62.5% hit  +7.3% ROI
//
// Rule C — remove home-only, keep the [-200,-100] odds band — beats the
// old rule on all three (hit, ROI, volume), so winPlayFor / outcomeWinPlay
// and the accuracy/ROI tallies now pick either side. Re-run after any
// v7.x refit to confirm the symmetric-calibration assumption still holds.
// Read-only.
import { supabaseAdmin } from "../lib/supabase";
import { americanToProfitMultiplier } from "../lib/sports/mlb/clv";

const T = 0.545, STAKE = 10, ML_MIN = -200, ML_MAX = -100;
const inBand = (o: number | null | undefined) => o == null ? true : (o >= ML_MIN && o <= ML_MAX);

type Row = { date: string; game_pk: number; away_win_pct: number; home_win_pct: number; actual_winner: "away" | "home" | null };

async function main() {
  const sb = supabaseAdmin();
  const rows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("prediction_results")
      .select("date, game_pk, away_win_pct, home_win_pct, actual_winner")
      .eq("sport", "mlb").eq("model_version", "v7.1").range(f, f + 999);
    if (!data || data.length === 0) break;
    rows.push(...(data as any).map((r: any) => ({ ...r, away_win_pct: +r.away_win_pct, home_win_pct: +r.home_win_pct })));
    if (data.length < 1000) break;
  }
  const odds = new Map<string, { away: number | null; home: number | null }>();
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("daily_odds_first")
      .select("date, game_pk, away_ml_odds, home_ml_odds")
      .eq("sport", "mlb").eq("book", "DraftKings").range(f, f + 999);
    if (!data || data.length === 0) break;
    for (const o of data as any[]) odds.set(`${o.date}|${o.game_pk}`, { away: o.away_ml_odds, home: o.home_ml_odds });
    if (data.length < 1000) break;
  }

  const byDate = new Map<string, Row[]>();
  for (const r of rows) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);

  type Pick = { side: "away" | "home"; won: boolean; odds: number | null };
  function grade(picks: Pick[]) {
    let plays = 0, hits = 0, wOdds = 0, staked = 0, profit = 0;
    for (const p of picks) {
      plays++; if (p.won) hits++;
      if (p.odds != null) { wOdds++; staked += STAKE; profit += p.won ? STAKE * americanToProfitMultiplier(p.odds) : -STAKE; }
    }
    return { plays, hits, wOdds, staked, profit,
      hit: plays ? (hits / plays * 100).toFixed(1) + "%" : "—",
      roi: staked ? (profit / staked >= 0 ? "+" : "") + (profit / staked * 100).toFixed(1) + "%" : "—" };
  }

  const ruleHomeOnly: Pick[] = [], ruleBothSides: Pick[] = [], ruleBothBand: Pick[] = [];
  for (const day of byDate.values()) {
    const graded = day.filter((r) => r.actual_winner !== null);
    if (graded.length === 0) continue;
    // Rule A: home-only + odds band, best-of-day fallback.
    let aPicks = graded.filter((r) => r.home_win_pct >= T && inBand(odds.get(`${r.date}|${r.game_pk}`)?.home));
    if (aPicks.length === 0) { const b = [...graded].sort((x, y) => Math.max(y.away_win_pct, y.home_win_pct) - Math.max(x.away_win_pct, x.home_win_pct))[0]!; aPicks = [b]; }
    for (const r of aPicks) { const side = r.home_win_pct >= r.away_win_pct ? "home" : "away"; ruleHomeOnly.push({ side, won: r.actual_winner === side, odds: odds.get(`${r.date}|${r.game_pk}`)?.[side] ?? null }); }
    // Rule B: both-sides threshold, best-of-day fallback, no odds band.
    let bPicks = graded.filter((r) => Math.max(r.away_win_pct, r.home_win_pct) >= T);
    if (bPicks.length === 0) bPicks = [[...graded].sort((x, y) => Math.max(y.away_win_pct, y.home_win_pct) - Math.max(x.away_win_pct, x.home_win_pct))[0]!];
    for (const r of bPicks) { const side = r.home_win_pct >= r.away_win_pct ? "home" : "away"; ruleBothSides.push({ side, won: r.actual_winner === side, odds: odds.get(`${r.date}|${r.game_pk}`)?.[side] ?? null }); }
    // Rule C: both-sides threshold + odds band on picked side.
    let cPicks = graded.filter((r) => { const side = r.home_win_pct >= r.away_win_pct ? "home" : "away"; return r[`${side}_win_pct` as "home_win_pct" | "away_win_pct"] >= T && inBand(odds.get(`${r.date}|${r.game_pk}`)?.[side]); });
    if (cPicks.length === 0) cPicks = [[...graded].sort((x, y) => Math.max(y.away_win_pct, y.home_win_pct) - Math.max(x.away_win_pct, x.home_win_pct))[0]!];
    for (const r of cPicks) { const side = r.home_win_pct >= r.away_win_pct ? "home" : "away"; ruleBothBand.push({ side, won: r.actual_winner === side, odds: odds.get(`${r.date}|${r.game_pk}`)?.[side] ?? null }); }
  }

  const fmt = (name: string, g: ReturnType<typeof grade>) =>
    console.log(`${name.padEnd(28)} plays=${String(g.plays).padStart(4)}  hit=${g.hit.padStart(6)}  ROI=${g.roi.padStart(7)}  (wOdds=${g.wOdds})`);
  console.log(`v7.1 ML pick-rule comparison (opening DK odds, $${STAKE}/play)\n`);
  fmt("A: home-only + band (current)", grade(ruleHomeOnly));
  fmt("B: both-sides threshold", grade(ruleBothSides));
  fmt("C: both-sides + odds band", grade(ruleBothBand));
}
main().catch((e) => { console.error(e); process.exit(1); });

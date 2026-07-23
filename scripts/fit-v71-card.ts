// Justifies the v7.1 daily-card selection rule (lib/sports/mlb/predictions.ts
// selectDailyCard): cap the public card at 5 picks/day — 2 ML by EV edge,
// 2 NRFI by conviction, 1 flex — and rank ML by edge-vs-market rather than
// raw win%. Read-only; measures over the backfilled 2026 season with
// opening DraftKings odds.
//
// WHY EV, NOT CONFIDENCE, FOR ML: the money is in model-vs-market
// disagreement. v7.1's favored-side picks that the market prices as
// UNDERDOGS (plus money) return far more than favorites at every
// confidence band — a raw-win% ranking would bury them under chalk.
//
// WHY NRFI STAYS CONVICTION-RANKED: there's almost no historical NRFI
// price feed (ESPN carries no NRFI; FanDuel only serves live games), so
// we can't compute NRFI EV over the season — conviction is all we have.
//
// Findings 2026-07-23 (see the printout):
//   - High-confidence underdogs (model favors >=55%, priced as dog):
//     ~55% hit, ~+19% ROI — our single best pick type.
//   - The full EV-ranked card: ML ~62.7% hit / ~+25.4% ROI over 300
//     priced picks (vs +7.3% for the favorites-only band it replaced).
//
// Run: npx tsx --env-file=.env.local scripts/fit-v71-card.ts

import { supabaseAdmin } from "../lib/supabase";
import { americanToProfitMultiplier } from "../lib/sports/mlb/clv";
import { selectDailyCard, cardCandidateFor, cardSize } from "../lib/sports/mlb/predictions";

const STAKE = 10;
type R = { date: string; game_pk: number; away_win_pct: number; home_win_pct: number; nrfi_pct: number; actual_winner: "away" | "home" | null; actual_nrfi: boolean | null };

async function main() {
  const sb = supabaseAdmin();
  const rows: R[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await sb.from("prediction_results")
      .select("date, game_pk, away_win_pct, home_win_pct, nrfi_pct, actual_winner, actual_nrfi")
      .eq("sport", "mlb").eq("model_version", "v7.1").range(f, f + 999);
    if (!data || !data.length) break;
    rows.push(...(data as any).map((r: any) => ({ ...r, away_win_pct: +r.away_win_pct, home_win_pct: +r.home_win_pct, nrfi_pct: +r.nrfi_pct })));
    if (data.length < 1000) break;
  }
  const dk = new Map<string, { away: number | null; home: number | null }>();
  const fd = new Map<string, { nrfi: number | null; yrfi: number | null }>();
  for (const [book, map, ak, hk] of [["DraftKings", dk, "away_ml_odds", "home_ml_odds"], ["FanDuel", fd, "nrfi_odds", "yrfi_odds"]] as const) {
    for (let f = 0; ; f += 1000) {
      const { data } = await sb.from("daily_odds_first").select(`date, game_pk, ${ak}, ${hk}`).eq("sport", "mlb").eq("book", book).range(f, f + 999);
      if (!data || !data.length) break;
      for (const o of data as any[]) (map as Map<string, any>).set(`${o.date}|${o.game_pk}`, book === "DraftKings" ? { away: o.away_ml_odds, home: o.home_ml_odds } : { nrfi: o.nrfi_odds, yrfi: o.yrfi_odds });
      if (data.length < 1000) break;
    }
  }
  const pct = (h: number, n: number) => n ? `${(h / n * 100).toFixed(1)}%` : "—";
  const roi = (pl: number, s: number) => s ? `${pl >= 0 ? "+" : ""}${(pl / s * 100).toFixed(1)}%` : "—";

  // ── Favorite vs underdog by confidence band (the EV-ranking rationale) ──
  const bands = [[0.5, 0.545, "toss-up .50-.545"], [0.545, 0.58, "lean .545-.58"], [0.58, 0.65, "conf .58-.65"], [0.65, 1.01, "strong .65+"]] as [number, number, string][];
  console.log("v7.1 favored-side ML: FAVORITE (neg odds) vs UNDERDOG (pos odds), opening DK\n");
  console.log("band                   | favorite (n hit ROI)          | underdog (n hit ROI)");
  for (const [lo, hi, lbl] of bands) {
    const cells = { fav: { n: 0, h: 0, s: 0, pl: 0 }, dog: { n: 0, h: 0, s: 0, pl: 0 } };
    for (const r of rows) {
      if (r.actual_winner === null) continue;
      const side = r.home_win_pct >= r.away_win_pct ? "home" : "away";
      const wp = side === "home" ? r.home_win_pct : r.away_win_pct;
      if (wp < lo || wp >= hi) continue;
      const price = side === "home" ? dk.get(`${r.date}|${r.game_pk}`)?.home : dk.get(`${r.date}|${r.game_pk}`)?.away;
      if (price == null) continue;
      const c = price > 0 ? cells.dog : cells.fav;
      c.n++; c.s += STAKE; const won = r.actual_winner === side; if (won) c.h++;
      c.pl += won ? STAKE * americanToProfitMultiplier(price) : -STAKE;
    }
    console.log(lbl.padEnd(22) + " | " + `${String(cells.fav.n).padStart(3)} ${pct(cells.fav.h, cells.fav.n).padStart(6)} ${roi(cells.fav.pl, cells.fav.s).padStart(7)}`.padEnd(30) + " | " + `${String(cells.dog.n).padStart(3)} ${pct(cells.dog.h, cells.dog.n).padStart(6)} ${roi(cells.dog.pl, cells.dog.s).padStart(7)}`);
  }

  // ── Simulate the actual ML card rule over the season ───────────────────
  const byDate = new Map<string, R[]>();
  for (const r of rows) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  let mlN = 0, mlH = 0, mlWO = 0, mlS = 0, mlPl = 0, days = 0, cardPicks = 0;
  for (const [date, day] of byDate) {
    const byPk = new Map(day.map((r) => [r.game_pk, r]));
    const card = selectDailyCard(
      day.map((r) => cardCandidateFor(r.game_pk, r.away_win_pct, r.home_win_pct, dk.get(`${date}|${r.game_pk}`))),
      cardSize(day.length),
    );
    if (card.length) days++;
    cardPicks += card.length;
    for (const p of card) {
      const r = byPk.get(p.gamePk)!;
      if (r.actual_winner === null) continue;
      mlN++; const won = r.actual_winner === p.side; if (won) mlH++;
      const price = p.side === "away" ? dk.get(`${date}|${p.gamePk}`)?.away : dk.get(`${date}|${p.gamePk}`)?.home;
      if (price != null) { mlWO++; mlS += STAKE; mlPl += won ? STAKE * americanToProfitMultiplier(price) : -STAKE; }
    }
  }
  console.log(`\nML CARD RULE (top-EV, 20% floor + winPct>=0.68 override) over ${days} days (${(cardPicks / days).toFixed(1)} picks/day):`);
  console.log(`  ${pct(mlH, mlN)} hit (${mlH}/${mlN})   ROI ${roi(mlPl, mlS)} on ${mlWO} priced ($${mlPl.toFixed(2)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });

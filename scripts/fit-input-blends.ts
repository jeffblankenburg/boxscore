// Model-improvement loop, iteration #7: fit the input-construction
// constants that were hand-set, never fit (buildV7TeamInputs):
//
// ◐ VERDICT (2026-07-23, 1,044 OOS games): wSp fit to 0 in EVERY fold —
// the shipped 50/50 recent-form ERA blend actively hurts ML (2-5 starts
// of ERA is variance, not signal). Season-only SP ERA improves OOS ML
// log-loss +0.00449 (z=1.41, the loop's largest ML delta) with NRFI
// neutral. wOff stayed 0 (21-day offense form adds nothing) and
// fallbackIp stayed 5.3. Below the z≳2 solo bar → folded into the v7.1
// SHADOW (spRecentWeight=0 in predictGamesV71) per the iteration-4
// precedent; v7 keeps 0.5 as its frozen contract.
//   * wSp — SP season/recent ERA blend. Shipped 0.5 by eyeball.
//   * wOff — offense season/recent-form blend. Shipped 0 IMPLICITLY:
//     v7 uses season RPG only, ignoring the 21-day form the aggregates
//     already compute.
//   * fallbackIp — expected SP innings when recent starts are missing.
//     Shipped 5.3 by eyeball.
//
// These feed ML (the money market) more than NRFI. Swept jointly,
// walk-forward, selected on combined train log-loss (same objective as
// fitV7Grid); gate is paired OOS vs the shipped combo (0.5, 0, 5.3),
// reported per market.
//
//   npx tsx --env-file=.env.local scripts/fit-input-blends.ts [YEAR]

import { loadEvalGames, fitV7Grid, logLoss, type EvalGame, type SideRaw } from "./_v7-eval";
import { deriveMarkets, offenseFromRunsPerGame, pitcherFromRA9, bullpenFromRA9, type TeamInputs, type V7Config } from "@/lib/sports/mlb/run-model";
import { ERA_TO_RA9 } from "@/lib/sports/mlb/predictions-v7";

const YEAR = process.argv[2] ?? "2026";
const GRID_WSP = [0, 0.25, 0.5, 0.75, 1.0];
const GRID_WOFF = [0, 0.25, 0.5];
const GRID_FIP = [4.7, 5.3];
const SHIPPED = { wSp: 0.5, wOff: 0, fIp: 5.3 };

const monthOf = (d: string) => d.slice(0, 7);

function toInputs(r: SideRaw, wSp: number, wOff: number, fIp: number): TeamInputs {
  const spEra = r.spRecentEra !== null ? wSp * r.spRecentEra + (1 - wSp) * r.spSeasonEra : r.spSeasonEra;
  const rpg = r.recentRpg !== null ? wOff * r.recentRpg + (1 - wOff) * r.seasonRpg : r.seasonRpg;
  return {
    offense: offenseFromRunsPerGame(rpg),
    starter: pitcherFromRA9(spEra * ERA_TO_RA9, r.spRecentIpPerStart ?? fIp),
    bullpen: bullpenFromRA9(r.bpEra * ERA_TO_RA9),
    parkLogFactor: r.parkLogFactor,
  };
}

function markets(g: EvalGame, cfg: V7Config, wSp: number, wOff: number, fIp: number) {
  const m = deriveMarkets(toInputs(g.awayRaw, wSp, wOff, fIp), toInputs(g.homeRaw, wSp, wOff, fIp), cfg);
  return Number.isFinite(m.homeWin) && Number.isFinite(m.nrfi) ? m : null;
}

async function main() {
  console.log(`\nLoading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);
  // Fidelity: raw-rebuilt inputs at the shipped combo must reproduce the
  // cached TeamInputs exactly — otherwise the sweep isn't sweeping what
  // production computes.
  let maxDelta = 0;
  {
    const cfgAny = { ...((await import("@/lib/sports/mlb/run-model")).DEFAULT_V7_CONFIG) };
    for (const g of games.slice(0, 200)) {
      const rebuilt = markets(g, cfgAny, SHIPPED.wSp, SHIPPED.wOff, SHIPPED.fIp);
      const cached = deriveMarkets(g.away, g.home, cfgAny);
      if (rebuilt) maxDelta = Math.max(maxDelta, Math.abs(rebuilt.homeWin - cached.homeWin), Math.abs(rebuilt.nrfi - cached.nrfi));
    }
    console.log(`  ${games.length} games. Raw-rebuild fidelity max|Δ| = ${maxDelta.toFixed(6)} (must be ~0)`);
  }

  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Paired = { shipMl: number; fitMl: number; shipNr: number; fitNr: number };
  const oos: Paired[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    let best = SHIPPED, bestLoss = Infinity;
    for (const wSp of GRID_WSP) for (const wOff of GRID_WOFF) for (const fIp of GRID_FIP) {
      let sum = 0, n = 0;
      for (const g of train) {
        const m = markets(g, cfg, wSp, wOff, fIp);
        if (!m) continue;
        sum += logLoss(m.homeWin, g.actualWinner === "home") + logLoss(m.nrfi, g.actualNrfi);
        n++;
      }
      const loss = n ? sum / n : Infinity;
      if (loss < bestLoss) { bestLoss = loss; best = { wSp, wOff, fIp }; }
    }
    console.log(`  ${tm}: wSp=${best.wSp} wOff=${best.wOff} fallbackIp=${best.fIp} (train n=${train.length})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const ship = markets(g, cfg, SHIPPED.wSp, SHIPPED.wOff, SHIPPED.fIp);
      const fit = markets(g, cfg, best.wSp, best.wOff, best.fIp);
      if (!ship || !fit) continue;
      oos.push({
        shipMl: logLoss(ship.homeWin, g.actualWinner === "home"), fitMl: logLoss(fit.homeWin, g.actualWinner === "home"),
        shipNr: logLoss(ship.nrfi, g.actualNrfi), fitNr: logLoss(fit.nrfi, g.actualNrfi),
      });
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const gate = (a: number[], b: number[]) => {
    const d = a.map((x, i) => x - b[i]!);
    const m = avg(d);
    const se = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / d.length / d.length);
    return `Δ ${(m >= 0 ? "+" : "")}${m.toFixed(5)} (z=${(se > 0 ? m / se : 0).toFixed(2)})`;
  };

  console.log(`\nGATE — OOS ${oos.length} games (paired; promote at z ≳ 2):`);
  console.log(`  ML    shipped ${avg(oos.map((o) => o.shipMl)).toFixed(4)}  fitted ${avg(oos.map((o) => o.fitMl)).toFixed(4)}  ${gate(oos.map((o) => o.shipMl), oos.map((o) => o.fitMl))}`);
  console.log(`  NRFI  shipped ${avg(oos.map((o) => o.shipNr)).toFixed(4)}  fitted ${avg(oos.map((o) => o.fitNr)).toFixed(4)}  ${gate(oos.map((o) => o.shipNr), oos.map((o) => o.fitNr))}`);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

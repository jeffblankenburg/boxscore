// Model-improvement loop, iteration #5: game-time temperature (NRFI).
//
// ✗ VERDICT (2026-07-23, 1,058 OOS games, 770 with a temp reading):
// FAILED. With the properly centered feature (trailing-14-day climate
// norm; the first pass's season-to-date norm mis-centered dev at +3.7°C
// by re-measuring the seasonal trend) the gate is flat-to-negative
// (Δ −0.00018, z=−0.38) and the model-free check runs AGAINST physics:
// cool-anomaly days showed MORE 1st-inning scoring (43.1% NRFI) than hot
// days (47.6%). Effect-size arithmetic agrees: ~1%/°C on λ ≈ 0.3pp NRFI
// per 4°C anomaly — under a season's noise floor for a one-inning binary
// market. Revisit only for a full-game TOTALS market, where the effect
// integrates over nine innings.
//
// Hypothesis: warm air carries the ball and livens offense, so 1st-inning
// λ should scale with temperature. The SIGNAL ISOLATION matters more than
// the physics: league-wide seasonal warming is already absorbed by v7.1's
// adaptive bump, and each park's average climate is baked into its static
// park factor — so the feature is the DEVIATION of game-time temp from
// that park's own season-to-date norm (a hot day at Fenway), walk-forward,
// domes/retractables zeroed (indoor air; roof state unobservable).
//
// Champion baseline is the v7.1 NRFI read (adaptive bump + r1), NOT v7 —
// challengers beat the champion, not its predecessor.
//
// Data: docs/predictions-v7/fixtures/park_weather_<year>.csv from
// scripts/fetch-park-weather.ts (open-meteo hourly, UTC). Games newer
// than the archive lag have no reading → no adjustment.
//
// Gate: paired OOS NRFI log-loss vs v7.1 read (z ≳ 2 solo-promote), plus
// pick-level readout. ML untouched by construction.
//
//   npx tsx --env-file=.env.local scripts/fit-weather-nrfi.ts [YEAR]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEvalGames, fitV7Grid, logLoss, type EvalGame } from "./_v7-eval";
import { halfInningLambdas, scorelessProb, shrinkRate, type V7Config } from "@/lib/sports/mlb/run-model";
import { V71_PRIOR_RPG1, V71_PRIOR_K, V71_R1 } from "@/lib/sports/mlb/predictions-v7";
import { PARKS } from "./_park-locations";

const YEAR = process.argv[2] ?? "2026";
// log-λ per °C of park-norm deviation. Literature effect on total runs is
// ~0.5-1%/°C, which brackets the grid; 0 stays available every fold.
const GRID_BETA = [0, 0.003, 0.006, 0.01, 0.015];

const monthOf = (d: string) => d.slice(0, 7);

function loadWeather(): Map<string, number> {
  const out = new Map<string, number>();
  const path = join(process.cwd(), "docs/predictions-v7/fixtures", `park_weather_${YEAR}.csv`);
  const lines = readFileSync(path, "utf8").split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [teamId, date, hour, temp] = line.split(",");
    out.set(`${teamId}|${date}|${hour}`, Number(temp));
  }
  return out;
}

async function main() {
  const weather = loadWeather();
  console.log(`\nLoaded ${weather.size} hourly park temps.`);

  console.log(`Loading ${YEAR} eval games…`);
  const games = await loadEvalGames(YEAR);

  // Game-time temp (open-air parks only, at the scheduled first-pitch UTC
  // hour), then the park-norm deviation walk-forward.
  const tempOf = (g: EvalGame): number | null => {
    if (PARKS[g.homeTeamId]?.roof !== "open") return null;
    const ms = Date.parse(g.startTimeUtc);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    const key = `${g.homeTeamId}|${d.toISOString().slice(0, 10)}|${d.getUTCHours()}`;
    return weather.get(key) ?? null;
  };
  // Park norm = TRAILING-14-DAY mean at that park's coordinates (all
  // hours 18-04 UTC ≈ typical game windows), from the weather fixture
  // itself — not from prior games. A season-to-date game norm lags summer
  // warming (first pass measured mean dev +3.7°C — half the "signal" was
  // the seasonal trend v7.1 already absorbs); a trailing climate norm
  // centers the anomaly properly.
  const dev = new Map<number, number>();   // gamePk → °C above park norm
  const GAME_HOURS = [18, 19, 20, 21, 22, 23, 0, 1, 2, 3];
  const parkNorm = (teamId: number, date: string): number | null => {
    let sum = 0, n = 0;
    const d0 = new Date(date + "T00:00:00Z");
    for (let back = 1; back <= 14; back++) {
      const d = new Date(d0); d.setUTCDate(d.getUTCDate() - back);
      const iso = d.toISOString().slice(0, 10);
      for (const h of GAME_HOURS) {
        const t = weather.get(`${teamId}|${iso}|${h}`);
        if (t !== undefined) { sum += t; n++; }
      }
    }
    return n >= 50 ? sum / n : null;
  };
  for (const g of games) {
    const t = tempOf(g);
    if (t === null) continue;
    const norm = parkNorm(g.homeTeamId, g.date);
    if (norm !== null) dev.set(g.gamePk, t - norm);
  }
  const devs = [...dev.values()];
  const devMean = devs.reduce((s, x) => s + x, 0) / devs.length;
  const devSd = Math.sqrt(devs.reduce((s, x) => s + (x - devMean) ** 2, 0) / devs.length);
  console.log(`  ${games.length} games; ${devs.length} with a park-norm temp deviation (mean ${devMean.toFixed(1)}°C, sd ${devSd.toFixed(1)}°C).`);

  // v7.1 champion read, with an optional temp multiplier on both λ1's.
  const v71Cfg = (g: EvalGame, cfg: V7Config): V7Config => ({
    ...cfg,
    firstInningBump: Math.log(
      shrinkRate(g.league1stRpgAsOf, g.league1stGamesAsOf, V71_PRIOR_RPG1, V71_PRIOR_K) / cfg.leagueLambda,
    ),
  });
  const nrfiAt = (g: EvalGame, cfg: V7Config, beta: number): number => {
    const c = v71Cfg(g, cfg);
    const mult = Math.exp(beta * (dev.get(g.gamePk) ?? 0));
    const a1 = halfInningLambdas(g.away, g.home, false, c)[0]! * mult;
    const h1 = halfInningLambdas(g.home, g.away, true, c)[0]! * mult;
    return scorelessProb(a1, V71_R1) * scorelessProb(h1, V71_R1);
  };

  // Walk-forward beta.
  const months = [...new Set(games.map((g) => monthOf(g.date)))].sort();
  type Paired = { base: number; tmp: number; actual: boolean; hasDev: boolean; d: number };
  const oos: Paired[] = [];
  for (const tm of months) {
    const train = games.filter((g) => monthOf(g.date) < tm);
    if (train.length < 250) continue;
    const cfg = fitV7Grid(train);
    let bestBeta = 0, bestLoss = Infinity;
    for (const beta of GRID_BETA) {
      let sum = 0, n = 0;
      for (const g of train) {
        const p = nrfiAt(g, cfg, beta);
        if (!Number.isFinite(p)) continue;
        sum += logLoss(p, g.actualNrfi); n++;
      }
      const loss = n ? sum / n : Infinity;
      if (loss < bestLoss) { bestLoss = loss; bestBeta = beta; }
    }
    console.log(`  ${tm}: beta=${bestBeta} (train n=${train.length})`);
    for (const g of games.filter((x) => monthOf(x.date) === tm)) {
      const pb = nrfiAt(g, cfg, 0);
      const pt = nrfiAt(g, cfg, bestBeta);
      if (!Number.isFinite(pb) || !Number.isFinite(pt)) continue;
      oos.push({ base: logLoss(pb, g.actualNrfi), tmp: logLoss(pt, g.actualNrfi), actual: g.actualNrfi, hasDev: dev.has(g.gamePk), d: dev.get(g.gamePk) ?? 0 });
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const deltas = oos.map((o) => o.base - o.tmp);
  const dMean = avg(deltas);
  const dSe = Math.sqrt(deltas.reduce((s, x) => s + (x - dMean) ** 2, 0) / deltas.length / deltas.length);
  const z = dSe > 0 ? dMean / dSe : 0;

  // Raw signal check, model-free: NRFI rate on unusually hot vs cool days.
  const hot = oos.filter((o) => o.d > 4), cool = oos.filter((o) => o.d < -4);
  const rate = (xs: Paired[]) => xs.length ? (100 * xs.filter((o) => o.actual).length / xs.length).toFixed(1) + "%" : "—";

  console.log(`\nGATE — OOS ${oos.length} games, ${oos.filter((o) => o.hasDev).length} with temp deviation (paired per game):`);
  console.log(`  NRFI log-loss  v7.1 ${avg(oos.map((o) => o.base)).toFixed(4)}  +temp ${avg(oos.map((o) => o.tmp)).toFixed(4)}  Δ ${(dMean >= 0 ? "+" : "")}${dMean.toFixed(5)} (z=${z.toFixed(2)}; promote at z ≳ 2)`);
  console.log(`  raw check: NRFI rate on hot days (dev>+4°C, n=${hot.length}): ${rate(hot)}  vs cool days (dev<−4°C, n=${cool.length}): ${rate(cool)}`);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

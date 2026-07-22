// v7 league linescore constants, fit from the frozen fixtures (design.md
// §2.2 + §2.1). Two constants come out of here:
//
//   1. Negative-binomial dispersion `r` for half-inning runs. One `r`
//      estimated once from league data; mean set per-game by λ. Gate: at
//      league λ, NB P(0) must reproduce the observed ~72.6% scoreless rate
//      (Poisson at λ≈0.5 gives only ~61% — the whole reason for NB).
//   2. `firstInningBump` = log(λ_inning1 / λ_overall). The design guessed
//      +10–20%; the fixtures say +3.5%. Inning 1 runs hot (guaranteed 1-2-3
//      hitters) and inning 2 runs cold (bottom of order leads off), so the
//      lineup effect is much smaller than a naive "leadoff" argument implies.
//
// Fixture-only, deterministic. Run:
//   npx tsx --env-file=.env.local scripts/fit-v7-dispersion.ts
//
// NB parameterization: mean λ, P(k) = Γ(k+r)/(Γ(r) k!) · p^r · (1−p)^k,
// with p = r/(r+λ), so P(0) = (r/(r+λ))^r.

import { readFileSync } from "fs";
import { join } from "path";

const FIX = join(process.cwd(), "docs/predictions-v7/fixtures");

// Lanczos log-gamma — accurate to ~1e-13, plenty for MLE here.
const G = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];
function lgamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < G.length; i++) x += G[i]! / (z + i + 1);
  const t = z + G.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function readRuns(file: string): number[] {
  const text = readFileSync(join(FIX, file), "utf8");
  const lines = text.split("\n");
  const runs: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // game_pk,date,inning,half,runs
    const lastComma = line.lastIndexOf(",");
    const r = Number(line.slice(lastComma + 1));
    if (Number.isFinite(r)) runs.push(r);
  }
  return runs;
}

// Per-inning mean λ, pooled across the given files. Used for firstInningBump.
function inningProfile(files: string[]): { lambda: number[]; overall: number } {
  const sum = new Array(10).fill(0);
  const cnt = new Array(10).fill(0);
  for (const f of files) {
    const lines = readFileSync(join(FIX, f), "utf8").split("\n");
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i]!.split(",");
      const inning = Number(parts[2]);
      const runs = Number(parts[4]);
      if (!Number.isFinite(inning) || !Number.isFinite(runs)) continue;
      if (inning < 1 || inning > 9) continue; // regulation only
      sum[inning] += runs;
      cnt[inning] += 1;
    }
  }
  const lambda = new Array(10).fill(0);
  let allSum = 0, allN = 0;
  for (let i = 1; i <= 9; i++) { lambda[i] = sum[i] / cnt[i]; allSum += sum[i]; allN += cnt[i]; }
  return { lambda, overall: allSum / allN };
}

function stats(runs: number[]) {
  const n = runs.length;
  let sum = 0, zeros = 0;
  for (const r of runs) { sum += r; if (r === 0) zeros++; }
  const mean = sum / n;
  let sq = 0;
  for (const r of runs) sq += (r - mean) * (r - mean);
  const variance = sq / (n - 1);
  return { n, mean, variance, scoreless: zeros / n };
}

// Negative binomial log-likelihood with mean fixed at m, dispersion r.
function nbLogLik(runs: number[], r: number, m: number): number {
  const p = r / (r + m);
  const logP = Math.log(p);
  const log1mP = Math.log(1 - p);
  const lgR = lgamma(r);
  const rLogP = r * logP;
  let ll = 0;
  for (const k of runs) {
    ll += lgamma(k + r) - lgR - lgamma(k + 1) + rLogP + k * log1mP;
  }
  return ll;
}

// Golden-section search maximizing nbLogLik over r ∈ [lo, hi].
function fitR(runs: number[], m: number, lo = 0.05, hi = 20): number {
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - gr * (b - a), d = a + gr * (b - a);
  let fc = nbLogLik(runs, c, m), fd = nbLogLik(runs, d, m);
  for (let it = 0; it < 100 && b - a > 1e-6; it++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = nbLogLik(runs, c, m); }
    else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = nbLogLik(runs, d, m); }
  }
  return (a + b) / 2;
}

function report(label: string, runs: number[]) {
  const s = stats(runs);
  const rMoM = (s.mean * s.mean) / (s.variance - s.mean); // method of moments
  const rMle = fitR(runs, s.mean);
  const p = rMle / (rMle + s.mean);
  const nbP0 = Math.pow(p, rMle);
  const poissonP0 = Math.exp(-s.mean);
  console.log(`\n${label}  (${s.n.toLocaleString()} half-innings)`);
  console.log(`  observed:   λ=${s.mean.toFixed(4)}  var=${s.variance.toFixed(4)}  scoreless=${(100 * s.scoreless).toFixed(2)}%`);
  console.log(`  dispersion: r(MoM)=${rMoM.toFixed(3)}  r(MLE)=${rMle.toFixed(3)}`);
  console.log(`  NB P(0)   = ${(100 * nbP0).toFixed(2)}%   vs observed ${(100 * s.scoreless).toFixed(2)}%   (Δ ${(100 * (nbP0 - s.scoreless)).toFixed(2)}pp)`);
  console.log(`  Poisson P(0) = ${(100 * poissonP0).toFixed(2)}%  (the ~12pp error NB fixes)`);
  return { rMle, mean: s.mean, scoreless: s.scoreless };
}

function main() {
  const r24 = readRuns("linescores_2024.csv");
  const r25 = readRuns("linescores_2025.csv");
  const r26 = readRuns("linescores_2026.csv");

  report("2024", r24);
  report("2025", r25);
  report("2026 (thru fixture)", r26);
  const pooled = report("POOLED 2024+2025 (fitting set)", [...r24, ...r25]);

  // First-inning bump — inning-1 λ relative to the overall-inning mean.
  const prof = inningProfile(["linescores_2024.csv", "linescores_2025.csv"]);
  const inn1 = prof.lambda[1]!;
  const bump = Math.log(inn1 / prof.overall);
  console.log(`\nPer-inning λ profile (pooled 2024+2025):`);
  for (let i = 1; i <= 9; i++) {
    const lam = prof.lambda[i]!;
    console.log(`  inning ${i}: λ=${lam.toFixed(4)}  (${(lam / prof.overall).toFixed(3)}× overall)`);
  }
  console.log(`\n→ v7 NB dispersion r   = ${pooled.rMle.toFixed(3)} (pooled 2024+2025 MLE).`);
  console.log(`→ v7 firstInningBump   = ${bump.toFixed(4)} (log ${(inn1 / prof.overall).toFixed(4)}, i.e. +${(100 * (inn1 / prof.overall - 1)).toFixed(1)}% vs overall inning).`);
  console.log(`  Gate: NB P(0) at league λ reproduces the ~72.6% scoreless anchor.\n`);
}

main();

// v1 excitement scorer for the "On This Day" historical store. Pure
// function over the data we already have at ingest time so the backfill
// can compute the score in the same transaction it writes the rows.
//
// Tunable from the top of the file on purpose — every constant here is
// expected to move at least once after a few weeks of reading actual
// rankings. The scorer also returns a per-signal contribution map
// (`notes`) so the admin page can explain why a game scored what it did
// and so re-tuning is grounded in data rather than vibes.
//
// Out of scope for v1 (documented in issue #55):
//   - Win Probability Added swing — needs play-by-play parser
//   - Milestone HR / hit (player's 500th, 3000th) — needs career running
//     totals across the whole crawl
//   - Anything involving leverage / championship context

import type { Boxscore } from "../mlb";

export type ExcitementInput = {
  gameType?: string;                    // R / P / F / D / L / W / ...
  awayScore: number;
  homeScore: number;
  innings: number;                      // final inning count
  boxscore: Boxscore;
  linescore: LinescoreShape;
};

// Linescore endpoint shape we care about. Re-declared here (rather than
// re-exported from lib/mlb.ts) because the schedule-envelope Linescore is
// looser than the standalone endpoint and we want to be explicit about
// what the scorer reads.
export type LinescoreShape = {
  innings?: Array<{
    num: number;
    home?: { runs?: number };
    away?: { runs?: number };
  }>;
  teams?: {
    home?: { runs?: number };
    away?: { runs?: number };
  };
};

export type ExcitementResult = {
  total: number;
  notes: Record<string, number>;        // signal name -> points contributed
};

// ─── Tunables ─────────────────────────────────────────────────────────

const WALK_OFF = 30;
const EXTRA_INNINGS_PER_INNING = 5;     // applied to (innings - 9)
const MARGIN_1_RUN = 10;
const MARGIN_2_RUN = 5;
const COMEBACK_PER_RUN = 5;             // applied to largest deficit overcome by winner

const NO_HITTER = 50;
const PERFECT_GAME = 100;
const COMBINED_NO_HITTER = 30;
const CYCLE = 30;
const HR_3 = 25;
const HR_4 = 60;                        // replaces HR_3 (not additive)
const K_15 = 20;
const K_18 = 40;                        // replaces K_15
const K_20 = 60;                        // replaces K_18

// Postseason multipliers. Applied to the running total after all other
// signals fire. Game types: F=Wild Card, D=Division Series, L=LCS,
// W=World Series, P=generic postseason.
const POSTSEASON_MULTIPLIER: Record<string, number> = {
  W: 3.0,
  L: 2.0,
  D: 2.0,
  F: 1.5,
  P: 1.5,                               // fallback for unspecified postseason
};

// ─── Scorer ───────────────────────────────────────────────────────────

export function scoreExcitement(input: ExcitementInput): ExcitementResult {
  const notes: Record<string, number> = {};
  const add = (key: string, pts: number) => {
    if (pts === 0) return;
    notes[key] = (notes[key] ?? 0) + pts;
  };

  const { awayScore, homeScore, innings, gameType, boxscore, linescore } = input;
  const margin = Math.abs(awayScore - homeScore);
  const homeWon = homeScore > awayScore;

  // Walk-off: home team wins in the bottom of the final inning. The
  // proxy is "home won AND game ended past the standard 9 innings, OR
  // home won in regulation but didn't bat in the bottom of the 9th
  // because the win was already in hand at home." We can't distinguish
  // those cleanly from a box score alone — a true walk-off requires the
  // home team to score the go-ahead run in their final at-bat. Read it
  // from the last inning's home runs being non-zero AND the game ending
  // there. Conservative: only credit it when the last inning's home
  // runs put them ahead.
  if (homeWon && isWalkOff(linescore)) add("walkOff", WALK_OFF);

  if (innings > 9) add("extraInnings", (innings - 9) * EXTRA_INNINGS_PER_INNING);

  if (margin === 1) add("oneRunGame", MARGIN_1_RUN);
  else if (margin === 2) add("twoRunGame", MARGIN_2_RUN);

  const comeback = largestComebackByWinner(linescore, homeWon);
  if (comeback > 0) add("comeback", comeback * COMEBACK_PER_RUN);

  // Pitching feats. Walk both pitching staffs.
  const pitcherFeats = scanPitcherFeats(boxscore);
  if (pitcherFeats.perfectGame)       add("perfectGame",      PERFECT_GAME);
  else if (pitcherFeats.noHitterSolo) add("noHitter",         NO_HITTER);
  else if (pitcherFeats.noHitterTeam) add("combinedNoHitter", COMBINED_NO_HITTER);

  // Highest K count by any single starter — only the best gets credit.
  if      (pitcherFeats.maxStrikeouts >= 20) add("k20Plus", K_20);
  else if (pitcherFeats.maxStrikeouts >= 18) add("k18Plus", K_18);
  else if (pitcherFeats.maxStrikeouts >= 15) add("k15Plus", K_15);

  // Batting feats.
  const batterFeats = scanBatterFeats(boxscore);
  if      (batterFeats.maxHomeRuns >= 4) add("hr4Plus", HR_4);
  else if (batterFeats.maxHomeRuns >= 3) add("hr3Plus", HR_3);
  if (batterFeats.anyCycle)              add("cycle",   CYCLE);

  // Base subtotal before the postseason multiplier.
  const subtotal = Object.values(notes).reduce((s, n) => s + n, 0);
  const mult: number = (gameType ? POSTSEASON_MULTIPLIER[gameType] : undefined) ?? 1;
  let total = subtotal;
  if (mult !== 1) {
    const bump = Math.round(subtotal * mult) - subtotal;
    add(`postseason×${mult}`, bump);
    total = subtotal + bump;
  }

  return { total, notes };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function isWalkOff(linescore: LinescoreShape): boolean {
  const innings = linescore.innings ?? [];
  if (innings.length === 0) return false;
  const last = innings[innings.length - 1];
  if (!last) return false;
  // Home batting in the bottom of the last inning and scoring at least
  // one run is the walk-off proxy. Pre-1950 linescores sometimes lack
  // per-inning home runs even when populated for the away side; we'd
  // rather miss a real walk-off than label a non-walk-off as one.
  const homeRuns = last.home?.runs ?? 0;
  return homeRuns > 0;
}

// Returns the largest deficit the eventual winner faced and overcame.
// Walk the linescore inning by inning, track running totals, and remember
// the deepest hole the winner climbed out of.
function largestComebackByWinner(linescore: LinescoreShape, homeWon: boolean): number {
  const innings = linescore.innings ?? [];
  let away = 0, home = 0, deepest = 0;
  for (const inn of innings) {
    away += inn.away?.runs ?? 0;
    home += inn.home?.runs ?? 0;
    const deficit = homeWon ? away - home : home - away;
    if (deficit > deepest) deepest = deficit;
  }
  return deepest;
}

type PitcherFeats = {
  perfectGame: boolean;
  noHitterSolo: boolean;                // one pitcher went the distance
  noHitterTeam: boolean;                // staff combined for no hits
  maxStrikeouts: number;                // most K's by any individual pitcher
};

function scanPitcherFeats(box: Boxscore): PitcherFeats {
  const out: PitcherFeats = {
    perfectGame: false,
    noHitterSolo: false,
    noHitterTeam: false,
    maxStrikeouts: 0,
  };

  // Did either team get no-hit? teamStats.batting.hits tells us instantly.
  const awayHits = box.teams.away.teamStats.batting?.hits ?? -1;
  const homeHits = box.teams.home.teamStats.batting?.hits ?? -1;

  // Examine the staff that did the no-hitting (the OPPOSING staff to the
  // hitless team), so the perfect-game check looks at the right pitchers.
  if (awayHits === 0) {
    examineHitlessOpponent(box, "home", out);
  }
  if (homeHits === 0) {
    examineHitlessOpponent(box, "away", out);
  }

  // Max strikeouts by any individual pitcher (not just the no-hit staffs).
  for (const side of ["away", "home"] as const) {
    const players = box.teams[side].players ?? {};
    for (const p of Object.values(players)) {
      const ks = p.stats.pitching?.strikeOuts;
      if (typeof ks === "number" && ks > out.maxStrikeouts) {
        out.maxStrikeouts = ks;
      }
    }
  }

  return out;
}

function examineHitlessOpponent(
  box: Boxscore,
  pitchingSide: "home" | "away",
  out: PitcherFeats,
): void {
  // Find pitchers on this side who actually pitched (innings > 0).
  const team = box.teams[pitchingSide];
  const pitchers = (team.pitchers ?? [])
    .map((pid) => team.players[`ID${pid}`] ?? team.players[String(pid)])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  if (pitchers.length === 1) {
    out.noHitterSolo = true;
    // Perfect game: no walks, no hits, no batters reached. Easiest box
    // score proxy: team pitching line shows 0 hits, 0 walks, no errors
    // by the fielding team, and batters faced == outs (27 in 9 innings).
    const teamPitching = team.teamStats.pitching ?? {};
    const teamFielding = team.teamStats.fielding ?? {};
    const noWalks = (teamPitching.baseOnBalls ?? -1) === 0;
    const noHits  = (teamPitching.hits ?? -1) === 0;
    const noErrs  = (Number((teamFielding as Record<string, unknown>).errors ?? -1)) === 0;
    if (noWalks && noHits && noErrs) out.perfectGame = true;
  } else if (pitchers.length > 1) {
    out.noHitterTeam = true;
  }
}

type BatterFeats = {
  maxHomeRuns: number;
  anyCycle: boolean;
};

function scanBatterFeats(box: Boxscore): BatterFeats {
  const out: BatterFeats = { maxHomeRuns: 0, anyCycle: false };
  for (const side of ["away", "home"] as const) {
    const players = box.teams[side].players ?? {};
    for (const p of Object.values(players)) {
      const b = p.stats.batting;
      if (!b) continue;
      const hr = b.homeRuns ?? 0;
      if (hr > out.maxHomeRuns) out.maxHomeRuns = hr;
      // Cycle: 1+ single, double, triple, and home run in the same game.
      // teamStats doesn't break out singles separately so derive it from
      // total hits minus extra-base hits.
      const hits    = b.hits ?? 0;
      const doubles = b.doubles ?? 0;
      const triples = b.triples ?? 0;
      const singles = hits - doubles - triples - hr;
      if (singles >= 1 && doubles >= 1 && triples >= 1 && hr >= 1) {
        out.anyCycle = true;
      }
    }
  }
  return out;
}

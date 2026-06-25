// Game-level prediction module for /mlb/predictions. Pure functions —
// caller assembles inputs (slate + team season records + probable-SP
// season ERA), we return a row per game with WIN% (each side) and
// NRFI% (probability no run scores in the 1st inning).
//
// Models are transparent and additive so the page can display the
// inputs alongside the score. v1:
//
//   WIN%: Bill James pythagorean expectation (RS^1.83 / (RS^1.83 +
//         RA^1.83)) per team → log5 matchup → home-field bump
//         (+0.040 to home, league historical) → SP-quality delta
//         from each starter's season ERA vs. league average.
//
//   NRFI%: League baseline 0.57 × combined-SP factor (better SPs →
//          higher NRFI) × combined-offense factor (stronger lineups
//          → lower NRFI). Clamped to [0.30, 0.80] to avoid silly
//          claims when one input is extreme.
//
// What's out of scope for v1:
//   - Bullpen quality (WIN late-inning leverage)
//   - First-inning-specific SP splits (NRFI sharpness)
//   - Recent form (rolling 10-game record)
//   - Park factors
//   - Weather
//
// Iterating in place is the plan.

import type { SlateGame } from "@/lib/mlb";

// ─── Inputs ──────────────────────────────────────────────────────────────

export type TeamSeasonRecord = {
  teamId: number;          // statsapi team id
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  gamesPlayed: number;
};

export type ProbableSpStats = {
  era: number | null;
  wins: number | null;
  losses: number | null;
};

// ─── Output ──────────────────────────────────────────────────────────────

export type PredictionSide = {
  teamId: number;       // statsapi team id, carried through for snapshot provenance
  abbr: string;
  teamName: string;
  isHome: boolean;
  record: { wins: number; losses: number };
  runsPerGame: number;
  runsAllowedPerGame: number;
  pythagWinPct: number;
  /** Probable SP for this side; null if TBD. */
  probableSp: { name: string; era: number | null; wins: number | null; losses: number | null } | null;
  /** Modeled probability this side wins (0–1). */
  winProbability: number;
};

export type GamePrediction = {
  gamePk: number;
  startTime: string;          // ISO datetime from statsapi
  status: SlateGame["status"];
  away: PredictionSide;
  home: PredictionSide;
  /** Probability no run scores in the 1st inning (either team). */
  nrfiProbability: number;
  /** Distance from 50% — useful as a single confidence score. */
  winConfidence: number;
  nrfiConfidence: number;
  /** Which side the model favors. */
  favorite: "away" | "home" | "even";
};

export type PredictionsResult = {
  date: string;
  generatedAt: string;
  games: GamePrediction[];
  gameCount: number;
};

// ─── Constants ───────────────────────────────────────────────────────────

const PYTHAG_EXPONENT = 1.83;          // Bill James "pythagenpat"-ish, classic 1.83
const LG_AVG_ERA = 4.20;
const LG_AVG_RPG = 4.50;
const LG_HOME_WIN_PCT = 0.540;          // ~80-yr modern era average
const HOME_FIELD_BUMP = LG_HOME_WIN_PCT - 0.500;  // +0.040
const SP_ERA_TO_WINPCT = 0.020;         // 1 ERA point ≈ 2 win-pct points
const SP_DELTA_CAP = 0.05;              // clamp SP adjustment to ±5 pct

const BASELINE_NRFI = 0.57;             // league NRFI rate, season-aggregate
const NRFI_MIN = 0.30;
const NRFI_MAX = 0.80;

// ─── Play thresholds ─────────────────────────────────────────────────────
// Below which the model's signal isn't strong enough to justify a wager
// against typical sportsbook prices (see /mlb/predictions methodology
// note for the breakeven math).
//
//   ML at -150 needs ~60% win prob to break even. Confidence 0.20 = 60%
//     win prob for the favored side.
//   NRFI at -135 needs ~57% to break even; 60% gives ~3pp of edge that
//     survives variance once you correct for our model's optimism.
//
// Strong thresholds are the second tier — flagged with the same badge,
// styled with extra weight. Not used for filtering yet, just for the UI.

export const ML_PLAY_THRESHOLD = 0.60;        // favorite's win probability
export const ML_STRONG_THRESHOLD = 0.65;
export const NRFI_PLAY_THRESHOLD = 0.60;      // NRFI side; YRFI side is 1 - this
export const NRFI_STRONG_THRESHOLD = 0.65;

// ─── Play helpers ────────────────────────────────────────────────────────

export type WinPlay = {
  side: "away" | "home";
  abbr: string;
  winPct: number;
  strong: boolean;
};
export type NrfiPlay = {
  side: "NRFI" | "YRFI";
  probability: number;            // probability of the side we're betting (>= 0.60)
  strong: boolean;
};

/** Returns the moneyline play for this game, or null if no side clears
 *  the threshold. The play side is the favored team only when its win
 *  probability >= ML_PLAY_THRESHOLD. */
export function winPlayFor(game: GamePrediction): WinPlay | null {
  if (game.away.winProbability >= ML_PLAY_THRESHOLD) {
    return {
      side: "away",
      abbr: game.away.abbr,
      winPct: game.away.winProbability,
      strong: game.away.winProbability >= ML_STRONG_THRESHOLD,
    };
  }
  if (game.home.winProbability >= ML_PLAY_THRESHOLD) {
    return {
      side: "home",
      abbr: game.home.abbr,
      winPct: game.home.winProbability,
      strong: game.home.winProbability >= ML_STRONG_THRESHOLD,
    };
  }
  return null;
}

/** Returns the first-inning play for this game, or null if NRFI sits in
 *  the 40–60% no-play zone. NRFI side fires when nrfi >= threshold;
 *  YRFI side fires symmetrically when nrfi <= 1 - threshold. */
export function nrfiPlayFor(game: GamePrediction): NrfiPlay | null {
  const nrfi = game.nrfiProbability;
  if (nrfi >= NRFI_PLAY_THRESHOLD) {
    return {
      side: "NRFI",
      probability: nrfi,
      strong: nrfi >= NRFI_STRONG_THRESHOLD,
    };
  }
  if (nrfi <= 1 - NRFI_PLAY_THRESHOLD) {
    const yrfi = 1 - nrfi;
    return {
      side: "YRFI",
      probability: yrfi,
      strong: yrfi >= NRFI_STRONG_THRESHOLD,
    };
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function pythagoreanWinPct(rs: number, ra: number): number {
  if (rs <= 0 && ra <= 0) return 0.5;
  const rsP = Math.pow(rs, PYTHAG_EXPONENT);
  const raP = Math.pow(ra, PYTHAG_EXPONENT);
  return rsP / (rsP + raP);
}

/** Log5 — given each team's true-talent win pct, the probability A beats B
 *  on a neutral field. (Bill James, 1981.) */
function log5(pA: number, pB: number): number {
  const num = pA - pA * pB;
  const den = pA + pB - 2 * pA * pB;
  if (den <= 0) return 0.5;
  return num / den;
}

function spDelta(sp: ProbableSpStats | null): number {
  if (!sp || sp.era === null) return 0;
  const delta = (LG_AVG_ERA - sp.era) * SP_ERA_TO_WINPCT;
  return clamp(delta, -SP_DELTA_CAP, SP_DELTA_CAP);
}

// ─── Game-level prediction ───────────────────────────────────────────────

export type PredictionInputs = {
  date: string;
  slate: SlateGame[];
  /** Standings keyed by statsapi team id. */
  recordsByTeamId: Map<number, TeamSeasonRecord>;
  /** Probable-SP season stats keyed by statsapi person id. */
  spStatsById: Map<number, ProbableSpStats>;
};

export function predictGames(inputs: PredictionInputs): PredictionsResult {
  const { date, slate, recordsByTeamId, spStatsById } = inputs;

  const games: GamePrediction[] = [];

  for (const g of slate) {
    if (g.status === "postponed" || g.status === "cancelled") continue;

    const awayRec = recordsByTeamId.get(g.away.teamId);
    const homeRec = recordsByTeamId.get(g.home.teamId);
    if (!awayRec || !homeRec) continue;

    const awayPythag = pythagoreanWinPct(awayRec.runsScored, awayRec.runsAllowed);
    const homePythag = pythagoreanWinPct(homeRec.runsScored, homeRec.runsAllowed);

    const awaySp = g.away.probablePitcher
      ? spStatsById.get(g.away.probablePitcher.id) ?? null
      : null;
    const homeSp = g.home.probablePitcher
      ? spStatsById.get(g.home.probablePitcher.id) ?? null
      : null;

    // Log5 on talent, then apply SP delta (better-than-avg SP nudges
    // probability toward that team), then apply home-field bump.
    //
    // The SP delta nudges talent BEFORE log5 so the matchup math
    // incorporates it — equivalent to saying "today's team is the
    // season team plus/minus this SP's quality relative to league."
    const awayAdj = clamp(awayPythag + spDelta(awaySp), 0.05, 0.95);
    const homeAdj = clamp(homePythag + spDelta(homeSp), 0.05, 0.95);
    const awayWinNeutral = log5(awayAdj, homeAdj);
    const homeWinProb = clamp((1 - awayWinNeutral) + HOME_FIELD_BUMP, 0.05, 0.95);
    const awayWinProb = 1 - homeWinProb;

    // NRFI model. Combined offense factor (>1 = lineups score more
    // than league avg → suppress NRFI). Combined SP factor (>1 = SPs
    // better than league avg → boost NRFI).
    const awayRpg = awayRec.gamesPlayed > 0 ? awayRec.runsScored / awayRec.gamesPlayed : LG_AVG_RPG;
    const homeRpg = homeRec.gamesPlayed > 0 ? homeRec.runsScored / homeRec.gamesPlayed : LG_AVG_RPG;
    const offenseFactor = ((awayRpg + homeRpg) / 2) / LG_AVG_RPG;

    const awaySpEra = awaySp?.era ?? LG_AVG_ERA;
    const homeSpEra = homeSp?.era ?? LG_AVG_ERA;
    const spFactor = LG_AVG_ERA / ((awaySpEra + homeSpEra) / 2);

    // Combine — geometric mean of the two factors so neither dominates.
    const combined = Math.sqrt(spFactor / offenseFactor);
    const rawNrfi = BASELINE_NRFI * combined;
    const nrfi = clamp(rawNrfi, NRFI_MIN, NRFI_MAX);

    const favorite: "away" | "home" | "even" = awayWinProb > 0.52 ? "away" : homeWinProb > 0.52 ? "home" : "even";

    games.push({
      gamePk: g.gamePk,
      startTime: g.gameDate,
      status: g.status,
      away: {
        teamId: g.away.teamId,
        abbr: g.away.abbr,
        teamName: g.away.teamName,
        isHome: false,
        record: { wins: awayRec.wins, losses: awayRec.losses },
        runsPerGame: awayRpg,
        runsAllowedPerGame: awayRec.gamesPlayed > 0 ? awayRec.runsAllowed / awayRec.gamesPlayed : LG_AVG_RPG,
        pythagWinPct: awayPythag,
        probableSp: g.away.probablePitcher && awaySp
          ? { name: g.away.probablePitcher.fullName, era: awaySp.era, wins: awaySp.wins, losses: awaySp.losses }
          : g.away.probablePitcher
            ? { name: g.away.probablePitcher.fullName, era: null, wins: null, losses: null }
            : null,
        winProbability: awayWinProb,
      },
      home: {
        teamId: g.home.teamId,
        abbr: g.home.abbr,
        teamName: g.home.teamName,
        isHome: true,
        record: { wins: homeRec.wins, losses: homeRec.losses },
        runsPerGame: homeRpg,
        runsAllowedPerGame: homeRec.gamesPlayed > 0 ? homeRec.runsAllowed / homeRec.gamesPlayed : LG_AVG_RPG,
        pythagWinPct: homePythag,
        probableSp: g.home.probablePitcher && homeSp
          ? { name: g.home.probablePitcher.fullName, era: homeSp.era, wins: homeSp.wins, losses: homeSp.losses }
          : g.home.probablePitcher
            ? { name: g.home.probablePitcher.fullName, era: null, wins: null, losses: null }
            : null,
        winProbability: homeWinProb,
      },
      nrfiProbability: nrfi,
      winConfidence: Math.abs(homeWinProb - 0.5) * 2,    // 0 = coin flip, 1 = lock
      nrfiConfidence: Math.abs(nrfi - 0.5) * 2,
      favorite,
    });
  }

  // Sort by start time so the slate reads chronologically.
  games.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));

  return {
    date,
    generatedAt: new Date().toISOString(),
    games,
    gameCount: games.length,
  };
}

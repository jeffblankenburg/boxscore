// Fantasy projection module for /fantasy. Pure functions only — no
// network, no Supabase. Caller assembles the inputs (slate, season-stat
// rows, player profiles) and we return ranked projection rows for
// today's hitters (by position) and starting pitchers.
//
// Model is intentionally transparent and additive so the page can
// surface the inputs alongside the score. v1 inputs:
//
//   Hitters: season rate stats × batting-slot PA expectation ×
//            opposing-SP matchup factor (derived from opp SP's WHIP,
//            K/9, ERA vs. league averages). DraftKings-style scoring
//            (1B=3, 2B=5, 3B=8, HR=10, R=2, RBI=2, BB=2, SB=5).
//
//   SPs:     expected 5.5 IP × season K/9 and ER rate, modulated by
//            opposing lineup's average OPS vs. league average.
//            Scoring: 2.25*IP + 2*K − 2*ER.
//
// What's explicitly out of scope for v1:
//   - Rolling 30-day form (need a backfill pass on historical_player_lines)
//   - Park factors (not stored yet)
//   - Handedness platoon splits (have bats/throws but no L/R-split stats)
//   - Win probability for SP score
//
// These will move scores by small percentages, not order-of-magnitude.
// Iterating in-place is the plan.

import type { SlateGame } from "@/lib/mlb";

// ─── Inputs ──────────────────────────────────────────────────────────────

/** Hitter season stats row from public.player_seasons. Numeric columns
 *  arrive as strings from PostgREST — caller can leave them coerced or
 *  not; we re-coerce defensively. */
export type HitterSeasonInput = {
  player_id: number;
  primary_position: string | null;
  team_abbr: string | null;
  pa: number | null;
  ab: number | null;
  h: number | null;
  doubles: number | null;
  triples: number | null;
  hr: number | null;
  rbi: number | null;
  r: number | null;
  sb: number | null;
  bb_bat: number | null;
  avg: number | string | null;
  obp: number | string | null;
  slg: number | string | null;
  ops: number | string | null;
  games_played: number | null;
};

/** Pitcher season stats row from public.player_seasons. */
export type PitcherSeasonInput = {
  player_id: number;
  primary_position: string | null;
  team_abbr: string | null;
  ip: number | string | null;
  k: number | null;
  w: number | null;
  era: number | string | null;
  whip: number | string | null;
  bb_pitch: number | null;
  hr_allowed: number | null;
  games_played: number | null;
};

/** Player profile row from public.players. We need name + handedness. */
export type PlayerProfileInput = {
  player_id: number;
  full_name: string;
  boxscore_name: string | null;
  primary_position: string | null;
  bats: string | null;
  throws: string | null;
  name_slug: string | null;
};

// ─── Output ──────────────────────────────────────────────────────────────

export type HitterCategory = "C" | "1B" | "2B" | "SS" | "3B" | "OF" | "DH";
export const HITTER_CATEGORIES: HitterCategory[] = ["C", "1B", "2B", "SS", "3B", "OF", "DH"];

export type LineupStatus = "confirmed" | "projected";

export type FantasyHitterRow = {
  playerId: number;
  name: string;
  nameSlug: string | null;
  teamAbbr: string;
  oppAbbr: string;
  isHome: boolean;
  category: HitterCategory;
  /** Lineup slot 1–9 when confirmed; null otherwise. */
  battingOrder: number | null;
  lineupStatus: LineupStatus;
  bats: "L" | "R" | "S" | null;
  season: {
    games: number;
    pa: number;
    avg: number;
    obp: number;
    slg: number;
    ops: number;
    hr: number;
    rbi: number;
    sb: number;
  };
  oppSp: {
    name: string;
    throws: "L" | "R" | null;
    era: number | null;
    whip: number | null;
    k9: number | null;
  } | null;
  projection: {
    expectedPa: number;
    expected1b: number;
    expected2b: number;
    expected3b: number;
    expectedHr: number;
    expectedBb: number;
    expectedR: number;
    expectedRbi: number;
    expectedSb: number;
    matchupFactor: number;
    score: number;
  };
};

export type FantasySpRow = {
  playerId: number;
  name: string;
  nameSlug: string | null;
  teamAbbr: string;
  oppAbbr: string;
  isHome: boolean;
  throws: "L" | "R" | null;
  season: {
    games: number;
    ip: number;
    k: number;
    w: number;
    era: number;
    whip: number;
    k9: number;
  };
  oppOffense: {
    /** Average OPS of opposing team's batter-eligible roster. */
    avgOps: number;
    /** Number of opposing hitters that fed into avgOps. */
    sampleSize: number;
  };
  projection: {
    expectedIp: number;
    expectedK: number;
    expectedEr: number;
    matchupFactor: number;
    score: number;
  };
};

export type FantasyProjections = {
  /** ISO date for the slate. */
  date: string;
  generatedAt: string;
  byPosition: Record<HitterCategory, FantasyHitterRow[]>;
  startingPitchers: FantasySpRow[];
  /** Number of games on the slate. */
  gameCount: number;
  /** Number of games whose lineup is fully confirmed. */
  confirmedCount: number;
};

// ─── Constants ───────────────────────────────────────────────────────────

// League averages — anchor for matchup factors. Source: MLB-wide totals,
// approximate for the modern run-scoring environment (2024–2025). These
// are tuning knobs, not measured each call.
const LG_AVG_OPS  = 0.720;
const LG_AVG_WHIP = 1.30;
const LG_AVG_K9   = 8.80;
const LG_AVG_ERA  = 4.20;

// Plate-appearance expectations per batting-order slot, from observed
// league averages over a full season (~8.7 PA per inning, 1 inning per
// slot turnover, modern game ≈4.2 PA/slot weighted by lineup position).
const SLOT_PA: Record<number, number> = {
  1: 4.65, 2: 4.55, 3: 4.45, 4: 4.35, 5: 4.25,
  6: 4.15, 7: 4.05, 8: 3.95, 9: 3.85,
};
// PA estimate when we don't know slot (projected lineup). Midpoint.
const UNKNOWN_SLOT_PA = 4.20;

// Modern starting pitcher pulled around the 6th — 5.5 IP league average.
const EXPECTED_SP_IP = 5.5;

// Fallback OPS for hitters whose season stats are missing (callups, etc.).
const FALLBACK_OPS = 0.700;

// DraftKings classic scoring (hitters). Exported so the fantasy
// comparator uses the same constants when computing actuals — keeps
// the projection and the outcome on the same scale.
export const SCORE_1B = 3;
export const SCORE_2B = 5;
export const SCORE_3B = 8;
export const SCORE_HR = 10;
export const SCORE_R  = 2;
export const SCORE_RBI = 2;
export const SCORE_BB = 2;
export const SCORE_SB = 5;

// DraftKings classic scoring (pitchers, simplified — no W/QS/CG bonus
// because we can't reliably project decisions yet).
export const SCORE_IP = 2.25;
export const SCORE_K  = 2;
export const SCORE_ER = -2;

// Score a player's actual game line. Hitters use single/double/triple/HR/
// runs/RBI/walks/stolen-bases counts; pitchers use innings (decimal),
// strikeouts, earned runs. Same formula as the projector applies to
// expected values.
export function scoreHittingLine(line: {
  hits: number; doubles: number; triples: number; homeRuns: number;
  runs: number; rbi: number; baseOnBalls: number; stolenBases: number;
}): number {
  const singles = Math.max(0, line.hits - line.doubles - line.triples - line.homeRuns);
  return (
    SCORE_1B * singles +
    SCORE_2B * line.doubles +
    SCORE_3B * line.triples +
    SCORE_HR * line.homeRuns +
    SCORE_R  * line.runs +
    SCORE_RBI * line.rbi +
    SCORE_BB * line.baseOnBalls +
    SCORE_SB * line.stolenBases
  );
}

// IP comes from statsapi as "5.2" meaning 5⅔ innings — convert to
// proper decimal so the IP multiplier doesn't undercount fractional
// outs.
export function ipStringToDecimal(s: string | null | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  const whole = Math.trunc(n);
  const tenths = Math.round((n - whole) * 10);
  return whole + (tenths === 1 ? 1 / 3 : tenths === 2 ? 2 / 3 : 0);
}

export function scorePitchingLine(line: {
  inningsPitched: string | null; strikeOuts: number; earnedRuns: number;
}): number {
  const ip = ipStringToDecimal(line.inningsPitched);
  return SCORE_IP * ip + SCORE_K * line.strikeOuts + SCORE_ER * line.earnedRuns;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function categorize(position: string | null | undefined): HitterCategory | null {
  if (!position) return null;
  const p = position.toUpperCase();
  if (p === "C") return "C";
  if (p === "1B") return "1B";
  if (p === "2B") return "2B";
  if (p === "SS") return "SS";
  if (p === "3B") return "3B";
  if (p === "DH") return "DH";
  if (p === "LF" || p === "CF" || p === "RF" || p === "OF") return "OF";
  return null; // P, TWP, etc.
}

function safeBats(v: string | null | undefined): "L" | "R" | "S" | null {
  if (v === "L" || v === "R" || v === "S") return v;
  return null;
}
function safeThrows(v: string | null | undefined): "L" | "R" | null {
  if (v === "L" || v === "R") return v;
  return null;
}

// ─── Matchup factors ─────────────────────────────────────────────────────

/** How favorable is this opposing SP for hitters?
 *  >1.0 = easy SP (boost hitter projections);
 *  <1.0 = tough SP (suppress hitter projections).
 *  Composed from three relative-to-league signals, then clamped. */
function hitterMatchupFactor(sp: PitcherSeasonInput | null): number {
  if (!sp) return 1.0;
  const whip = toNum(sp.whip);
  const era  = toNum(sp.era);
  const ip   = toNum(sp.ip);
  const k    = toNum(sp.k);
  if (whip <= 0 || era <= 0 || ip <= 0) return 1.0;
  const k9 = k * 9 / ip;
  // Higher WHIP / ERA = easier matchup (multiplier > 1).
  // Higher K/9 = tougher matchup (multiplier < 1).
  const whipFactor = clamp(whip / LG_AVG_WHIP, 0.75, 1.25);
  const eraFactor  = clamp(era  / LG_AVG_ERA,  0.75, 1.25);
  const k9Factor   = clamp(LG_AVG_K9 / k9,     0.80, 1.20);
  return (whipFactor + eraFactor + k9Factor) / 3;
}

/** How favorable is this opposing lineup for an SP?
 *  >1.0 = weak lineup (boost SP projections — more Ks, fewer ER);
 *  <1.0 = strong lineup (suppress SP projections). */
function spMatchupFactor(oppLineupAvgOps: number): number {
  if (oppLineupAvgOps <= 0) return 1.0;
  // Weak lineup → factor > 1 (good for the SP).
  return clamp(LG_AVG_OPS / oppLineupAvgOps, 0.78, 1.22);
}

// ─── Hitter projection ───────────────────────────────────────────────────

function projectHitter(args: {
  hitter: HitterSeasonInput;
  profile: PlayerProfileInput;
  category: HitterCategory;
  battingOrder: number | null;
  lineupStatus: LineupStatus;
  teamAbbr: string;
  oppAbbr: string;
  isHome: boolean;
  oppSp: PitcherSeasonInput | null;
  oppSpProfile: PlayerProfileInput | null;
}): FantasyHitterRow {
  const { hitter, profile, oppSp, oppSpProfile } = args;

  const pa  = Math.max(toNum(hitter.pa), 1);
  const ab  = Math.max(toNum(hitter.ab), 1);
  const h   = toNum(hitter.h);
  const dbl = toNum(hitter.doubles);
  const tri = toNum(hitter.triples);
  const hr  = toNum(hitter.hr);
  const bb  = toNum(hitter.bb_bat);
  const r   = toNum(hitter.r);
  const rbi = toNum(hitter.rbi);
  const sb  = toNum(hitter.sb);
  const games = toNum(hitter.games_played);

  // Per-PA rate stats. PA includes BB so this is the right denominator
  // for everything except BA (which uses AB).
  const ratePerPa = (x: number) => x / pa;

  const expectedPa = args.battingOrder
    ? (SLOT_PA[args.battingOrder] ?? UNKNOWN_SLOT_PA)
    : UNKNOWN_SLOT_PA;

  const matchupFactor = hitterMatchupFactor(oppSp);

  // Apply matchup factor to offensive rate categories (H/2B/3B/HR/R/RBI).
  // Walks scale with pitcher's WHIP more than overall matchup, but keep
  // simple here — apply a half-strength matchup adjustment to BB.
  const m = matchupFactor;
  const bbM = 1 + (matchupFactor - 1) * 0.5;

  const exp1b  = (h - dbl - tri - hr) > 0 ? ((h - dbl - tri - hr) / pa) * expectedPa * m : 0;
  const exp2b  = ratePerPa(dbl) * expectedPa * m;
  const exp3b  = ratePerPa(tri) * expectedPa * m;
  const expHr  = ratePerPa(hr) * expectedPa * m;
  const expBb  = ratePerPa(bb) * expectedPa * bbM;
  const expR   = ratePerPa(r) * expectedPa * m;
  const expRbi = ratePerPa(rbi) * expectedPa * m;
  // SB rate is more about player skill / opportunity than matchup.
  const expSb  = ratePerPa(sb) * expectedPa;

  const score =
    SCORE_1B * exp1b +
    SCORE_2B * exp2b +
    SCORE_3B * exp3b +
    SCORE_HR * expHr +
    SCORE_R  * expR +
    SCORE_RBI * expRbi +
    SCORE_BB * expBb +
    SCORE_SB * expSb;

  const ip = oppSp ? toNum(oppSp.ip) : 0;
  const oppK9 = ip > 0 && oppSp ? toNum(oppSp.k) * 9 / ip : null;

  return {
    playerId: hitter.player_id,
    name: profile.boxscore_name ?? profile.full_name,
    nameSlug: profile.name_slug,
    teamAbbr: args.teamAbbr,
    oppAbbr: args.oppAbbr,
    isHome: args.isHome,
    category: args.category,
    battingOrder: args.battingOrder,
    lineupStatus: args.lineupStatus,
    bats: safeBats(profile.bats),
    season: {
      games,
      pa: toNum(hitter.pa),
      avg: toNum(hitter.avg),
      obp: toNum(hitter.obp),
      slg: toNum(hitter.slg),
      ops: toNum(hitter.ops),
      hr,
      rbi,
      sb,
    },
    oppSp: oppSp && oppSpProfile
      ? {
          name: oppSpProfile.boxscore_name ?? oppSpProfile.full_name,
          throws: safeThrows(oppSpProfile.throws),
          era: oppSp.era !== null ? toNum(oppSp.era) : null,
          whip: oppSp.whip !== null ? toNum(oppSp.whip) : null,
          k9: oppK9,
        }
      : null,
    projection: {
      expectedPa,
      expected1b: exp1b,
      expected2b: exp2b,
      expected3b: exp3b,
      expectedHr: expHr,
      expectedBb: expBb,
      expectedR: expR,
      expectedRbi: expRbi,
      expectedSb: expSb,
      matchupFactor,
      score,
    },
  };
}

// ─── SP projection ───────────────────────────────────────────────────────

function projectSp(args: {
  sp: PitcherSeasonInput;
  profile: PlayerProfileInput;
  teamAbbr: string;
  oppAbbr: string;
  isHome: boolean;
  oppLineupOps: number[];
}): FantasySpRow {
  const { sp, profile, oppLineupOps } = args;

  const ip = Math.max(toNum(sp.ip), 1);
  const k = toNum(sp.k);
  const era = toNum(sp.era);
  const whip = toNum(sp.whip);
  const k9 = (k * 9) / ip;

  const sampleSize = oppLineupOps.length;
  const avgOps = sampleSize > 0
    ? oppLineupOps.reduce((a, b) => a + b, 0) / sampleSize
    : LG_AVG_OPS;

  const matchupFactor = spMatchupFactor(avgOps);

  // Apply matchup factor to projections. Boost K (weak lineup K more,
  // strong lineup K less); suppress/grow ER inversely.
  const expectedIp = EXPECTED_SP_IP;
  const expectedK  = (k9 / 9) * expectedIp * matchupFactor;
  const expectedEr = (era / 9) * expectedIp * (2 - matchupFactor); // inverse: weak lineup → fewer ER

  const score = SCORE_IP * expectedIp + SCORE_K * expectedK + SCORE_ER * expectedEr;

  return {
    playerId: sp.player_id,
    name: profile.boxscore_name ?? profile.full_name,
    nameSlug: profile.name_slug,
    teamAbbr: args.teamAbbr,
    oppAbbr: args.oppAbbr,
    isHome: args.isHome,
    throws: safeThrows(profile.throws),
    season: {
      games: toNum(sp.games_played),
      ip: toNum(sp.ip),
      k: toNum(sp.k),
      w: toNum(sp.w),
      era,
      whip,
      k9,
    },
    oppOffense: { avgOps, sampleSize },
    projection: {
      expectedIp,
      expectedK,
      expectedEr,
      matchupFactor,
      score,
    },
  };
}

// ─── Public driver ───────────────────────────────────────────────────────

export type FantasyInputs = {
  date: string;
  slate: SlateGame[];
  /** All hitter season rows for players on rosters playing today, keyed by player_id. */
  hittersById: Map<number, HitterSeasonInput>;
  /** All pitcher season rows for probable SPs + bullpen (we only use SPs in v1), keyed by player_id. */
  pitchersById: Map<number, PitcherSeasonInput>;
  /** Player profiles for everyone we might render, keyed by player_id. */
  profilesById: Map<number, PlayerProfileInput>;
  /** Map of team abbreviation (uppercase) → list of hitter player_ids on that team's roster
   *  (used to project "likely starters" when a lineup hasn't been posted yet). Limit to
   *  ~12 most-PA-d hitters per team is the caller's job. */
  rosterByTeamAbbr: Map<string, number[]>;
};

export function projectFantasySlate(inputs: FantasyInputs): FantasyProjections {
  const { date, slate, hittersById, pitchersById, profilesById, rosterByTeamAbbr } = inputs;

  const byPosition: Record<HitterCategory, FantasyHitterRow[]> = {
    C: [], "1B": [], "2B": [], SS: [], "3B": [], OF: [], DH: [],
  };
  const startingPitchers: FantasySpRow[] = [];

  let confirmedCount = 0;

  for (const game of slate) {
    if (game.status === "postponed" || game.status === "cancelled") continue;
    const awayConfirmed = game.away.lineupConfirmed;
    const homeConfirmed = game.home.lineupConfirmed;
    if (awayConfirmed && homeConfirmed) confirmedCount += 1;

    const awaySp = game.away.probablePitcher
      ? pitchersById.get(game.away.probablePitcher.id) ?? null
      : null;
    const homeSp = game.home.probablePitcher
      ? pitchersById.get(game.home.probablePitcher.id) ?? null
      : null;
    const awaySpProfile = game.away.probablePitcher
      ? profilesById.get(game.away.probablePitcher.id) ?? null
      : null;
    const homeSpProfile = game.home.probablePitcher
      ? profilesById.get(game.home.probablePitcher.id) ?? null
      : null;

    projectTeamHitters({
      team: game.away,
      oppAbbr: game.home.abbr,
      isHome: false,
      oppSp: homeSp,
      oppSpProfile: homeSpProfile,
      hittersById, profilesById, rosterByTeamAbbr,
      byPosition,
    });
    projectTeamHitters({
      team: game.home,
      oppAbbr: game.away.abbr,
      isHome: true,
      oppSp: awaySp,
      oppSpProfile: awaySpProfile,
      hittersById, profilesById, rosterByTeamAbbr,
      byPosition,
    });

    // SP projections. Need opposing team's lineup OPS as input.
    if (awaySp && awaySpProfile) {
      const oppOps = collectTeamOps({
        team: game.home,
        rosterByTeamAbbr,
        hittersById,
      });
      startingPitchers.push(projectSp({
        sp: awaySp, profile: awaySpProfile,
        teamAbbr: game.away.abbr, oppAbbr: game.home.abbr, isHome: false,
        oppLineupOps: oppOps,
      }));
    }
    if (homeSp && homeSpProfile) {
      const oppOps = collectTeamOps({
        team: game.away,
        rosterByTeamAbbr,
        hittersById,
      });
      startingPitchers.push(projectSp({
        sp: homeSp, profile: homeSpProfile,
        teamAbbr: game.home.abbr, oppAbbr: game.away.abbr, isHome: true,
        oppLineupOps: oppOps,
      }));
    }
  }

  // Sort each category descending by projection score.
  for (const cat of HITTER_CATEGORIES) {
    byPosition[cat].sort((a, b) => b.projection.score - a.projection.score);
  }
  startingPitchers.sort((a, b) => b.projection.score - a.projection.score);

  return {
    date,
    generatedAt: new Date().toISOString(),
    byPosition,
    startingPitchers,
    gameCount: slate.filter((g) => g.status !== "postponed" && g.status !== "cancelled").length,
    confirmedCount,
  };
}

// ─── Team-level helpers ──────────────────────────────────────────────────

function projectTeamHitters(args: {
  team: SlateGame["away"];
  oppAbbr: string;
  isHome: boolean;
  oppSp: PitcherSeasonInput | null;
  oppSpProfile: PlayerProfileInput | null;
  hittersById: Map<number, HitterSeasonInput>;
  profilesById: Map<number, PlayerProfileInput>;
  rosterByTeamAbbr: Map<string, number[]>;
  byPosition: Record<HitterCategory, FantasyHitterRow[]>;
}): void {
  const { team, oppAbbr, isHome, oppSp, oppSpProfile,
          hittersById, profilesById, rosterByTeamAbbr, byPosition } = args;

  if (team.lineupConfirmed && team.lineup.length === 9) {
    for (const slot of team.lineup) {
      addHitter(slot, "confirmed", slot.battingOrder, slot.position);
    }
  } else {
    // Project all likely starters from the team's roster pool. Caller
    // has already trimmed roster to top-PA hitters per team.
    const roster = rosterByTeamAbbr.get(team.abbr.toUpperCase()) ?? [];
    for (const playerId of roster) {
      const hitter = hittersById.get(playerId);
      const profile = profilesById.get(playerId);
      if (!hitter || !profile) continue;
      addHitter(
        { playerId, fullName: profile.full_name, position: profile.primary_position ?? "" },
        "projected",
        null,
        profile.primary_position ?? hitter.primary_position ?? "",
      );
    }
  }

  function addHitter(
    entry: { playerId: number; fullName: string; position: string },
    status: LineupStatus,
    battingOrder: number | null,
    rawPosition: string,
  ) {
    const hitter = hittersById.get(entry.playerId);
    const profile = profilesById.get(entry.playerId);
    if (!hitter || !profile) return;
    // Skip pitchers entirely — even if they appear in NL lineups today.
    const category = categorize(rawPosition);
    if (!category) return;
    // If projected (no lineup posted), require some season stats to avoid
    // backup catchers crowding the rankings with 50-PA noise.
    const pa = toNum(hitter.pa);
    if (status === "projected" && pa < 50) return;

    const row = projectHitter({
      hitter, profile, category,
      battingOrder,
      lineupStatus: status,
      teamAbbr: team.abbr,
      oppAbbr,
      isHome,
      oppSp,
      oppSpProfile,
    });
    byPosition[category].push(row);
  }
}

function collectTeamOps(args: {
  team: SlateGame["away"];
  rosterByTeamAbbr: Map<string, number[]>;
  hittersById: Map<number, HitterSeasonInput>;
}): number[] {
  const { team, rosterByTeamAbbr, hittersById } = args;
  const result: number[] = [];
  const ids = team.lineupConfirmed && team.lineup.length === 9
    ? team.lineup.map((l) => l.playerId)
    : (rosterByTeamAbbr.get(team.abbr.toUpperCase()) ?? []);
  for (const id of ids) {
    const h = hittersById.get(id);
    if (!h) continue;
    const ops = toNum(h.ops);
    if (ops > 0) result.push(ops);
  }
  return result;
}

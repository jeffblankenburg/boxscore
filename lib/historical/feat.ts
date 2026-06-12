// v1 feat scorer for the per-line "outrageousness" of an individual
// player performance. Pure function over a line + game context;
// deterministic; explainable via per-signal contribution notes. Same
// tuning posture as the game-level excitement scorer (lib/historical/
// excitement.ts) — every weight is a constant at the top of the file
// and the notes object survives in the row so we can ask "why did
// this score N?" after the fact.
//
// Used by the picker (#57) to select Linescordle, Guess the Player, and
// Higher / Lower puzzles from above a threshold, and by the admin
// /historical/feats viewer to sort the all-time leaderboard.
//
// Out of scope (per issue #56):
//   - Career-milestone signals (player's 3000th hit, 500th HR) —
//     needs running totals across games; separate ticket
//   - Win Probability Added — needs play-by-play
//   - Cross-team feats (combined no-hitter on the staff)
//
// What we DO encode:
//   Hitter:  3+/4+/5+ HR, 5+/6+/7+ hits, 7+/10+ RBI, cycle, 4+ XBH,
//            5+ runs, 4+ SB
//   Pitcher: complete-game shutout, 15+/18+/20+ K, 1-hitter / 2-hitter,
//            no-hitter, perfect game (zero baserunners), 0 BB in CG

// ─── Tunables ─────────────────────────────────────────────────────────

// Hitter
const HR_3   = 40;
const HR_4   = 120;            // replaces HR_3 (not additive)
const HR_5   = 200;            // replaces HR_4
const HITS_5 = 25;
const HITS_6 = 60;             // replaces HITS_5
const HITS_7 = 120;            // replaces HITS_6
const RBI_7  = 30;
const RBI_10 = 80;             // replaces RBI_7
const CYCLE  = 50;
const XBH_4  = 30;
const RUNS_5 = 25;
const SB_4   = 15;

// Pitcher
// A bare CGSO is era-loaded: routine in 1955-1985, rare after. Keep it
// as a small bonus so it nudges 1-hitter / low-K performances upward
// without qualifying as a feat on its own (10 < threshold 30). The
// audit on 2026-06-11 showed CGSO-as-floor was putting 90% pitching
// into the top 700.
const CG_SHUTOUT     = 10;     // complete game with 0 ER allowed
const K_15           = 30;
const K_18           = 60;     // replaces K_15
const K_20           = 120;    // replaces K_18
// X-hitter weights cut on 2026-06-11 to balance the top-700 picker pool
// to ~50/50 batting/pitching. Tuner sweep confirmed: oneHitter=40,
// twoHitter=20 with everything else fixed produces 51% batting in the
// top 700 across every decade 1950-2025.
const ONE_HITTER     = 40;
const TWO_HITTER     = 20;
const NO_HITTER      = 100;
const PERFECT_GAME   = 200;
const ZERO_BB_IN_CG  = 15;

// ─── Inputs ───────────────────────────────────────────────────────────

export type BattingInput = {
  atBats?: number;
  runs?: number;
  hits?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  rbi?: number;
  baseOnBalls?: number;
  strikeOuts?: number;
  stolenBases?: number;
};

export type PitchingInput = {
  inningsPitched?: string;     // "9.0", "8.1", "8.2"
  hits?: number;
  runs?: number;
  earnedRuns?: number;
  baseOnBalls?: number;
  strikeOuts?: number;
  homeRuns?: number;
  battersFaced?: number;
  hitByPitch?: number;
};

export type FeatInput = {
  lineType: "batting" | "pitching";
  batting?: BattingInput;
  pitching?: PitchingInput;
  // Game-level context — needed for several pitcher signals
  // (no-hitter / perfect game / X-hitter detection). Pass undefined
  // if unknown; the scorer downgrades signals that need context.
  gameContext?: {
    // For pitching scoring: how many hits did the OPPOSING team have
    // (i.e. the team this pitcher pitched against)?
    opponentTotalHits?: number;
    // How many of the pitching team's pitchers actually appeared in
    // this game? If 1, treat single-pitcher feats as solo. If >1,
    // suppress them (combined no-hitter is out of scope per #56).
    pitchingStaffSize?: number;
    // Errors committed by the pitching team's defense. Needed for
    // perfect-game detection: 0 errors + 0 hits + 0 walks = perfect.
    pitchingTeamErrors?: number;
  };
};

export type FeatResult = {
  total: number;
  notes: Record<string, number>;
};

// ─── Helpers ──────────────────────────────────────────────────────────

// IP "8.2" means 8 full innings plus 2 outs = 8 + 2/3 = 8.667 innings.
// Parse to a number of OUTS so we can do integer comparisons without
// float surprises.
function parseOuts(ip: string | undefined): number {
  if (!ip) return 0;
  const m = ip.match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return 0;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2]) : 0;
  return whole * 3 + frac;
}

function isCompleteGame(ip: string | undefined): boolean {
  // 9 full innings or more — i.e. 27+ outs.
  return parseOuts(ip) >= 27;
}

// ─── Public scorer ────────────────────────────────────────────────────

export function scoreFeat(input: FeatInput): FeatResult {
  const notes: Record<string, number> = {};
  const add = (key: string, pts: number) => {
    if (pts === 0) return;
    notes[key] = (notes[key] ?? 0) + pts;
  };

  if (input.lineType === "batting" && input.batting) {
    scoreBatting(input.batting, add);
  } else if (input.lineType === "pitching" && input.pitching) {
    scorePitching(input.pitching, input.gameContext, add);
  }

  const total = Object.values(notes).reduce((s, n) => s + n, 0);
  return { total, notes };
}

function scoreBatting(b: BattingInput, add: (k: string, v: number) => void): void {
  const hr = b.homeRuns ?? 0;
  const hits = b.hits ?? 0;
  const rbi = b.rbi ?? 0;
  const doubles = b.doubles ?? 0;
  const triples = b.triples ?? 0;
  const runs = b.runs ?? 0;
  const sb = b.stolenBases ?? 0;
  const singles = Math.max(0, hits - doubles - triples - hr);
  const xbh = doubles + triples + hr;

  // Multi-HR — highest tier wins (not additive).
  if      (hr >= 5) add("hr5Plus", HR_5);
  else if (hr >= 4) add("hr4Plus", HR_4);
  else if (hr >= 3) add("hr3Plus", HR_3);

  // Multi-hit — highest tier wins.
  if      (hits >= 7) add("hits7Plus", HITS_7);
  else if (hits >= 6) add("hits6Plus", HITS_6);
  else if (hits >= 5) add("hits5Plus", HITS_5);

  // RBI — highest tier wins.
  if      (rbi >= 10) add("rbi10Plus", RBI_10);
  else if (rbi >= 7)  add("rbi7Plus",  RBI_7);

  // Cycle: 1+ single, 1+ double, 1+ triple, 1+ HR in the same game.
  if (singles >= 1 && doubles >= 1 && triples >= 1 && hr >= 1) {
    add("cycle", CYCLE);
  }

  if (xbh >= 4)  add("xbh4Plus",  XBH_4);
  if (runs >= 5) add("runs5Plus", RUNS_5);
  if (sb >= 4)   add("sb4Plus",   SB_4);
}

function scorePitching(
  p: PitchingInput,
  ctx: FeatInput["gameContext"],
  add: (k: string, v: number) => void,
): void {
  const k    = p.strikeOuts ?? 0;
  const h    = p.hits ?? 0;
  const er   = p.earnedRuns ?? 0;
  const bb   = p.baseOnBalls ?? 0;
  const cg   = isCompleteGame(p.inningsPitched);

  // Strikeouts — highest tier wins.
  if      (k >= 20) add("k20Plus", K_20);
  else if (k >= 18) add("k18Plus", K_18);
  else if (k >= 15) add("k15Plus", K_15);

  // Complete-game shutout (0 ER allowed). Note: shutout is a TEAM
  // stat — a relief appearance closing out a 0-ER game doesn't qualify
  // here. We require a complete game.
  if (cg && er === 0) add("cgShutout", CG_SHUTOUT);

  // 0 BB in a complete game.
  if (cg && bb === 0) add("zeroBbCg", ZERO_BB_IN_CG);

  // No-hitter / perfect game / X-hitter signals depend on game
  // context. Without it we can score "the pitcher gave up 0 hits in
  // their line" — which is true even for relief shutout appearances —
  // but that's not the same as a team no-hitter. Defensive degrade:
  // only credit these when we have context AND the staff size is 1
  // (solo).
  const solo = ctx?.pitchingStaffSize === 1;
  const oppHits = ctx?.opponentTotalHits;
  const teamErrors = ctx?.pitchingTeamErrors ?? 0;

  if (solo && cg && oppHits !== undefined) {
    if (oppHits === 0) {
      // No-hitter. Perfect game iff 0 baserunners — no hits, no walks,
      // no hit-by-pitch, no errors.
      const hbp = p.hitByPitch ?? 0;
      const perfect = bb === 0 && hbp === 0 && teamErrors === 0;
      add(perfect ? "perfectGame" : "noHitter", perfect ? PERFECT_GAME : NO_HITTER);
    } else if (oppHits === 1) {
      add("oneHitter", ONE_HITTER);
    } else if (oppHits === 2) {
      add("twoHitter", TWO_HITTER);
    }
  }
}

// Stat Sharks pair picker (#64, Phase 2). Returns two player-season
// cards for a given stat + round, with a value-ratio gap that shrinks
// as the round number grows (warmup pairs are obviously different,
// late pairs are genuinely tight). Each card includes the
// player_seasons.id so the client can track `usedPlayerSeasonIds`
// across the run and the picker can avoid duplicates.
//
// Pool strategy: per-season top-N by the stat value, flattened across
// every season since 1950. Per-season ranking is important so a single
// 2023 HR season doesn't crowd out a single 1958 HR season — the game
// should feel era-spanning. The flattened pool is cached in module
// memory for 24h since the underlying data only changes at backfill
// time.
//
// All callers are server-only (server actions / cron); no client code
// reads from this directly. The "server-only" enforcement lives on the
// server-actions file that exports the public-facing entry points;
// keeping it off the picker library itself lets us run smoke tests
// under tsx without tripping the next/server-only guard.

import { supabaseAdmin } from "../../supabase";
import { gapForRound, STATS, type StatDef, type StatKey } from "./stats";

// ─── Seeded RNG ──────────────────────────────────────────────────
//
// Mulberry32 — small, fast 32-bit PRNG. Used by the Daily mode so
// every subscriber gets the exact same sequence of pairs for a given
// (date, stat). Endless mode still uses Math.random for variety.
export type RNG = () => number;
export function mulberry32(seed: number): RNG {
  let s = seed;
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
export function dateSeed(yyyymmdd: string): number {
  return Number(yyyymmdd.replace(/-/g, ""));
}

// Per-season prominence cut. Top-50 per season ≈ the most prominent
// regulars at each position; mid-tier bench guys (Milt Bolling 1956,
// Jose Tartabull 1968, Dave Hollins 1991) drop out. Was 100 — too
// deep, surfaced too many never-heard-of names.
const PER_SEASON_TOP_N = 50;

// Rate stats (AVG, OBP, OPS, ERA, WHIP) need a stricter playing-time
// threshold than the global eligibility flag (which only requires
// 100 PA / 20 IP). At 100 PA, a hot two-week callup can post .350
// AVG and rank top-50, but nobody remembers him. 300 PA ≈ half-season
// regular; 100 IP ≈ a #4 starter or workhorse reliever.
const RATE_MIN_PA = 300;
const RATE_MIN_IP = 100;

// Season floor — matches the rest of the boxscore data universe
// (historical_games, historical_player_lines all start in 1950). The
// yearByYear ingest pulled in players' entire careers back to ~1920,
// but we don't want Snuffy Stirnweiss and Eddie Lake showing up in
// the daily Stat Sharks pool.
const FIRST_SEASON = 1950;
// Season ceiling — the current calendar year is in progress so its
// stats are partial. Asking "did Mike Trout have more HR in 2026 or
// 1976" three weeks into the 2026 season is misleading at best.
// Computed once at module load; process restarts at year rollover.
const LAST_FINISHED_SEASON = new Date().getUTCFullYear() - 1;

// Module-scope cache. Keyed by stat key. Expires daily so the picker
// picks up any new rows added by tomorrow's backfill run (we don't
// expect that often, but the alternative — long-lived cache with no
// invalidation — bites us when we change scoring later).
type PoolRow = {
  id:           number;
  player_id:    number;
  season:       number;
  team_abbr:    string | null;
  player_name:  string;
  statValue:    number;
};
type CacheEntry = { rows: PoolRow[]; expiresAt: number };
const poolCache = new Map<StatKey, CacheEntry>();
const POOL_TTL_MS = 24 * 60 * 60 * 1000;

async function loadPool(stat: StatDef): Promise<PoolRow[]> {
  // Step 1: pull every eligible row that has a non-null value for the
  // stat. We page through to bypass PostgREST's 1000-row default cap.
  // Each row is small (8 columns), so the full pull is cheap even at
  // 28K rows.
  const db = supabaseAdmin();
  const eligibilityCol = stat.side === "batter" ? "batter_eligible" : "pitcher_eligible";
  const select = `id, player_id, season, team_abbr, ${stat.column}, players!inner(full_name)`;
  const PAGE = 1000;
  let from = 0;
  const raw: Array<{
    id: number;
    player_id: number;
    season: number;
    team_abbr: string | null;
    players: { full_name: string } | { full_name: string }[];
    [k: string]: unknown;
  }> = [];
  for (;;) {
    let q = db
      .from("player_seasons")
      .select(select)
      .eq(eligibilityCol, true)
      .gte("season", FIRST_SEASON)
      .lte("season", LAST_FINISHED_SEASON)
      .not(stat.column, "is", null);
    // Rate stats: enforce a half-season playing-time floor so fluky
    // small-sample leaders never enter the pool.
    if (stat.isRateStat) {
      q = stat.side === "batter" ? q.gte("pa", RATE_MIN_PA) : q.gte("ip", RATE_MIN_IP);
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`statsharks loadPool(${stat.key}): ${error.message}`);
    if (!data || data.length === 0) break;
    raw.push(...(data as unknown as typeof raw));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  // Step 2: bucket by season, take the top N per season, flatten.
  const bySeason = new Map<number, PoolRow[]>();
  for (const r of raw) {
    const v = r[stat.column];
    if (typeof v !== "number") continue;
    const players = Array.isArray(r.players) ? r.players[0] : r.players;
    const player_name = players?.full_name ?? "(unknown)";
    const row: PoolRow = {
      id: r.id,
      player_id: r.player_id,
      season: r.season,
      team_abbr: r.team_abbr,
      player_name,
      statValue: v,
    };
    let bucket = bySeason.get(r.season);
    if (!bucket) { bucket = []; bySeason.set(r.season, bucket); }
    bucket.push(row);
  }
  const flat: PoolRow[] = [];
  for (const rows of bySeason.values()) {
    // Higher-is-better → sort DESC. Lower-is-better → ASC.
    rows.sort((a, b) =>
      stat.direction === "higher" ? b.statValue - a.statValue : a.statValue - b.statValue,
    );
    flat.push(...rows.slice(0, PER_SEASON_TOP_N));
  }
  return flat;
}

async function getPool(stat: StatDef): Promise<PoolRow[]> {
  const cached = poolCache.get(stat.key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const rows = await loadPool(stat);
  poolCache.set(stat.key, { rows, expiresAt: Date.now() + POOL_TTL_MS });
  return rows;
}

export type StatSharksCard = {
  /** player_seasons.id — client uses this for the used-list. */
  id:          number;
  player_id:   number;
  player_name: string;
  season:      number;
  team_abbr:   string | null;
  /** The actual stat value. Server never shows this until the reveal,
   * but the picker returns it so the answer can be scored
   * server-side. */
  statValue:   number;
};

export type StatSharksPair = {
  stat:       StatDef;
  round:      number;
  left:       StatSharksCard;
  right:      StatSharksCard;
  /** "left" or "right" — which side is the correct pick for this stat
   * direction. The client never sees this; it's returned only so the
   * caller (server action) can score the user's guess. */
  correct:    "left" | "right";
};

/**
 * Returns a pair for the given stat + round, satisfying the
 * difficulty curve. Excludes any player-season whose id is in
 * `usedPlayerSeasonIds`. Returns null when the pool is exhausted
 * (extremely unlikely; the smallest pool is several thousand rows).
 *
 * Pair ordering (left vs right) is randomized so the correct answer
 * isn't always on the same side.
 */
export async function pickStatSharksPair(opts: {
  statKey:             StatKey;
  round:               number;
  usedPlayerSeasonIds: ReadonlySet<number> | number[];
  /** Deterministic RNG. Daily mode passes a seeded one so all
   *  subscribers see the same pair sequence. Defaults to Math.random
   *  for Endless mode. */
  rng?:                RNG;
  /** Used by gapForRound to scale the difficulty curve. Daily passes
   *  10 (the 10-round cap). Endless leaves the default 20. */
  totalRounds?:        number;
}): Promise<StatSharksPair | null> {
  const stat = STATS[opts.statKey];
  if (!stat) throw new Error(`unknown stat: ${opts.statKey}`);
  const used = opts.usedPlayerSeasonIds instanceof Set
    ? opts.usedPlayerSeasonIds
    : new Set(opts.usedPlayerSeasonIds);
  const rng: RNG = opts.rng ?? Math.random;

  const pool = (await getPool(stat)).filter((r) => !used.has(r.id));
  if (pool.length < 2) return null;

  const a = pool[Math.floor(rng() * pool.length)]!;
  const targetGap = gapForRound(stat, opts.round, opts.totalRounds);

  // Pick player B such that the ratio between the two stat values is
  // at least `targetGap`. For lower-is-better stats the math flips —
  // we want one value ≥ targetGap × the other.
  const candidates = pool.filter((b) => {
    if (b.id === a.id) return false;
    const lo = Math.min(a.statValue, b.statValue);
    const hi = Math.max(a.statValue, b.statValue);
    if (lo <= 0) return hi > 0;       // 0-vs-something always passes
    return hi / lo >= targetGap;
  });

  // If we couldn't find a satisfying B, relax the gap (10% at a time)
  // and retry. Late rounds with tight gaps will hit this; we let the
  // pair through rather than null the round.
  let bPool = candidates;
  let relax = 0.9;
  while (bPool.length === 0 && relax > 0.5) {
    const relaxedGap = Math.max(1.0, targetGap * relax);
    bPool = pool.filter((b) => {
      if (b.id === a.id) return false;
      const lo = Math.min(a.statValue, b.statValue);
      const hi = Math.max(a.statValue, b.statValue);
      if (lo <= 0) return hi > 0;
      return hi / lo >= relaxedGap;
    });
    relax -= 0.1;
  }
  if (bPool.length === 0) {
    // Last-ditch: pick any other row.
    bPool = pool.filter((b) => b.id !== a.id);
  }
  const b = bPool[Math.floor(rng() * bPool.length)]!;

  // Decide which side is "correct" given the stat direction.
  const aIsBetter = stat.direction === "higher"
    ? a.statValue >= b.statValue
    : a.statValue <= b.statValue;

  // Randomize visual ordering so "the correct one is always the bigger
  // number on the left" can't become a strategy.
  const aOnLeft = rng() < 0.5;
  const left  = aOnLeft ? a : b;
  const right = aOnLeft ? b : a;
  const correct: "left" | "right" =
    aIsBetter === aOnLeft ? "left" : "right";

  const toCard = (r: PoolRow): StatSharksCard => ({
    id:          r.id,
    player_id:   r.player_id,
    player_name: r.player_name,
    season:      r.season,
    team_abbr:   r.team_abbr,
    statValue:   r.statValue,
  });
  return {
    stat,
    round: opts.round,
    left:  toCard(left),
    right: toCard(right),
    correct,
  };
}

/** Internal cache reset — used by tests and the future admin
 * "rebuild stat pool" button. */
export function _resetPoolCacheForTests(): void {
  poolCache.clear();
}

// ─── Daily sequence ──────────────────────────────────────────────

/** A single round of the daily sequence. Only the left/right
 * player_seasons.ids are persisted; correctness is re-derived by
 * scorePair() on the server. Player metadata (name/year/team) is
 * fetched separately when the sequence is read so the cached row
 * stays compact. */
export type DailySequenceItem = {
  leftId:  number;
  rightId: number;
};

/** Deterministically build a 10-pair sequence for (stat, date) using
 * a date-seeded mulberry32 RNG. All subscribers get the same pairs
 * in the same order so the daily share grid is comparable.
 *
 * Side balance: after the picker assigns left/right, we flip the pair
 * if one side has run ≥2 ahead on correct answers. The picker's own
 * RNG-driven aOnLeft is fair on average, but the gap-filter step in
 * pickStatSharksPair tends to choose `b` lower than `a`, which means
 * the "correct" side ends up clustered on whichever side `a` lands
 * on in a given run. Beta tester reported "correct is usually on the
 * right" — this pass guarantees no more than one side is ever 2+
 * ahead of the other across the 10 daily rounds. */
export async function generateDailySequence(opts: {
  statKey: StatKey;
  date:    string;        // YYYY-MM-DD
  count:   number;        // e.g. 10
}): Promise<DailySequenceItem[]> {
  const rng = mulberry32(dateSeed(opts.date));
  const used: number[] = [];
  const out: DailySequenceItem[] = [];
  let leftCorrect  = 0;
  let rightCorrect = 0;
  for (let i = 0; i < opts.count; i++) {
    const pair = await pickStatSharksPair({
      statKey:             opts.statKey,
      round:               i,
      usedPlayerSeasonIds: used,
      rng,
      totalRounds:         opts.count,
    });
    if (!pair) break;

    // If placing the correct answer on its assigned side would push
    // the running count to ≥2 ahead of the other side, swap them.
    let { left, right } = pair;
    let correct = pair.correct;
    const wouldRight = correct === "right" ? rightCorrect + 1 : rightCorrect;
    const wouldLeft  = correct === "left"  ? leftCorrect  + 1 : leftCorrect;
    const skewBeforeFlip = Math.abs(wouldRight - wouldLeft);
    if (skewBeforeFlip >= 2) {
      [left, right] = [right, left];
      correct = correct === "left" ? "right" : "left";
    }

    if (correct === "left") leftCorrect++;
    else rightCorrect++;

    used.push(left.id, right.id);
    out.push({ leftId: left.id, rightId: right.id });
  }
  return out;
}

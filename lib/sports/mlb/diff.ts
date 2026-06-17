// Semantic diff between two CanonicalDailyData bundles. Purpose: when
// statsapi-canonical and sdio-canonical disagree on a given date, give
// the operator a punch list of "section / entity / field" mismatches
// so they can drill into either the adapter, the vendor data, or the
// canonical-model coverage. The renderer-visible surface is what this
// covers — every field listed here is something that ends up on the
// digest in some way.
//
// Match rules per section:
//
//   games          — by game.id (int, stable across vendors via MLB Stats API id)
//   boxScores      — by game.id; deep-compare team totals and per-player rows
//                    (rows matched by player.id)
//   nextDayGames   — by game.id
//   scoringPlays   — by game.id, then by (inning, half, awayScore, homeScore)
//                    since neither vendor exposes a stable per-play id we
//                    can match cross-source
//   standings      — by (league, division, team.id)
//   wildCard       — by (league, team.id)
//   leaderboards   — by (league, category); within a board, by rank
//   transactions   — no stable cross-vendor id, so we only compare count
//                    + a per-row "left/right has this player but other
//                    doesn't" view keyed by player.id where available

import type { CanonicalDailyData } from "./canonical";
import type {
  MlbBoxPlayer,
  MlbBoxScore,
  MlbBoxTeam,
  MlbDivisionStandings,
  MlbGame,
  MlbLeaderboard,
  MlbLeaderCategory,
  MlbScoringPlay,
  MlbStandingRow,
  MlbTransaction,
  MlbWildCardStandings,
} from "./types";

// ─── Report shape ────────────────────────────────────────────────────────

export type DiffStatus = "match" | "differ" | "left-only" | "right-only";

export type FieldDiff = {
  /** Dotted path: "awayScore", "home.totals.rbi", "batters[Aaron Judge].batting.atBats" */
  path:  string;
  left:  unknown;
  right: unknown;
};

export type EntityDiff = {
  /** Stable label for the entity — game id + matchup, team abbr, etc. */
  label:  string;
  /** Stable matching key, mirrors data-diff-key emitted by the renderer
   *  so the overlay can flip the right element. e.g. "game:778899",
   *  "standings:AL/East/147", "leader:AL/battingAverage/1", "txn:player:592450". */
  key:    string;
  status: DiffStatus;
  fields: FieldDiff[];
};

export type SectionDiff = {
  name:        string;
  /** "12 of 15 entities match" */
  summary:     string;
  /** Counts useful for the section header */
  total:       number;
  matched:     number;
  differing:   number;
  leftOnly:    number;
  rightOnly:   number;
  entities:    EntityDiff[];
};

export type DiffReport = {
  leftLabel:  string;
  rightLabel: string;
  date:       string;
  sections:   SectionDiff[];
};

// ─── Generic helpers ────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Approximate numeric equality so that 0.298 vs 0.2980000001 doesn't
 *  trip a false-positive. Threshold is small enough that real stat
 *  differences (which round to 3 decimals) still register. */
function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) < eps;
}

/** Value equality used by the field-walker. Treats null/undefined as the
 *  same hole; arrays equal iff same length and element-by-element equal;
 *  objects equal iff same keys and per-key equal; numbers use nearlyEqual. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") return nearlyEqual(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!valuesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!valuesEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/** Walk a typed object and collect a flat list of differing leaves. Only
 *  leaves the section comparator opts into (via the `paths` map) are
 *  reported — avoids dumping every internal id field as a "diff." */
function diffPaths<T extends Record<string, unknown>>(
  left:  T,
  right: T,
  paths: Record<string, (v: T) => unknown>,
): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const [path, picker] of Object.entries(paths)) {
    const l = picker(left);
    const r = picker(right);
    if (!valuesEqual(l, r)) out.push({ path, left: l, right: r });
  }
  return out;
}

// ─── Games (schedule + matchup level) ───────────────────────────────────

// Fields actually rendered in the Yesterday's Results / Today's Games
// strip — team identity, scores, and the status-detail tag that shows
// for non-Final games. Hits / errors / inning count / decisions show in
// box scores, which get their own diff section (and their own key
// namespace), so we don't flag them here.
const GAME_FIELDS: Record<string, (g: MlbGame) => unknown> = {
  status:          (g) => g.status,
  statusDetail:    (g) => g.statusDetail,
  awayScore:       (g) => g.awayScore,
  homeScore:       (g) => g.homeScore,
  "awayTeam.abbr": (g) => g.awayTeam.abbr,
  "homeTeam.abbr": (g) => g.homeTeam.abbr,
};

function gameLabel(g: MlbGame): string {
  return `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}`;
}

// Match key for cross-vendor game diffing. Vendor game ids never agree
// (statsapi 823452 vs SDIO 78364 for the same matchup) so we key on the
// canonical team pair instead. Doubleheaders on the same day for the
// same pair would collide here — acceptable for now since they're <1%
// of MLB days; extend with a game-number disambiguator when we hit one.
function gameMatchKey(g: MlbGame): string {
  return `${g.awayTeam.id}/${g.homeTeam.id}`;
}

function diffGames(left: MlbGame[], right: MlbGame[], keyPrefix: "game" | "nextDay"): EntityDiff[] {
  const leftBy  = new Map(left.map((g) => [gameMatchKey(g), g]));
  const rightBy = new Map(right.map((g) => [gameMatchKey(g), g]));
  const out: EntityDiff[] = [];
  const seen = new Set<string>();
  for (const [matchKey, lg] of leftBy) {
    const rg = rightBy.get(matchKey);
    seen.add(matchKey);
    const key = `${keyPrefix}:${matchKey}`;
    if (!rg) {
      out.push({ label: gameLabel(lg), key, status: "left-only", fields: [] });
      continue;
    }
    const fields = diffPaths(lg, rg, GAME_FIELDS);
    out.push({
      label:  gameLabel(lg),
      key,
      status: fields.length === 0 ? "match" : "differ",
      fields,
    });
  }
  for (const [matchKey, rg] of rightBy) {
    if (seen.has(matchKey)) continue;
    out.push({
      label:  gameLabel(rg),
      key:    `${keyPrefix}:${matchKey}`,
      status: "right-only",
      fields: [],
    });
  }
  return out;
}

// ─── Standings ──────────────────────────────────────────────────────────

// Round to the renderer's display precision before comparing. Two vendors
// can carry the same on-screen .614 as 0.614 vs 0.6142857… and a naive
// numeric compare would flag every row. The renderer's fmtPct shows 3
// decimals, fmtGb shows whole or 1 decimal — match those exactly.
const roundPct = (v: number | null): number | null => v == null ? null : Math.round(v * 1000) / 1000;
const roundGb  = (v: number | null): number | null => v == null ? null : Math.round(v * 10) / 10;

// Fields the canonical renderer actually writes into the division
// standings row. Anything not in this map (divisionRank, clinch flags,
// inter-league split, etc.) won't trigger a highlight even when vendors
// disagree on it. Differential is the rendered form of runsScored -
// runsAllowed so we compare that, not the raw counts.
const DIVISION_ROW_FIELDS: Record<string, (r: MlbStandingRow) => unknown> = {
  wins:                   (r) => r.wins,
  losses:                 (r) => r.losses,
  "leagueRecord.pct":     (r) => roundPct(r.leagueRecord.pct),
  gamesBehind:            (r) => roundGb(r.gamesBehind),
  diff:                   (r) => r.runsScored - r.runsAllowed,
  "homeRecord.wins":      (r) => r.homeRecord.wins,
  "homeRecord.losses":    (r) => r.homeRecord.losses,
  "awayRecord.wins":      (r) => r.awayRecord.wins,
  "awayRecord.losses":    (r) => r.awayRecord.losses,
  "lastTenRecord.wins":   (r) => r.lastTenRecord.wins,
  "lastTenRecord.losses": (r) => r.lastTenRecord.losses,
  streak:                 (r) => r.streak,
};

// Same idea for the wild-card table — drops the division GB column and
// uses wildCardGamesBehind instead.
const WILDCARD_ROW_FIELDS: Record<string, (r: MlbStandingRow) => unknown> = {
  wins:                   (r) => r.wins,
  losses:                 (r) => r.losses,
  "leagueRecord.pct":     (r) => roundPct(r.leagueRecord.pct),
  wildCardGamesBehind:    (r) => roundGb(r.wildCardGamesBehind),
  diff:                   (r) => r.runsScored - r.runsAllowed,
  "homeRecord.wins":      (r) => r.homeRecord.wins,
  "homeRecord.losses":    (r) => r.homeRecord.losses,
  "awayRecord.wins":      (r) => r.awayRecord.wins,
  "awayRecord.losses":    (r) => r.awayRecord.losses,
  "lastTenRecord.wins":   (r) => r.lastTenRecord.wins,
  "lastTenRecord.losses": (r) => r.lastTenRecord.losses,
  streak:                 (r) => r.streak,
};

function diffStandings(left: MlbDivisionStandings[], right: MlbDivisionStandings[]): EntityDiff[] {
  const out: EntityDiff[] = [];
  // Match by (league, division, canonical team slug). team.id is the
  // canonical slug by the canonical-model contract — no helper needed.
  type FlatRow = { league: string; division: string; row: MlbStandingRow };
  const flatten = (groups: MlbDivisionStandings[]): Map<string, FlatRow> => {
    const m = new Map<string, FlatRow>();
    for (const g of groups) {
      for (const r of g.teams) {
        m.set(`${g.league}/${g.division}/${r.team.id}`, { league: g.league, division: g.division, row: r });
      }
    }
    return m;
  };
  const leftMap  = flatten(left);
  const rightMap = flatten(right);
  const seen = new Set<string>();
  for (const [key, l] of leftMap) {
    const r = rightMap.get(key);
    seen.add(key);
    const label = `${l.league} ${l.division} — ${l.row.team.abbr}`;
    const diffKey = `standings:${l.league}/${l.division}/${l.row.team.id}`;
    if (!r) {
      out.push({ label, key: diffKey, status: "left-only", fields: [] });
      continue;
    }
    const fields = diffPaths(l.row, r.row, DIVISION_ROW_FIELDS);
    out.push({ label, key: diffKey, status: fields.length === 0 ? "match" : "differ", fields });
  }
  for (const [key, r] of rightMap) {
    if (seen.has(key)) continue;
    out.push({
      label:  `${r.league} ${r.division} — ${r.row.team.abbr}`,
      key:    `standings:${r.league}/${r.division}/${r.row.team.id}`,
      status: "right-only",
      fields: [],
    });
  }
  return out;
}

// ─── Wild card ──────────────────────────────────────────────────────────

function diffWildCard(left: MlbWildCardStandings[], right: MlbWildCardStandings[]): EntityDiff[] {
  const out: EntityDiff[] = [];
  type FlatRow = { league: string; row: MlbStandingRow };
  const flatten = (groups: MlbWildCardStandings[]): Map<string, FlatRow> => {
    const m = new Map<string, FlatRow>();
    for (const g of groups) {
      for (const r of g.teams) {
        m.set(`${g.league}/${r.team.id}`, { league: g.league, row: r });
      }
    }
    return m;
  };
  const leftMap  = flatten(left);
  const rightMap = flatten(right);
  const seen = new Set<string>();
  for (const [key, l] of leftMap) {
    const r = rightMap.get(key);
    seen.add(key);
    const label = `WC ${l.league} — ${l.row.team.abbr}`;
    const diffKey = `wc:${l.league}/${l.row.team.id}`;
    if (!r) {
      out.push({ label, key: diffKey, status: "left-only", fields: [] });
      continue;
    }
    const fields = diffPaths(l.row, r.row, WILDCARD_ROW_FIELDS);
    out.push({ label, key: diffKey, status: fields.length === 0 ? "match" : "differ", fields });
  }
  for (const [key, r] of rightMap) {
    if (seen.has(key)) continue;
    out.push({
      label:  `WC ${r.league} — ${r.row.team.abbr}`,
      key:    `wc:${r.league}/${r.row.team.id}`,
      status: "right-only",
      fields: [],
    });
  }
  return out;
}

// ─── Leaderboards ───────────────────────────────────────────────────────

// Format a leader value at the precision the renderer displays — 3
// decimals stripped of leading zero for rates (AVG / OPS / OBP / SLG /
// WHIP), 2 decimals for ERA, integer for counting stats. Mirrors
// formatLeaderValue in lib/sports/mlb/render/web.ts; deliberately
// duplicated rather than imported so the diff module stays renderer-
// agnostic.
const DISPLAY_RATE_3 = new Set<MlbLeaderCategory>([
  "battingAverage", "ops", "onBasePercentage", "sluggingPercentage", "whip",
]);
function displayLeaderValue(category: MlbLeaderCategory, v: number): string {
  if (DISPLAY_RATE_3.has(category)) return v.toFixed(3).replace(/^0/, "");
  if (category === "earnedRunAverage") return v.toFixed(2);
  return String(Math.round(v));
}

function diffLeaders(left: MlbLeaderboard[], right: MlbLeaderboard[]): EntityDiff[] {
  const leftMap  = new Map(left.map ((b) => [`${b.league}/${b.category}`, b]));
  const rightMap = new Map(right.map((b) => [`${b.league}/${b.category}`, b]));
  const seen = new Set<string>();
  const out: EntityDiff[] = [];
  for (const [key, lb] of leftMap) {
    const rb = rightMap.get(key);
    seen.add(key);
    const label = `${lb.league} ${lb.category}`;
    const diffKey = `leader:${lb.league}/${lb.category}`;
    if (!rb) {
      out.push({ label, key: diffKey, status: "left-only", fields: [] });
      continue;
    }
    // Compare top-5 by rank ordering. Vendor ranking-algorithm
    // differences land as "rank 1: NYY player X (.345) vs SDIO player Y
    // (.340)". Values are rounded to display precision before comparing
    // — statsapi pre-rounds rates (ERA "2.41") while SDIO returns full
    // floats (2.413). Both render as "2.41" so we shouldn't flag them.
    const fields: FieldDiff[] = [];
    const lTop = lb.entries.slice(0, 5);
    const rTop = rb.entries.slice(0, 5);
    const max = Math.max(lTop.length, rTop.length);
    for (let i = 0; i < max; i++) {
      const li = lTop[i];
      const ri = rTop[i];
      const lDesc = li ? `${li.player.fullName} (${li.team.abbr}) ${displayLeaderValue(lb.category, li.value)}` : "—";
      const rDesc = ri ? `${ri.player.fullName} (${ri.team.abbr}) ${displayLeaderValue(lb.category, ri.value)}` : "—";
      if (lDesc !== rDesc) fields.push({ path: `rank ${i + 1}`, left: lDesc, right: rDesc });
    }
    out.push({ label, key: diffKey, status: fields.length === 0 ? "match" : "differ", fields });
  }
  for (const [key, rb] of rightMap) {
    if (seen.has(key)) continue;
    out.push({
      label:  `${rb.league} ${rb.category}`,
      key:    `leader:${rb.league}/${rb.category}`,
      status: "right-only",
      fields: [],
    });
  }
  return out;
}

// ─── Transactions ──────────────────────────────────────────────────────

function diffTransactions(left: MlbTransaction[], right: MlbTransaction[]): EntityDiff[] {
  // No stable cross-vendor key. Compare by player.id where possible — a
  // transaction with a known player.id should appear on both sides if
  // both vendors carry the event. Items without player.id (rare) fall
  // back to description-substring matching but are noisier; we surface
  // them as either-side-only so the operator can eyeball.
  const out: EntityDiff[] = [];
  const leftByPid  = new Map<string, MlbTransaction>();
  const rightByPid = new Map<string, MlbTransaction>();
  const leftLoose  = left.filter ((t) => t.player == null);
  const rightLoose = right.filter((t) => t.player == null);
  for (const t of left)  if (t.player) leftByPid.set(t.player.id, t);
  for (const t of right) if (t.player) rightByPid.set(t.player.id, t);
  const seen = new Set<string>();
  for (const [pid, lt] of leftByPid) {
    const rt = rightByPid.get(pid);
    seen.add(pid);
    const who = lt.player?.fullName ?? `Player ${pid}`;
    const key = `txn:player:${pid}`;
    if (!rt) {
      out.push({ label: who, key, status: "left-only", fields: [
        { path: "description", left: lt.description, right: "—" },
      ] });
      continue;
    }
    if (lt.description.trim() !== rt.description.trim()) {
      out.push({
        label:  who, key, status: "differ",
        fields: [{ path: "description", left: lt.description, right: rt.description }],
      });
    } else {
      out.push({ label: who, key, status: "match", fields: [] });
    }
  }
  for (const [pid, rt] of rightByPid) {
    if (seen.has(pid)) continue;
    const who = rt.player?.fullName ?? `Player ${pid}`;
    out.push({
      label:  who,
      key:    `txn:player:${pid}`,
      status: "right-only",
      fields: [{ path: "description", left: "—", right: rt.description }],
    });
  }
  if (leftLoose.length !== rightLoose.length) {
    out.push({
      label:  "(transactions without player.id)",
      key:    "txn:loose",
      status: "differ",
      fields: [
        { path: "count", left: leftLoose.length, right: rightLoose.length },
      ],
    });
  }
  return out;
}

// ─── Box scores (deep) ──────────────────────────────────────────────────

// Display-precision rounding to match the renderer's on-screen format.
// Same trick we use for standings: a vendor difference that disappears
// after rounding to the displayed precision should not light up a row.
const round3 = (v: number | null): number | null => v == null ? null : Math.round(v * 1000) / 1000;
const round2 = (v: number | null): number | null => v == null ? null : Math.round(v * 100)  / 100;
// Inningsa-pitched is the .0/.1/.2 baseball convention; round to that. Both
// adapters now normalize on the way in, but defend against precision drift.
const roundIp = (v: number | null): number | null => v == null ? null : Math.round(v * 10) / 10;

// Renderer-visible position: allPositionsAbbr joined, falling back to
// positionAbbr. We compare that rolled-up form, not the raw fields.
const renderedPosition = (p: MlbBoxPlayer): string =>
  (p.allPositionsAbbr && p.allPositionsAbbr.length > 0
    ? p.allPositionsAbbr.join("-")
    : p.positionAbbr).toUpperCase();

const PLAYER_BATTING_FIELDS: Record<string, (p: MlbBoxPlayer) => unknown> = {
  position:           renderedPosition,
  "batting.atBats":   (p) => p.batting?.atBats ?? null,
  "batting.runs":     (p) => p.batting?.runs ?? null,
  "batting.hits":     (p) => p.batting?.hits ?? null,
  "batting.rbi":      (p) => p.batting?.rbi ?? null,
  "batting.baseOnBalls": (p) => p.batting?.baseOnBalls ?? null,
  "batting.strikeOuts":  (p) => p.batting?.strikeOuts ?? null,
  "batting.homeRuns":    (p) => p.batting?.homeRuns ?? null,
  "batting.doubles":     (p) => p.batting?.doubles ?? null,
  "batting.triples":     (p) => p.batting?.triples ?? null,
  "batting.stolenBases": (p) => p.batting?.stolenBases ?? null,
  "seasonBatting.battingAverage": (p) => round3(p.seasonBatting?.battingAverage ?? null),
  "seasonBatting.ops":            (p) => round3(p.seasonBatting?.ops ?? null),
};

const PLAYER_PITCHING_FIELDS: Record<string, (p: MlbBoxPlayer) => unknown> = {
  "pitching.inningsPitched": (p) => roundIp(p.pitching?.inningsPitched ?? null),
  "pitching.hits":           (p) => p.pitching?.hits ?? null,
  "pitching.runs":           (p) => p.pitching?.runs ?? null,
  "pitching.earnedRuns":     (p) => p.pitching?.earnedRuns ?? null,
  "pitching.baseOnBalls":    (p) => p.pitching?.baseOnBalls ?? null,
  "pitching.strikeOuts":     (p) => p.pitching?.strikeOuts ?? null,
  "pitching.homeRuns":       (p) => p.pitching?.homeRuns ?? null,
  "pitching.pitchesThrown":  (p) => p.pitching?.pitchesThrown ?? null,
  "seasonPitching.era":      (p) => round2(p.seasonPitching?.era ?? null),
};

const TEAM_TOTAL_FIELDS = {
  "totals.atBats":      (t: MlbBoxTeam) => t.totals.atBats,
  "totals.runs":        (t: MlbBoxTeam) => t.totals.runs,
  "totals.hits":        (t: MlbBoxTeam) => t.totals.hits,
  "totals.rbi":         (t: MlbBoxTeam) => t.totals.rbi,
  "totals.homeRuns":    (t: MlbBoxTeam) => t.totals.homeRuns,
  "totals.baseOnBalls": (t: MlbBoxTeam) => t.totals.baseOnBalls,
  "totals.strikeOuts":  (t: MlbBoxTeam) => t.totals.strikeOuts,
} as const;

// Cross-vendor player keying: vendor PlayerIDs never agree, and even the
// player's full name can drift on accents ("Hernández" vs "Hernandez")
// and suffixes ("Tatis Jr." vs "Tatis Jr"). Normalize before matching.
function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[.,]/g, "")        // drop punctuation
    .replace(/\s+jr\b/g, " jr")  // collapse "Jr." / "Jr" / "JR"
    .replace(/\s+sr\b/g, " sr")
    .replace(/\s+/g, " ")
    .trim();
}

// Per-player diffs: emit ONE EntityDiff per player row so highlightKeysFor
// can outline an individual row. Cross-team / cross-vendor matching uses
// the normalized full name as the key.
function diffPlayersEntities(
  boxKey: string,
  side: "away" | "home",
  group: "batters" | "pitchers",
  leftTeam: MlbBoxTeam,
  rightTeam: MlbBoxTeam,
  fieldMap: Record<string, (p: MlbBoxPlayer) => unknown>,
): EntityDiff[] {
  const out: EntityDiff[] = [];
  const leftMap  = new Map(leftTeam[group] .map((p) => [normalizeName(p.player.fullName), p]));
  const rightMap = new Map(rightTeam[group].map((p) => [normalizeName(p.player.fullName), p]));
  const seen = new Set<string>();
  for (const [nname, lp] of leftMap) {
    seen.add(nname);
    const rp = rightMap.get(nname);
    const key = `${boxKey}:${side}:${group}:${nname}`;
    const label = `${side}/${group}: ${lp.player.fullName}`;
    if (!rp) {
      out.push({ label, key, status: "left-only", fields: [] });
      continue;
    }
    const fields = diffPaths(lp, rp, fieldMap);
    out.push({
      label,
      key,
      status: fields.length === 0 ? "match" : "differ",
      fields,
    });
  }
  for (const [nname, rp] of rightMap) {
    if (seen.has(nname)) continue;
    out.push({
      label:  `${side}/${group}: ${rp.player.fullName}`,
      key:    `${boxKey}:${side}:${group}:${nname}`,
      status: "right-only",
      fields: [],
    });
  }
  return out;
}

function diffBoxScores(
  leftMap:  Map<number, MlbBoxScore>,
  rightMap: Map<number, MlbBoxScore>,
): EntityDiff[] {
  // Vendor box IDs (= game IDs) never agree across statsapi/SDIO, so
  // match on the canonical team-pair like diffGames does. Doubleheaders
  // would collide but they're <1% of days.
  const boxKey = (b: MlbBoxScore): string =>
    `box:${b.away.team.id}/${b.home.team.id}`;

  const leftBy  = new Map(Array.from(leftMap.values()) .map((b) => [boxKey(b), b]));
  const rightBy = new Map(Array.from(rightMap.values()).map((b) => [boxKey(b), b]));

  const out: EntityDiff[] = [];
  const seen = new Set<string>();
  for (const [bkey, lbox] of leftBy) {
    seen.add(bkey);
    const rbox = rightBy.get(bkey);
    const label = `${lbox.away.team.abbr} @ ${lbox.home.team.abbr}`;
    if (!rbox) {
      out.push({ label, key: bkey, status: "left-only", fields: [] });
      continue;
    }

    // Team totals row (per side) — its own EntityDiff so the renderer can
    // outline the totals row independently.
    for (const side of ["away", "home"] as const) {
      const teamLeft  = side === "away" ? lbox.away : lbox.home;
      const teamRight = side === "away" ? rbox.away : rbox.home;
      const totalsFields: FieldDiff[] = [];
      for (const [path, picker] of Object.entries(TEAM_TOTAL_FIELDS)) {
        const lv = picker(teamLeft);
        const rv = picker(teamRight);
        if (!valuesEqual(lv, rv)) totalsFields.push({ path, left: lv, right: rv });
      }
      out.push({
        label: `${teamLeft.team.abbr} totals`,
        key:   `${bkey}:${side}:totals`,
        status: totalsFields.length === 0 ? "match" : "differ",
        fields: totalsFields,
      });
    }

    // Per-player rows
    out.push(...diffPlayersEntities(bkey, "away", "batters",  lbox.away, rbox.away, PLAYER_BATTING_FIELDS));
    out.push(...diffPlayersEntities(bkey, "home", "batters",  lbox.home, rbox.home, PLAYER_BATTING_FIELDS));
    out.push(...diffPlayersEntities(bkey, "away", "pitchers", lbox.away, rbox.away, PLAYER_PITCHING_FIELDS));
    out.push(...diffPlayersEntities(bkey, "home", "pitchers", lbox.home, rbox.home, PLAYER_PITCHING_FIELDS));
  }
  for (const [bkey, rbox] of rightBy) {
    if (seen.has(bkey)) continue;
    out.push({
      label:  `${rbox.away.team.abbr} @ ${rbox.home.team.abbr}`,
      key:    bkey,
      status: "right-only",
      fields: [],
    });
  }
  return out;
}

// ─── Scoring plays ──────────────────────────────────────────────────────

function diffScoringPlays(
  left:  Map<number, MlbScoringPlay[]>,
  right: Map<number, MlbScoringPlay[]>,
): EntityDiff[] {
  const out: EntityDiff[] = [];
  const seen = new Set<number>();
  for (const [id, lp] of left) {
    const rp = right.get(id) ?? [];
    seen.add(id);
    const label = `Plays for game ${id}`;
    const key = `plays:${id}`;
    const fields: FieldDiff[] = [];
    if (lp.length !== rp.length) {
      fields.push({ path: "count", left: lp.length, right: rp.length });
    }
    // Match plays by (inning, half, score state) so vendor disagreement
    // on play numbering doesn't trigger false diffs.
    const playKey = (p: MlbScoringPlay) => `${p.inning}.${p.half}.${p.awayScore}-${p.homeScore}`;
    const lByKey = new Map(lp.map((p) => [playKey(p), p]));
    const rByKey = new Map(rp.map((p) => [playKey(p), p]));
    for (const [k, l] of lByKey) {
      const r = rByKey.get(k);
      if (!r) fields.push({ path: `play[${k}]`, left: l.description, right: "—" });
    }
    for (const [k, r] of rByKey) {
      if (!lByKey.has(k)) fields.push({ path: `play[${k}]`, left: "—", right: r.description });
    }
    out.push({ label, key, status: fields.length === 0 ? "match" : "differ", fields });
  }
  for (const [id, rp] of right) {
    if (seen.has(id)) continue;
    out.push({
      label:  `Plays for game ${id}`,
      key:    `plays:${id}`,
      status: "right-only",
      fields: [{ path: "count", left: 0, right: rp.length }],
    });
  }
  return out;
}

// ─── Top-level ──────────────────────────────────────────────────────────

function summarizeEntities(name: string, entities: EntityDiff[]): SectionDiff {
  let matched = 0, differing = 0, leftOnly = 0, rightOnly = 0;
  for (const e of entities) {
    if      (e.status === "match")     matched++;
    else if (e.status === "differ")    differing++;
    else if (e.status === "left-only") leftOnly++;
    else                                rightOnly++;
  }
  const total = entities.length;
  const parts: string[] = [`${matched}/${total} match`];
  if (differing > 0) parts.push(`${differing} differ`);
  if (leftOnly  > 0) parts.push(`${leftOnly} left-only`);
  if (rightOnly > 0) parts.push(`${rightOnly} right-only`);
  return {
    name,
    summary: parts.join(", "),
    total, matched, differing, leftOnly, rightOnly,
    entities,
  };
}

export function diffCanonical(
  leftLabel:  string,
  rightLabel: string,
  left:       CanonicalDailyData,
  right:      CanonicalDailyData,
): DiffReport {
  const sections: SectionDiff[] = [
    summarizeEntities("Games",         diffGames(left.games, right.games, "game")),
    summarizeEntities("Box scores",    diffBoxScores(left.boxScores, right.boxScores)),
    summarizeEntities("Scoring plays", diffScoringPlays(left.scoringPlays, right.scoringPlays)),
    summarizeEntities("Standings",     diffStandings(left.standings, right.standings)),
    summarizeEntities("Wild card",     diffWildCard(left.wildCard, right.wildCard)),
    summarizeEntities("Leaderboards",  diffLeaders(left.leaderboards, right.leaderboards)),
    summarizeEntities("Transactions",  diffTransactions(left.transactions, right.transactions)),
    summarizeEntities("Next-day games", diffGames(left.nextDayGames, right.nextDayGames, "nextDay")),
  ];
  return { leftLabel, rightLabel, date: left.date, sections };
}

// ─── Highlight set derivation ───────────────────────────────────────────

/** Build the set of element keys to flag on a rendered preview, scoped to
 *  one side of the diff. The keys match what the canonical renderer emits
 *  as `data-diff-key`. Leaderboard diffs explode per-rank because the
 *  renderer emits a key per leader row, not per leaderboard.
 *
 *  side="left" → keys to highlight on the left-source render (matches
 *  EntityDiff status "differ" + "left-only"). side="right" → the mirror. */
export function highlightKeysFor(report: DiffReport, side: "left" | "right"): Map<string, string> {
  // Value is a short tooltip string so the renderer can put it in a title
  // attribute. Operators hovering an outlined row see the diff inline.
  const out = new Map<string, string>();
  const summarize = (e: EntityDiff): string => {
    if (e.status === "left-only")  return `${report.leftLabel} only`;
    if (e.status === "right-only") return `${report.rightLabel} only`;
    if (e.fields.length === 0)     return "Differs";
    return e.fields
      .map((f) => `${f.path}: ${formatVal(f.left)} → ${formatVal(f.right)}`)
      .join(" · ");
  };
  for (const section of report.sections) {
    for (const e of section.entities) {
      if (e.status === "match")     continue;
      if (e.status === "left-only"  && side === "right") continue;
      if (e.status === "right-only" && side === "left")  continue;

      // Leaderboard EntityDiffs cover a whole (league, category). The
      // renderer emits per-rank keys, so explode the diff fields ("rank
      // 1", "rank 2", ...) into individual key entries.
      if (e.key.startsWith("leader:") && e.status === "differ") {
        for (const f of e.fields) {
          const m = f.path.match(/^rank (\d+)$/);
          if (!m) continue;
          out.set(`${e.key}/${m[1]}`, `${formatVal(f.left)} → ${formatVal(f.right)}`);
        }
        continue;
      }
      out.set(e.key, summarize(e));
    }
  }
  return out;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 60) + "…" : v;
  return JSON.stringify(v);
}

// Teammates puzzle generator (server-only). Deterministic per date: same date
// -> same puzzle for every player, because all randomness flows through a
// date-seeded PRNG. Mirrors scripts/generate-teammates-puzzle.ts; the script is
// the offline sandbox, this is the runtime source of truth.
//
// A puzzle is 16 recognizable players that partition into 4 franchises of 4. A
// player is placed only on a team they had real TENURE with (>= TENURE_G games
// or >= TENURE_S seasons), and the intended partition is verified UNIQUE before
// the puzzle is emitted. Difficulty = number of multi-team "trap" players.

import poolData from "./pool.json";

export type StatBlock = Record<string, number | string | null>;
type PoolTeam = { id: number; label: string; g: number; years: number[] };
type PoolLine = { y: number; tid: number; tm: string; k: "bat" | "pit"; s: StatBlock; label: string };
type PoolPlayer = { id: number; name: string; pos: string | null; num: string | null; teams: PoolTeam[]; lines: PoolLine[]; career: { bat?: StatBlock; pit?: StatBlock }; fame: string[]; careerG: number | null; careerIP: number | null };
const pool = poolData as PoolPlayer[];

export type Tile = { id: number; name: string };
export type SolutionGroup = { team: string; playerIds: number[] };
export type Difficulty = "easy" | "medium" | "hard";
// A baseball-card stat row: `label` is the canonical franchise (for highlighting
// against puzzle teams); `team` is the era name shown to the player.
export type StatLine = { y: number; label: string; team: string; k: "bat" | "pit"; s: StatBlock };
export type PlayerCard = { id: number; name: string; pos: string | null; num: string | null; hof: boolean; career: { bat?: StatBlock; pit?: StatBlock }; lines: StatLine[] };
export type TeammatesPuzzle = {
  date: string;
  difficulty: Difficulty;
  tiles: Tile[];
  groups: SolutionGroup[];
  cards: PlayerCard[];
  traps: { name: string; team: string; decoys: { team: string; years: string }[] }[];
};

// Compress a sorted distinct year list into readable ranges: [1979,1980,1981,1985]
// -> "1979–81, 1985". Non-consecutive stints (common for well-traveled players)
// stay separated so the explanation is honest about gaps.
function fmtYears(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (!ys.length) return "";
  const out: string[] = [];
  let start = ys[0]!, prev = ys[0]!;
  for (let i = 1; i < ys.length; i++) {
    const y = ys[i]!;
    if (y === prev + 1) { prev = y; continue; }
    out.push(start === prev ? `${start}` : `${start}–${String(prev).slice(-2)}`);
    start = prev = y;
  }
  out.push(start === prev ? `${start}` : `${start}–${String(prev).slice(-2)}`);
  return out.join(", ");
}

// ---- tuning (kept in sync with the script) ----
const TENURE_G = 50;
const TENURE_S = 2;
const MIN_DEPTH = 25;
// Franchises NOT eligible as puzzle COLUMNS. "Washington Senators" is an
// ambiguous double (ids 140 & 142 share the label). The rest are defunct
// franchises too thin in *recognizable* players to fill a fair column — they'd
// fill with obscure names (Fred Frankhouse, Norm Siebern…). A numeric HOF/marquee
// threshold can't separate these: Boston Braves has 31 HOFers but they're
// deadball-era obscure, while beloved Milwaukee Braves has only 6 (Aaron/Spahn/
// Mathews). So this is a curated list — easy to adjust. Excluded teams' stars
// still appear as PLAYERS on other franchises and on stat cards.
const EXCLUDE_LABELS = new Set([
  "Washington Senators",
  "Boston Braves",
  "St. Louis Browns",
  "Kansas City Athletics",
]);

// Display-name overrides for players whose statsapi fullName carries a legally-
// correct but colloquially-wrong suffix (Nolan Ryan's legal name is "…Jr." but
// nobody calls him that). Griffey/Ripken/Acuña Jr. are left alone — they ARE
// known with the suffix. Extend as odd cases surface.
const NAME_OVERRIDE: Record<string, string> = { "Nolan Ryan Jr.": "Nolan Ryan" };
const displayName = (n: string) => NAME_OVERRIDE[n] ?? n;

// Difficulty ramps across the week, NYT-style: gentle early, spicy on weekends.
// getDay(): 0=Sun ... 6=Sat (computed in ET below).
const WEEKDAY_DIFFICULTY: Difficulty[] = ["hard", "easy", "easy", "medium", "medium", "hard", "hard"];

// ---- seeded PRNG (mulberry32) ----
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
function shuffle<T>(a: T[], rng: Rng): T[] { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = r[i]!; r[i] = r[j]!; r[j] = tmp; } return r; }

// ---- career-share difficulty tiers ----
// A category's difficulty is set by how obviously its players belong to the team,
// measured as career SHARE = games-with-team / total-career-games:
//   yellow  4 players all >=80%             (pure)
//   green   all >=50%, at least 2 at >=80%  (a majority guy or two mixed in)
//   blue    >=1 anchor at >=80%, exactly one <=25%, rest >=50%
//   purple  >=1 anchor at >=80%, up to two <=25%, rest >=50%
const LOCK = 0.80, MAJOR = 0.50, CAMEO = 0.25;

// ---- precomputed pool structures (built once at module load) ----
const known = (p: PoolPlayer) => p.fame.length > 0 || (p.careerG ?? 0) >= 300 || (p.careerIP ?? 0) >= 400;
const tenuredEdge = (t: PoolTeam) => t.g >= TENURE_G || t.years.length >= TENURE_S;

const knownPool = pool.filter(known);
const tenureTeams = new Map<number, PoolTeam[]>();
const totalG = new Map<number, number>(); // total AL/NL career games (sum over teams)
for (const p of knownPool) {
  tenureTeams.set(p.id, p.teams.filter(tenuredEdge));
  totalG.set(p.id, p.teams.reduce((a, t) => a + t.g, 0));
}
// Recognizability for anchor/cameo ranking. careerG/careerIP are null for the
// whole fame roster, so lean on total career games (populated for everyone) —
// otherwise Mel Ott and a borderline HOFer would score identically.
const rec = (p: PoolPlayer) => p.fame.length * 500 + (totalG.get(p.id) ?? 0);
const recognizable = (p: PoolPlayer) => p.fame.length > 0 || (totalG.get(p.id) ?? 0) >= 1000;
const assoc = (p: PoolPlayer, label: string) => (p.teams.find((t) => t.label === label)?.g ?? 0) / (totalG.get(p.id) || 1);

const byLabel = new Map<string, PoolPlayer[]>();
// label -> franchise id, so a puzzle can require four DISTINCT franchises: two
// eras of one franchise (Boston/Milwaukee/Atlanta Braves share id 144, Brooklyn/
// LA Dodgers share 119) must never be two columns in the same grid.
const labelFranchise = new Map<string, number>();
for (const p of knownPool) for (const t of tenureTeams.get(p.id)!) {
  if (EXCLUDE_LABELS.has(t.label)) continue;
  (byLabel.get(t.label) ?? byLabel.set(t.label, []).get(t.label)!).push(p);
  if (!labelFranchise.has(t.label)) labelFranchise.set(t.label, t.id);
}
const usableTeams = [...byLabel.entries()].filter(([, ps]) => ps.length >= MIN_DEPTH).map(([l]) => l);

function countSolutions(elig: number[][]): number {
  const counts = [0, 0, 0, 0];
  const order = [...elig.keys()].sort((a, b) => elig[a]!.length - elig[b]!.length);
  let sols = 0;
  const walk = (i: number) => {
    if (sols > 1) return;
    if (i === order.length) { sols++; return; }
    for (const t of elig[order[i]!]!) if (counts[t]! < 4) { counts[t] = counts[t]! + 1; walk(i + 1); counts[t] = counts[t]! - 1; if (sols > 1) return; }
  };
  walk(0);
  return sols;
}

type Built = { teams: string[]; cols: PoolPlayer[][]; traps: TeammatesPuzzle["traps"] };

// All permutations of a 4-element array (assignments of teams to color slots).
function perms4<T>(a: T[]): T[][] {
  const out: T[][] = [];
  const walk = (cur: T[], rest: T[]) => {
    if (!rest.length) { out.push(cur); return; }
    for (let i = 0; i < rest.length; i++) walk([...cur, rest[i]!], [...rest.slice(0, i), ...rest.slice(i + 1)]);
  };
  walk([], a);
  return out;
}

// Build a puzzle whose four columns hit the yellow/green/blue/purple career-share
// profiles. Returns cols already ordered yellow(easiest)..purple(hardest).
function tryBuild(teams: string[], rng: Rng): Built | null {
  type Tier = { locks: PoolPlayer[]; majors: PoolPlayer[]; cameos: PoolPlayer[] };
  const buckets = new Map<string, Tier>();
  for (const t of teams) {
    const locks: PoolPlayer[] = [], majors: PoolPlayer[] = [], cameos: PoolPlayer[] = [];
    for (const p of byLabel.get(t) ?? []) {
      const a = assoc(p, t);
      if (a >= LOCK) locks.push(p);
      else if (a >= MAJOR) majors.push(p);
      else if (a <= CAMEO && recognizable(p)) cameos.push(p); // a cameo trap must be famous
    }
    const s = (arr: PoolPlayer[]) => shuffle(arr, rng).sort((x, y) => rec(y) - rec(x));
    buckets.set(t, { locks: s(locks), majors: s(majors), cameos: s(cameos) });
  }

  // Fill one team's column to a color profile (0=yellow,1=green,2=blue,3=purple).
  const buildCol = (team: string, color: number, used: Set<number>): PoolPlayer[] | null => {
    const t = buckets.get(team)!;
    const av = (arr: PoolPlayer[]) => arr.filter((p) => !used.has(p.id));
    const locks = av(t.locks), cameos = av(t.cameos);
    const ge50 = [...locks, ...av(t.majors)]; // >=50% share, locks first
    const fromGe50 = (n: number, minLocks: number): PoolPlayer[] | null => {
      const col = ge50.slice(0, n);
      return col.length === n && Math.min(n, locks.length) >= minLocks ? col : null;
    };
    let col: PoolPlayer[] | null;
    if (color === 0) col = locks.length >= 4 ? locks.slice(0, 4) : null;                  // yellow
    else if (color === 1) col = fromGe50(4, 2);                                            // green
    else if (color === 2) { const b = fromGe50(3, 1); col = b && cameos.length >= 1 ? [...cameos.slice(0, 1), ...b] : null; } // blue
    else { const b = fromGe50(2, 1); col = b && cameos.length >= 2 ? [...cameos.slice(0, 2), ...b] : null; }                  // purple
    if (!col || col.length !== 4) return null;
    col.forEach((p) => used.add(p.id));
    return col;
  };

  for (const perm of perms4(teams)) {
    const used = new Set<number>();
    const cols: PoolPlayer[][] = [[], [], [], []];
    let ok = true;
    // Fill cameo-heavy columns first (purple, blue) — cameos are the scarce piece.
    for (const color of [3, 2, 1, 0]) {
      const c = buildCol(perm[color]!, color, used);
      if (!c) { ok = false; break; }
      cols[color] = c;
    }
    if (!ok) continue;

    const idx = new Map(perm.map((t, i) => [t, i]));
    const inGrid = (p: PoolPlayer) => tenureTeams.get(p.id)!.filter((t) => idx.has(t.label));
    const elig = cols.flat().map((p) => inGrid(p).map((t) => idx.get(t.label)!));
    if (countSolutions(elig) !== 1) continue;

    // Record the cameo "trap" players (blue 1, purple 2) for CLI/curation insight.
    const traps: TeammatesPuzzle["traps"] = [];
    for (const [color, n] of [[2, 1], [3, 2]] as const) {
      for (const p of cols[color]!.slice(0, n)) {
        const others = p.teams.filter((tt) => tt.label !== perm[color] && tt.g > 0).sort((a, b) => b.g - a.g).slice(0, 3);
        traps.push({ name: p.name, team: perm[color]!, decoys: others.map((tt) => ({ team: tt.label, years: fmtYears(tt.years) })) });
      }
    }
    return { teams: perm, cols, traps };
  }
  return null;
}

// Pick 4 teams whose franchise ids are all distinct (no two eras of one team).
function pickTeams(rng: Rng): string[] {
  const teams: string[] = [];
  const usedFranchise = new Set<number>();
  for (const t of shuffle(usableTeams, rng)) {
    const fid = labelFranchise.get(t)!;
    if (usedFranchise.has(fid)) continue;
    usedFranchise.add(fid);
    teams.push(t);
    if (teams.length === 4) break;
  }
  return teams;
}

function buildForSeed(seed: number): Built | null {
  const rng = mulberry32(seed);
  for (let attempt = 0; attempt < 800; attempt++) {
    const teams = pickTeams(rng);
    if (teams.length < 4) continue;
    const b = tryBuild(teams, rng);
    if (b) return b;
  }
  return null;
}

const cache = new Map<string, TeammatesPuzzle>();

export function getPuzzleForDate(dateISO: string): TeammatesPuzzle {
  const cached = cache.get(dateISO);
  if (cached) return cached;

  // Weekday label kept only as flavor metadata — generation no longer varies by
  // it; every puzzle has the fixed yellow->purple career-share gradient.
  const dow = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  const difficulty = WEEKDAY_DIFFICULTY[dow] ?? "medium";

  // Try the date seed; if a seed can't yield a valid unique puzzle, perturb it.
  let built: Built | null = null;
  for (let k = 0; k < 12 && !built; k++) built = buildForSeed(hashSeed(`${dateISO}#${k}`));
  if (!built) throw new Error(`teammates: no puzzle for ${dateISO}`);

  // cols are already ordered yellow(easiest)..purple(hardest) by the profiles.
  const orderedPlayers = built.cols.flat();
  const rng = mulberry32(hashSeed(`${dateISO}#tiles`));
  const groups: SolutionGroup[] = built.cols.map((col, i) => ({ team: built!.teams[i]!, playerIds: col.map((p) => p.id) }));
  const tiles: Tile[] = shuffle(orderedPlayers.map((p) => ({ id: p.id, name: displayName(p.name) })), rng);

  // Attach each of the 16 players' baseball-card lines (year-sorted). Only these
  // 16 ship to the client, so the payload stays small despite the big pool.
  const cards: PlayerCard[] = orderedPlayers.map((p) => ({
    id: p.id,
    name: displayName(p.name),
    pos: p.pos,
    num: p.num,
    hof: p.fame.includes("HOF"),
    career: p.career ?? {},
    lines: [...p.lines]
      .sort((a, b) => a.y - b.y)
      .map((l) => ({ y: l.y, label: l.label, team: l.tm, k: l.k, s: l.s })),
  }));

  const puzzle: TeammatesPuzzle = { date: dateISO, difficulty, tiles, groups, cards, traps: built.traps };
  cache.set(dateISO, puzzle);
  return puzzle;
}

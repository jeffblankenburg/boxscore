// Builds the player -> {teams} pool for the "Teammates" game (a Connections-style
// grid where you group players by teams they've played for).
//
// The pool is the UNION of two buckets:
//   1. Fame roster (all eras): everyone who is famous *by construction* — HOF
//      inductees, All-Star selections (1933+), and MVP/Cy Young/Rookie of the Year
//      winners. No notability threshold needed; the award IS the bar. This is the
//      only bucket that reaches the 1920s-60s legends (Ruth, Cobb, Mays, ...).
//   2. Modern regulars: players with a season >= 2000 who clear a career
//      playing-time floor (position players >= MIN_G games, pitchers >= MIN_IP
//      innings). Sourced from the existing `player_seasons` table, so no crawl.
//
// Team-sets come from the AUTHORITATIVE statsapi yearByYear feed (one call per
// pool player), filtered to `league.id in {103,104}` = AL/NL only. That drops
// Negro Leagues (per product decision) and the obscure pre-1901 majors, leaving
// recognizable MLB franchises. Team ids are franchise-stable across relocations
// (Brooklyn/LA Dodgers share id 119), so a relocated team collapses to one entry.
//
// One-time, resumable (team-set hydration is checkpointed). Prints a summary.
// Run: npx tsx --env-file=.env.local scripts/build-team-affinity-pool.ts [--limit N]

import { supabaseAdmin } from "../lib/supabase";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";

const API = "https://statsapi.mlb.com/api/v1";
const AL = 103;
const NL = 104;
const KEEP_LEAGUES = new Set([AL, NL]);

const MIN_G = 200; // position-player career games floor (~1.5 seasons)
const MIN_IP = 250; // pitcher career innings floor
const FIRST_ASG_YEAR = 1933; // All-Star Game started in 1933
const MAX_YEAR = 2026;
const CONCURRENCY = 10;
const CHECKPOINT_EVERY = 250;

const OUT = "data/team-affinity-pool.json";
const CKPT = "data/.team-affinity-checkpoint-v5.json"; // v5 adds position, number, career totals

const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? parseInt(process.argv[i + 1] ?? "", 10) : Infinity;
})();

type Team = { id: number; name: string; g: number; years: number[] };
// One season-with-a-team stat line (baseball-card row). Compact keys to keep
// the bundled pool small; `s` holds the stat subset for the line's kind.
type StatBlock = Record<string, number | string | null>;
type SeasonLine = { y: number; tid: number; tm: string; k: "bat" | "pit"; s: StatBlock };
type PoolPlayer = {
  id: number;
  name: string;
  pos: string | null;   // primary position abbreviation (e.g. "LF", "P")
  num: string | null;   // primary jersey number
  teams: Team[];
  lines: SeasonLine[];
  career: { bat?: StatBlock; pit?: StatBlock }; // career totals per kind
  fame: string[]; // reasons: HOF | MVP | CY | ROY | ALLSTAR ; [] = modern-regular only
  careerG: number | null;
  careerIP: number | null;
};

async function getJson(url: string, tries = 4): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "boxscore-teamgame/1.0" } });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 300 * (a + 1)));
  }
  throw new Error(`fetch failed after ${tries}: ${url}`);
}

async function recipients(awardId: string, season?: number) {
  const u = `${API}/awards/${awardId}/recipients${season ? `?season=${season}` : ""}`;
  const d = await getJson(u);
  return ((d?.awards ?? []) as any[])
    .map((x) => ({ id: x.player?.id as number, name: x.player?.nameFirstLast as string }))
    .filter((x) => x.id);
}

// ---- bucket 1: fame roster ------------------------------------------------
async function buildFame(): Promise<Map<number, { name: string; reasons: Set<string> }>> {
  const fame = new Map<number, { name: string; reasons: Set<string> }>();
  const add = (id: number, name: string, why: string) => {
    const e = fame.get(id) ?? { name: name ?? "", reasons: new Set<string>() };
    if (name) e.name = name;
    e.reasons.add(why);
    fame.set(id, e);
  };

  // All-time career awards return every recipient in one call (no season param).
  const career: Array<[string, string]> = [
    ["MLBHOF", "HOF"],
    ["ALMVP", "MVP"],
    ["NLMVP", "MVP"],
    ["ALCY", "CY"],
    ["NLCY", "CY"],
    ["ALROY", "ROY"],
    ["NLROY", "ROY"],
  ];
  for (const [aw, why] of career) {
    for (const r of await recipients(aw)) add(r.id, r.name, why);
  }

  // All-Star selections must be pulled per season.
  for (let yr = FIRST_ASG_YEAR; yr <= MAX_YEAR; yr++) {
    for (const aw of ["ALAS", "NLAS"]) {
      for (const r of await recipients(aw, yr)) add(r.id, r.name, "ALLSTAR");
    }
  }
  return fame;
}

// ---- bucket 2: modern regulars from player_seasons ------------------------
// Tally career G/IP across ALL of a player's seasons; qualify anyone with a
// 2000+ season who clears the floor. Paginated by id cursor (1000-row cap).
async function buildModern(): Promise<Map<number, { careerG: number; careerIP: number }>> {
  const db = supabaseAdmin();
  const acc = new Map<number, { careerG: number; careerIP: number; modern: boolean }>();
  let cursor = 0;
  for (;;) {
    const { data, error } = await db
      .from("player_seasons")
      .select("id, player_id, season, games_played, ip")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`player_seasons: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data as any[]) {
      const e = acc.get(row.player_id) ?? { careerG: 0, careerIP: 0, modern: false };
      e.careerG += row.games_played ?? 0;
      e.careerIP += Number(row.ip ?? 0);
      if (row.season >= 2000) e.modern = true;
      acc.set(row.player_id, e);
    }
    cursor = (data[data.length - 1] as any).id;
  }
  const qualified = new Map<number, { careerG: number; careerIP: number }>();
  for (const [id, e] of acc) {
    if (e.modern && (e.careerG >= MIN_G || e.careerIP >= MIN_IP)) {
      qualified.set(id, { careerG: e.careerG, careerIP: e.careerIP });
    }
  }
  return qualified;
}

// ---- team-set hydration (authoritative yearByYear) ------------------------
const v = (x: unknown): number | string | null => (x === undefined || x === null ? null : (x as number | string));
function pickStats(kind: "bat" | "pit", st: Record<string, unknown>): StatBlock {
  return kind === "bat"
    ? { g: v(st.gamesPlayed), ab: v(st.atBats), r: v(st.runs), h: v(st.hits), hr: v(st.homeRuns), rbi: v(st.rbi), sb: v(st.stolenBases), bb: v(st.baseOnBalls), so: v(st.strikeOuts), avg: v(st.avg), obp: v(st.obp), slg: v(st.slg) }
    : { w: v(st.wins), l: v(st.losses), era: v(st.era), g: v(st.gamesPlayed), gs: v(st.gamesStarted), ip: v(st.inningsPitched), so: v(st.strikeOuts), bb: v(st.baseOnBalls), whip: v(st.whip), sv: v(st.saves) };
}

async function hydrateTeams(id: number): Promise<{ name: string; pos: string | null; num: string | null; teams: Team[]; lines: SeasonLine[]; career: { bat?: StatBlock; pit?: StatBlock } }> {
  const hydrate = encodeURIComponent("stats(group=[hitting,pitching],type=[yearByYear,career])");
  const d = await getJson(`${API}/people/${id}?hydrate=${hydrate}`);
  const p = d?.people?.[0];
  if (!p) return { name: "", pos: null, num: null, teams: [], lines: [], career: {} };
  // One pass builds the tenure aggregation, per-season stat lines, and career
  // totals. Tenure is per (franchise id, era-name) so relocations stay separable;
  // games per season use the max across hitting/pitching to avoid double-counting.
  const acc = new Map<string, { id: number; name: string; seasonG: Map<number, number> }>();
  const lines: SeasonLine[] = [];
  const career: { bat?: StatBlock; pit?: StatBlock } = {};
  for (const grp of p.stats ?? []) {
    const kind: "bat" | "pit" = grp.group?.displayName === "pitching" ? "pit" : "bat";
    const isCareer = grp.type?.displayName === "career";
    for (const s of grp.splits ?? []) {
      if (isCareer) { career[kind] = pickStats(kind, s.stat ?? {}); continue; }
      const lg = s.league?.id;
      const t = s.team;
      if (!t?.id || !KEEP_LEAGUES.has(lg)) continue;
      const season = parseInt(s.season, 10) || 0;
      const g = Number(s.stat?.gamesPlayed ?? 0);
      const key = `${t.id}|${t.name}`;
      let e = acc.get(key);
      if (!e) { e = { id: t.id, name: t.name, seasonG: new Map() }; acc.set(key, e); }
      if (g > (e.seasonG.get(season) ?? 0)) e.seasonG.set(season, g);
      lines.push({ y: season, tid: t.id, tm: t.name, k: kind, s: pickStats(kind, s.stat ?? {}) });
    }
  }
  const teams: Team[] = [...acc.values()].map((e) => ({
    id: e.id,
    name: e.name,
    g: [...e.seasonG.values()].reduce((a, b) => a + b, 0),
    years: [...e.seasonG.keys()].filter((y) => y > 0).sort((a, b) => a - b),
  }));
  return {
    name: p.fullName ?? "",
    pos: p.primaryPosition?.abbreviation ?? null,
    num: p.primaryNumber != null && p.primaryNumber !== "" ? String(p.primaryNumber) : null,
    teams,
    lines,
    career,
  };
}

async function runPool<T>(ids: number[], worker: (id: number) => Promise<T>, onDone: () => void) {
  const results = new Map<number, T>();
  let idx = 0;
  async function lane() {
    while (idx < ids.length) {
      const myId = ids[idx++]!;
      try {
        results.set(myId, await worker(myId));
      } catch (e) {
        // leave unresolved; will retry on a later run via checkpoint
      }
      onDone();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));
  return results;
}

async function main() {
  mkdirSync("data", { recursive: true });
  const t0 = Date.now();

  console.log("Building fame roster (HOF + All-Star + MVP/Cy/ROY)...");
  const fame = await buildFame();
  console.log(`  fame roster: ${fame.size} distinct players`);

  console.log("Aggregating modern regulars from player_seasons...");
  const modern = await buildModern();
  console.log(`  modern regulars (>=2000, floor G>=${MIN_G}/IP>=${MIN_IP}): ${modern.size}`);

  const allIds = new Set<number>([...fame.keys(), ...modern.keys()]);
  console.log(`  union pool: ${allIds.size} players`);

  // Resume: load any previously hydrated team-sets.
  const cache: Record<string, { name: string; pos: string | null; num: string | null; teams: Team[]; lines: SeasonLine[]; career: { bat?: StatBlock; pit?: StatBlock } }> = existsSync(CKPT)
    ? JSON.parse(readFileSync(CKPT, "utf8"))
    : {};
  const todo = [...allIds].filter((id) => !cache[id]).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`Hydrating team-sets for ${todo.length} players (${Object.keys(cache).length} cached)...`);

  let done = 0;
  const flush = () => writeFileSync(CKPT, JSON.stringify(cache));
  const fresh = await runPool(todo, hydrateTeams, () => {
    done++;
    if (done % CHECKPOINT_EVERY === 0) {
      // Merge what we have so far into the cache and persist.
      flush();
      process.stdout.write(`  ${done}/${todo.length}\r`);
    }
  });
  for (const [id, v] of fresh) cache[id] = v;
  flush();

  // Assemble the pool.
  const pool: PoolPlayer[] = [];
  for (const id of allIds) {
    const h = cache[id];
    if (!h) continue; // not yet hydrated (partial run)
    const m = modern.get(id);
    pool.push({
      id,
      name: h.name || fame.get(id)?.name || "",
      pos: h.pos ?? null,
      num: h.num ?? null,
      teams: h.teams,
      lines: h.lines ?? [],
      career: h.career ?? {},
      fame: [...(fame.get(id)?.reasons ?? [])].sort(),
      careerG: m?.careerG ?? null,
      careerIP: m?.careerIP ?? null,
    });
  }
  pool.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(OUT, JSON.stringify(pool, null, 0));

  // ---- summary ----
  const famous = pool.filter((p) => p.fame.length > 0);
  const multi = pool.filter((p) => p.teams.length >= 2);
  const teamCounts = new Map<string, number>();
  for (const p of pool) for (const t of p.teams) teamCounts.set(t.name, (teamCounts.get(t.name) ?? 0) + 1);

  console.log(`\n=== POOL SUMMARY (${((Date.now() - t0) / 1000).toFixed(0)}s) ===`);
  console.log(`  total players:            ${pool.length}`);
  console.log(`  famous (HOF/AS/MVP/...):  ${famous.length}`);
  console.log(`  modern-regular only:      ${pool.length - famous.length}`);
  console.log(`  played for >=2 teams:     ${multi.length}`);
  console.log(`  played for >=3 teams:     ${pool.filter((p) => p.teams.length >= 3).length}`);
  console.log(`  distinct franchises seen: ${teamCounts.size}`);
  console.log(`  written: ${OUT} (${(JSON.stringify(pool).length / 1e6).toFixed(1)} MB)`);

  console.log(`\n  sample famous, well-traveled players:`);
  for (const p of famous.filter((p) => p.teams.length >= 3).slice(0, 8)) {
    console.log(`    ${p.name.padEnd(22)} [${p.fame.join(",")}]  ${p.teams.map((t) => t.name).join(" / ")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Canonicalizes franchise names in data/team-affinity-pool.json per the product
// rule: SAME-CITY renames collapse to the current name (Cleveland Naps/Indians
// /Guardians -> Guardians), but CITY RELOCATIONS stay distinct teams (Brooklyn
// Dodgers != LA Dodgers, Montreal Expos != Washington Nationals).
//
// Rename-vs-relocation is editorial, so the variant franchises are curated by
// hand below (keyed by statsapi team id). Every other franchise has a single
// name already and passes through. Rewrites the pool in place (teams become a
// deduped list of canonical {id, label}, where `id` is the franchise id and
// relocations share the id but differ by label).
//
// Run: npx tsx scripts/normalize-team-pool.ts

import { readFileSync, writeFileSync } from "fs";

const FILE = "data/team-affinity-pool.json";

// For each variant franchise id: map each era-name -> canonical display label.
// Renames point many names at one label; relocations keep separate labels.
const CANON: Record<number, Record<string, string>> = {
  108: {
    // Never truly relocated (all LA-area) -> one team.
    "California Angels": "Los Angeles Angels",
    "Anaheim Angels": "Los Angeles Angels",
    "Los Angeles Angels": "Los Angeles Angels",
  },
  110: {
    // 1901 Milwaukee -> St. Louis Browns -> Baltimore Orioles. Fold the 1-yr
    // Milwaukee blip into Browns so it can't collide with the modern Brewers.
    "Milwaukee Brewers": "St. Louis Browns",
    "St. Louis Browns": "St. Louis Browns",
    "Baltimore Orioles": "Baltimore Orioles",
  },
  111: { "Boston Americans": "Boston Red Sox", "Boston Red Sox": "Boston Red Sox" },
  112: {
    "Chicago White Stockings": "Chicago Cubs",
    "Chicago Colts": "Chicago Cubs",
    "Chicago Orphans": "Chicago Cubs",
    "Chicago Cubs": "Chicago Cubs",
  },
  113: { "Cincinnati Redlegs": "Cincinnati Reds", "Cincinnati Reds": "Cincinnati Reds" },
  114: {
    "Cleveland Naps": "Cleveland Guardians",
    "Cleveland Indians": "Cleveland Guardians",
    "Cleveland Guardians": "Cleveland Guardians",
  },
  117: { "Houston Colt 45's": "Houston Astros", "Houston Astros": "Houston Astros" },
  119: {
    // Brooklyn (all nicknames) is a distinct team from LA.
    "Brooklyn Bridegrooms": "Brooklyn Dodgers",
    "Brooklyn Grooms": "Brooklyn Dodgers",
    "Brooklyn Superbas": "Brooklyn Dodgers",
    "Brooklyn Robins": "Brooklyn Dodgers",
    "Brooklyn Dodgers": "Brooklyn Dodgers",
    "Los Angeles Dodgers": "Los Angeles Dodgers",
  },
  120: { "Montreal Expos": "Montreal Expos", "Washington Nationals": "Washington Nationals" },
  133: {
    "Philadelphia Athletics": "Philadelphia Athletics",
    "Kansas City Athletics": "Kansas City Athletics",
    "Oakland Athletics": "Oakland Athletics",
    "Athletics": "Athletics", // current, post-Oakland
  },
  137: { "New York Giants": "New York Giants", "San Francisco Giants": "San Francisco Giants" },
  139: { "Tampa Bay Devil Rays": "Tampa Bay Rays", "Tampa Bay Rays": "Tampa Bay Rays" },
  140: { "Washington Senators": "Washington Senators", "Texas Rangers": "Texas Rangers" },
  142: { "Washington Senators": "Washington Senators", "Minnesota Twins": "Minnesota Twins" },
  144: {
    "Boston Red Caps": "Boston Braves",
    "Boston Beaneaters": "Boston Braves",
    "Boston Doves": "Boston Braves",
    "Boston Rustlers": "Boston Braves",
    "Boston Bees": "Boston Braves",
    "Boston Braves": "Boston Braves",
    "Milwaukee Braves": "Milwaukee Braves",
    "Atlanta Braves": "Atlanta Braves",
  },
  146: {
    // Same market rebrand, not a move.
    "Florida Marlins": "Miami Marlins",
    "Miami Marlins": "Miami Marlins",
  },
  147: { "New York Highlanders": "New York Yankees", "New York Yankees": "New York Yankees" },
  158: { "Seattle Pilots": "Seattle Pilots", "Milwaukee Brewers": "Milwaukee Brewers" },
};

function canonical(id: number, name: string): string {
  const m = CANON[id];
  return (m && m[name]) || name;
}

type Team = { id: number; name?: string; label?: string; g?: number; years?: number[] };
type SeasonLine = { y: number; tid: number; tm: string; k: "bat" | "pit"; s: Record<string, unknown>; label?: string };
type Player = { id: number; name: string; teams: Team[]; lines?: SeasonLine[]; fame: string[]; careerG: number | null; careerIP: number | null };

const pool: Player[] = JSON.parse(readFileSync(FILE, "utf8"));

for (const p of pool) {
  // Aggregate tenure by resulting label so renames (and multi-nickname eras like
  // the Brooklyn variants) merge their games/years into one franchise entry.
  const agg = new Map<string, { id: number; label: string; g: number; years: number[] }>();
  for (const t of p.teams) {
    const label = canonical(t.id, t.name ?? t.label ?? "");
    const e = agg.get(label) ?? { id: t.id, label, g: 0, years: [] as number[] };
    e.g += t.g ?? 0;
    e.years.push(...(t.years ?? []));
    agg.set(label, e);
  }
  p.teams = [...agg.values()].map((e) => ({ id: e.id, label: e.label, g: e.g, years: [...new Set(e.years)].sort((a, b) => a - b) }));

  // Tag each stat line with its canonical franchise label so the card UI can
  // match rows to puzzle teams across renames (Indians row -> Guardians label).
  if (p.lines) for (const ln of p.lines) ln.label = canonical(ln.tid, ln.tm);
}

writeFileSync(FILE, JSON.stringify(pool, null, 0));

// ---- report ----
const labels = new Set<string>();
const labelCount = new Map<string, number>();
for (const p of pool) for (const t of p.teams) {
  labels.add(t.label!);
  labelCount.set(t.label!, (labelCount.get(t.label!) ?? 0) + 1);
}
console.log(`normalized ${pool.length} players -> ${labels.size} distinct team labels`);
console.log(`\nall team labels (label = player count):`);
for (const [l, c] of [...labelCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${l.padEnd(24)} ${c}`);
}

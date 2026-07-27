// Generate display-only team lists for the /settings preview tabs (Jeff's note),
// grouped by conference/division, from ESPN's standings API (authoritative).
// These sports aren't launched yet, so the lists are for preview only — no
// subscribe wiring. MLB (live) uses the real team registry, not this.
//
// Writes lib/preview-teams.generated.json. Re-run to refresh:
//   npx tsx scripts/gen-preview-teams.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

// ESPN standings paths. level=80 filters college football to FBS.
const SPORTS: { sport: string; path: string; query?: string }[] = [
  { sport: "nfl", path: "football/nfl" },
  { sport: "nba", path: "basketball/nba" },
  { sport: "wnba", path: "basketball/wnba" },
  { sport: "ncaaf", path: "football/college-football", query: "?level=80" },
  { sport: "nhl", path: "hockey/nhl" },
];

type Group = { name: string; teams: string[] };

type StandingsNode = {
  name?: string;
  abbreviation?: string;
  standings?: { entries?: Array<{ team?: { displayName?: string } }> };
  children?: StandingsNode[];
};

// Walk to the most granular groups (division level where present, else
// conference). A node is a "leaf group" when it has standings entries.
function collectGroups(node: StandingsNode, parentName: string, out: Group[]): void {
  const name = node.name ?? parentName;
  const entries = node.standings?.entries ?? [];
  const kids = node.children ?? [];
  if (kids.length > 0) {
    for (const k of kids) collectGroups(k, name, out);
    return;
  }
  if (entries.length > 0) {
    const teams = entries
      .map((e) => e.team?.displayName)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b));
    if (teams.length) out.push({ name, teams });
  }
}

async function main() {
  const result: Record<string, Group[]> = {};
  for (const s of SPORTS) {
    const url = `https://site.api.espn.com/apis/v2/sports/${s.path}/standings${s.query ?? ""}`;
    const res = await fetch(url);
    if (!res.ok) { console.error(`✗ ${s.sport}: HTTP ${res.status}`); continue; }
    const data = (await res.json()) as StandingsNode;
    const groups: Group[] = [];
    for (const child of data.children ?? []) collectGroups(child, data.name ?? s.sport, groups);
    groups.sort((a, b) => a.name.localeCompare(b.name));
    result[s.sport] = groups;
    const total = groups.reduce((n, g) => n + g.teams.length, 0);
    console.log(`✓ ${s.sport}: ${groups.length} groups, ${total} teams`);
  }
  const outPath = join(process.cwd(), "lib", "preview-teams.generated.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nwrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

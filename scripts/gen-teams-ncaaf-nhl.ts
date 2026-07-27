// Generate real team-registry entries for NCAAF (FBS) + NHL from ESPN, so both
// sports become subscribable (Jeff's note — offer pre-subscriptions now).
// NCAAF carries a `conference` for the settings accordion grouping. NHL is flat.
// Output: lib/teams-ncaaf-nhl.generated.json — spread into TEAMS in lib/teams.ts.
//
//   npx tsx scripts/gen-teams-ncaaf-nhl.ts

import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Team = {
  sport: string;
  slug: string;
  name: string;
  city: string;
  nickname: string;
  abbreviation: string;
  conference?: string;
};

type EspnTeam = {
  id: string;
  slug?: string;
  displayName?: string;
  location?: string;
  name?: string;
  nickname?: string;
  abbreviation?: string;
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function toTeam(sport: string, t: EspnTeam, conference?: string): Team | null {
  if (!t.displayName) return null;
  const slug = t.slug ?? slugify(t.displayName); // standings entries lack slug — derive it
  return {
    sport,
    slug,
    name: t.displayName,
    city: t.location ?? t.displayName,
    nickname: t.name ?? t.nickname ?? t.displayName,
    abbreviation: (t.abbreviation ?? slug).toUpperCase().slice(0, 5),
    ...(conference ? { conference } : {}),
  };
}

async function nhlTeams(): Promise<Team[]> {
  const d = await getJson("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams");
  const list = d.sports[0].leagues[0].teams as { team: EspnTeam }[];
  return list.map((x) => toTeam("nhl", x.team)).filter((t): t is Team => !!t);
}

async function ncaafTeams(): Promise<Team[]> {
  // FBS conference membership + team fields, straight from standings (level=80).
  // Recurse to leaf groups — some conferences (e.g. Sun Belt) are nested a level
  // deeper. Standings team objects carry everything but slug, which we derive.
  const st = await getJson("https://site.api.espn.com/apis/v2/sports/football/college-football/standings?level=80");
  const out: Team[] = [];
  const seen = new Set<string>();
  // Flatten each top-level conference's divisions into one group so grouping is
  // uniformly by conference (e.g. Sun Belt's East/West become one "Sun Belt").
  const allEntries = (node: any): any[] => {
    const es = [...(node.standings?.entries ?? [])];
    for (const k of node.children ?? []) es.push(...allEntries(k));
    return es;
  };
  for (const conf of st.children ?? []) {
    const confName: string = conf.name;
    for (const e of allEntries(conf)) {
      const t = e.team ? toTeam("ncaaf", e.team as EspnTeam, confName) : null;
      if (t && !seen.has(t.slug)) { seen.add(t.slug); out.push(t); }
    }
  }
  return out;
}

async function main() {
  const nhl = await nhlTeams();
  const ncaaf = await ncaafTeams();
  ncaaf.sort((a, b) => (a.conference ?? "").localeCompare(b.conference ?? "") || a.name.localeCompare(b.name));
  nhl.sort((a, b) => a.name.localeCompare(b.name));
  const teams = [...ncaaf, ...nhl];
  const outPath = join(process.cwd(), "lib", "teams-ncaaf-nhl.generated.json");
  writeFileSync(outPath, JSON.stringify(teams, null, 2) + "\n");
  console.log(`✓ NCAAF ${ncaaf.length} (conferences: ${new Set(ncaaf.map((t) => t.conference)).size}), NHL ${nhl.length}`);
  console.log(`wrote ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

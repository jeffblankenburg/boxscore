// Generate team-registry entries for college basketball — NCAAM (men's) and
// NCAAW (women's) — from ESPN, so both become subscribable. Each carries a
// `conference` (for settings grouping + conference digests) and an `espnId`
// (362 teams/league make runtime name-matching ambiguous; an explicit id makes
// team resolution exact — cf. the NCAAF "OSU" lookup bug).
//
// Output: lib/teams-ncaam.generated.json + lib/teams-ncaaw.generated.json,
// spread into TEAMS in lib/teams.ts.
//
//   npx tsx scripts/gen-teams-ncaab.ts
//
// Mirrors scripts/gen-teams-ncaaf-nhl.ts; college basketball just has far more
// teams and conferences, and we join conference from standings by ESPN id.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Team = {
  sport: string;
  slug: string;
  name: string;
  city: string;
  nickname: string;
  abbreviation: string;
  espnId: string;
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

type Conference = { slug: string; short: string; espnName: string };

async function standings(espnSlug: string, season: number): Promise<any> {
  return getJson(`https://site.web.api.espn.com/apis/v2/sports/basketball/${espnSlug}/standings?season=${season}&level=3`);
}

// espnId -> conference name, joined onto each team. Recurses nested groups the
// way the NCAAF generator does (ESPN sometimes nests divisions a level deeper).
function conferenceByTeamId(st: any): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (node: any, confName: string) => {
    for (const e of node.standings?.entries ?? []) {
      const id = e.team?.id;
      if (id != null && !map.has(String(id))) map.set(String(id), confName);
    }
    for (const k of node.children ?? []) walk(k, confName);
  };
  for (const conf of st.children ?? []) walk(conf, conf.name);
  return map;
}

// The conference list for the subscription scopes + conference digests, built
// from the standings groups: slug (URL id), short (display), espnName (match).
function conferencesFrom(st: any): Conference[] {
  const out: Conference[] = [];
  const seen = new Set<string>();
  for (const c of st.children ?? []) {
    const espnName = String(c.name ?? "");
    const short = String(c.shortName ?? c.name ?? "");
    if (!espnName || seen.has(espnName)) continue;
    seen.add(espnName);
    out.push({ slug: slugify(short) || slugify(espnName), short, espnName });
  }
  return out.sort((a, b) => a.short.localeCompare(b.short));
}

async function leagueTeams(sport: string, espnSlug: string, st: any): Promise<Team[]> {
  const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/${espnSlug}/teams?limit=1000`);
  const list = (d.sports?.[0]?.leagues?.[0]?.teams ?? []) as { team: EspnTeam }[];
  const confById = conferenceByTeamId(st);
  const out: Team[] = [];
  const seen = new Set<string>();
  for (const { team: t } of list) {
    if (!t.displayName || !t.id) continue;
    const slug = t.slug ?? slugify(t.displayName);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const conference = confById.get(String(t.id));
    out.push({
      sport,
      slug,
      name: t.displayName,
      city: t.location ?? t.displayName,
      nickname: t.name ?? t.nickname ?? t.displayName,
      abbreviation: (t.abbreviation ?? slug).toUpperCase().slice(0, 5),
      espnId: String(t.id),
      ...(conference ? { conference } : {}),
    });
  }
  return out;
}

async function main() {
  // College basketball seasons are labeled by the END year (2025-26 → 2026).
  // Use the current calendar year's completed season for conference alignment;
  // override with argv[2] if a specific season is wanted.
  const now = new Date();
  const season = Number(process.argv[2] ?? (now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()));

  for (const [sport, espnSlug] of [
    ["ncaam", "mens-college-basketball"],
    ["ncaaw", "womens-college-basketball"],
  ] as const) {
    // The upcoming season's standings groups exist but carry no team entries
    // until the season tips off, so conference membership is empty — fall back
    // one year (last completed season's alignment) when there are no entries.
    let st = await standings(espnSlug, season);
    if (conferenceByTeamId(st).size === 0) st = await standings(espnSlug, season - 1);

    const teams = await leagueTeams(sport, espnSlug, st);
    teams.sort((a, b) => (a.conference ?? "~").localeCompare(b.conference ?? "~") || a.name.localeCompare(b.name));
    const teamsPath = join(process.cwd(), "lib", `teams-${sport}.generated.json`);
    writeFileSync(teamsPath, JSON.stringify(teams, null, 2) + "\n");

    const conferences = conferencesFrom(st);
    const confPath = join(process.cwd(), "lib", `conferences-${sport}.generated.json`);
    writeFileSync(confPath, JSON.stringify(conferences, null, 2) + "\n");

    const noConf = teams.filter((t) => !t.conference).length;
    console.log(`✓ ${sport}: ${teams.length} teams, ${conferences.length} conferences, ${noConf} without conference`);
    console.log(`  wrote ${teamsPath}`);
    console.log(`  wrote ${confPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

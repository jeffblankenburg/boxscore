// NFL implementation of the shared leaderboard provider (lib/sports/leaders-types.ts).
// Ranks EVERY player for a stat, AFC left / NFC right. Reuses the ESPN byathlete
// feed the digest leaders use, but fetches one category at a high limit (the
// digest caps at 20) and splits by conference via the standings.
//
// (NCAAF is deferred — it needs a Top-25/conference filter nav and depends on
// the college leader-data work in #118.)

import { FOOTBALL_LEADER_STATS, leaderStatUrl, standingsUrl } from "./sources/espn";
import { footballLeagueConfig, seasonForDate } from "./leagues";
import { fullNameLinkWeb } from "./player-links";
import { todayInET } from "@/lib/dates";
import type { LeaderRow, LeaderColumn, FullLeaderboard, SportLeadersProvider } from "@/lib/sports/leaders-types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}
function rec(v: unknown): Record<string, unknown> { return (v && typeof v === "object") ? v as Record<string, unknown> : {}; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

// Yards render with thousands separators; fractional stats (sacks 12.5) keep one
// decimal. Mirrors the football digest's formatLeaderValue.
function fmt(v: number): string {
  return v % 1 !== 0 ? v.toFixed(1) : v.toLocaleString("en-US");
}

// Compact sub-nav / value-column labels, distinct across passing/rushing/receiving.
const VALUE_LABELS: Record<string, string> = {
  passingYards: "Pass Yds", passingTouchdowns: "Pass TD",
  rushingYards: "Rush Yds", rushingTouchdowns: "Rush TD",
  receivingYards: "Rec Yds", receivingTouchdowns: "Rec TD", receptions: "Rec",
  sacks: "Sacks", totalTackles: "Tackles", tacklesForLoss: "TFL",
};

// slug → the FOOTBALL_LEADER_STATS spec (category/stat) + display labels.
type FbCat = { slug: string; label: string; valueLabel: string; category: string; stat: string; sortCategory: string };
const CATEGORIES: FbCat[] = FOOTBALL_LEADER_STATS.map((s) => ({
  slug: s.stat.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),   // passingYards → passing-yards
  label: s.label,
  valueLabel: VALUE_LABELS[s.stat] ?? s.label,
  category: s.category,
  stat: s.stat,
  sortCategory: s.sortCategory ?? s.category,
}));

// digest FootballLeaderboard.category (= stat name) → page slug.
export const FOOTBALL_LEADER_CATEGORY_SLUG: Record<string, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.stat, c.slug]));

// team abbreviation → conference label ("AFC"/"NFC"), walked from the NFL
// standings tree (conference → division → team).
function confMap(standingsRaw: unknown): Map<string, { abbr: string; name: string }> {
  const m = new Map<string, { abbr: string; name: string }>();
  for (const conf of arr(rec(standingsRaw).children).map(rec)) {
    const label = { abbr: str(conf.abbreviation) || str(conf.shortName) || str(conf.name), name: str(conf.name) };
    for (const div of arr(conf.children).map(rec)) {
      for (const e of arr(rec(div.standings).entries).map(rec)) {
        const abbr = str(rec(e.team).abbreviation).toUpperCase();
        if (abbr) m.set(abbr, label);
      }
    }
  }
  return m;
}

// One category's ranked rows, already sorted desc by ESPN. Dedupes traded
// players (ESPN returns a per-stint row) keeping their first/highest row.
function parseRows(raw: unknown, config: FbCat): { teamAbbr: string; nameHtml: string; value: number }[] {
  const root = rec(raw);
  const schema = arr(root.categories).map(rec).find((c) => str(c.name) === config.category);
  const names = arr(schema?.names).map(str);
  const idx = names.indexOf(config.stat);
  const seen = new Set<string>();
  const out: { teamAbbr: string; nameHtml: string; value: number }[] = [];
  for (const a of arr(root.athletes).map(rec)) {
    const ath = rec(a.athlete);
    const id = str(ath.id);
    if (!id || seen.has(id)) continue;
    const cat = arr(a.categories).map(rec).find((c) => str(c.name) === config.category);
    const value = idx >= 0 ? num(arr(cat?.values)[idx]) : 0;
    if (value <= 0) continue;
    seen.add(id);
    const fullName = str(ath.displayName);
    const teamAbbr = (str(rec(arr(ath.teams)[0]).abbreviation) || str(ath.teamShortName)).toUpperCase();
    out.push({
      teamAbbr,
      nameHtml: fullNameLinkWeb("nfl", { id, fullName, slug: slugify(fullName) }),
      value,
    });
  }
  return out;
}
function slugify(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function rankColumn(label: string, rows: { teamAbbr: string; nameHtml: string; value: number }[]): LeaderColumn {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  let lastVal: number | null = null;
  let lastRank = 0;
  const out: LeaderRow[] = sorted.map((r, i) => {
    const rank = lastVal !== null && r.value === lastVal ? lastRank : i + 1;
    lastVal = r.value; lastRank = rank;
    return { rank, nameHtml: r.nameHtml, teamAbbr: esc(r.teamAbbr), value: fmt(r.value) };
  });
  return { label, rows: out };
}

export const nflLeadersProvider: SportLeadersProvider = {
  categories: CATEGORIES.map((c) => ({ slug: c.slug, label: c.label, valueLabel: c.valueLabel })),
  async load(slug: string): Promise<FullLeaderboard | null> {
    const config = CATEGORIES.find((c) => c.slug === slug);
    if (!config) return null;
    const cfg = footballLeagueConfig("nfl");
    const season = seasonForDate(todayInET());
    const [statsRaw, standingsRaw] = await Promise.all([
      getJson(leaderStatUrl(cfg, season, config.sortCategory, config.stat, 2000)).catch(() => null),
      getJson(standingsUrl(cfg, season)).catch(() => null),
    ]);
    const rows = statsRaw ? parseRows(statsRaw, config) : [];
    const conf = standingsRaw ? confMap(standingsRaw) : new Map<string, { abbr: string; name: string }>();

    // Split AFC / NFC. Any row whose team isn't in the standings map (rare) is
    // dropped from the split rather than mis-filed.
    const confLabels = [...new Set([...conf.values()].map((c) => c.abbr))];
    let columns: LeaderColumn[];
    if (confLabels.length >= 2) {
      const order = ["AFC", "NFC"].filter((c) => confLabels.includes(c)).concat(confLabels.filter((c) => c !== "AFC" && c !== "NFC"));
      columns = order.map((label) =>
        rankColumn(label, rows.filter((r) => conf.get(r.teamAbbr)?.abbr === label)));
    } else {
      columns = [rankColumn("", rows)];
    }

    return {
      category: { slug: config.slug, label: config.label, valueLabel: config.valueLabel },
      season,
      columns,
      qualifierNote: "No minimum — every player who recorded the stat, ranked top to bottom.",
    };
  },
};

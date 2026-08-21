// Offline preview for the Clubhouse daily generator. Thin CLI over the runtime
// source of truth (lib/games/clubhouse/generate.ts) so what you see here is
// exactly what a given date will serve. Use it to eyeball upcoming puzzles for
// curation before they go live.
//
// Run: npx tsx scripts/generate-clubhouse-puzzle.ts [--start YYYY-MM-DD] [--n 7]

import { getPuzzleForDate } from "../lib/games/clubhouse/generate";

function arg(flag: string, d: string) { const i = process.argv.indexOf(flag); return i >= 0 ? (process.argv[i + 1] ?? d) : d; }

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const start = arg("--start", new Date().toISOString().slice(0, 10));
const n = parseInt(arg("--n", "7"), 10);
const WINDOW = 7, TEAM_WINDOW = 5; // rolling no-repeat, mirrors the cron

const hist = new Map<string, { ids: number[]; teams: string[] }>();
for (let k = 0; k < n; k++) {
  const date = addDays(start, k);
  const exclude = new Set<number>(); const excludeTeams = new Set<string>();
  for (let d = 1; d <= WINDOW; d++) for (const id of hist.get(addDays(date, -d))?.ids ?? []) exclude.add(id);
  for (let d = 1; d <= TEAM_WINDOW; d++) for (const t of hist.get(addDays(date, -d))?.teams ?? []) excludeTeams.add(t);
  const puz = getPuzzleForDate(date, exclude, excludeTeams);
  hist.set(date, { ids: puz.tiles.map((t) => t.id), teams: puz.groups.map((g) => g.team) });
  const nameOf = new Map(puz.tiles.map((t) => [t.id, t.name]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00Z`).getUTCDay()];

  console.log(`\n════ ${date} (${dow}) — ${puz.difficulty}, ${puz.traps.length} traps ════`);
  for (const g of puz.groups) {
    console.log(`  ${g.team.padEnd(22)} ${g.playerIds.map((id) => nameOf.get(id)).join(", ")}`);
  }
  for (const t of puz.traps) {
    console.log(`   * ${t.name} — placed ${t.team}; also ${t.decoys.map((d) => `${d.team} (${d.years})`).join(", ")}`);
  }
}

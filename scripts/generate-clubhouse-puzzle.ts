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

for (let k = 0; k < n; k++) {
  const date = addDays(start, k);
  const puz = getPuzzleForDate(date);
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

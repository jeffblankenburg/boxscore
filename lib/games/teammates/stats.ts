// Pure streak/stat math for Teammates, computed over the player's per-day
// results. Calendar-aware: a missed day breaks the streak (unlike a looser
// "consecutive wins" count). Fed from localStorage on the client for now;
// swap the source to puzzle_attempts if/when server-side sync lands.

export type DayResult = { date: string; solved: boolean }; // date = YYYY-MM-DD
export type TeammatesStats = { played: number; wins: number; winPct: number; current: number; max: number };

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeStreaks(results: DayResult[], today: string): TeammatesStats {
  const played = results.length;
  const wins = results.filter((r) => r.solved).length;
  const winPct = played ? Math.round((wins / played) * 100) : 0;

  const solved = new Set(results.filter((r) => r.solved).map((r) => r.date));

  // Max streak: longest run of consecutive calendar days solved.
  let max = 0, run = 0;
  let prev: string | null = null;
  for (const d of [...solved].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > max) max = run;
    prev = d;
  }

  // Current streak: consecutive solved days ending today (or yesterday, so the
  // streak survives until the day is actually missed).
  let anchor: string | null = solved.has(today) ? today : solved.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let current = 0;
  while (anchor && solved.has(anchor)) { current += 1; anchor = addDays(anchor, -1); }

  return { played, wins, winPct, current, max };
}

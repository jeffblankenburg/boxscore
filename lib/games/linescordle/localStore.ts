// Client-side persistence for anonymous Linescordle players. Shape mirrors
// the server's puzzle_attempts row so that the local-to-server merge
// at sign-in time (#57 follow-up task) is a straightforward upsert.
//
// One key per day: `linescordle:attempt:YYYY-MM-DD`. Stat-roll queries
// walk all matching keys via listAttempts().

import type { LetterState } from "./feedback";

const PREFIX = "linescordle:attempt:";
// Legacy key from before the MLBdle → Linescordle rename. Returning
// users with old rows in localStorage get them transparently moved
// to the new prefix on the next read.
const LEGACY_PREFIX = "mlbdle:attempt:";

// Idempotent: runs every read but no-ops once all legacy keys have
// been migrated. Conservative on conflict — if a newer Linescordle row
// already exists for the same date, we keep that one and just drop
// the legacy key.
function migrateLegacyKeys(s: Storage): void {
  const toMove: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(LEGACY_PREFIX)) toMove.push(k);
  }
  if (toMove.length === 0) return;
  for (const oldKey of toMove) {
    const date = oldKey.slice(LEGACY_PREFIX.length);
    const newKey = `${PREFIX}${date}`;
    if (s.getItem(newKey) === null) {
      const val = s.getItem(oldKey);
      if (val !== null) s.setItem(newKey, val);
    }
    s.removeItem(oldKey);
  }
}

export type LocalAttempt = {
  puzzleSubjectId: string;
  guesses: Array<{ letters: string[]; scores: LetterState[] }>;
  hints: Array<"date" | "teams">;
  solved: boolean | null;
  updatedAt: string;             // ISO timestamp
};

function key(puzzleDate: string): string {
  return `${PREFIX}${puzzleDate}`;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // localStorage can throw in Safari private mode / restricted contexts.
    const s = window.localStorage;
    const probeKey = "__linescordle_probe__";
    s.setItem(probeKey, "1");
    s.removeItem(probeKey);
    migrateLegacyKeys(s);
    return s;
  } catch {
    return null;
  }
}

export function getAttemptLocal(puzzleDate: string): LocalAttempt | null {
  const s = safeStorage();
  if (!s) return null;
  const raw = s.getItem(key(puzzleDate));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalAttempt;
  } catch {
    return null;
  }
}

export function saveAttemptLocal(puzzleDate: string, attempt: Omit<LocalAttempt, "updatedAt">): void {
  const s = safeStorage();
  if (!s) return;
  const payload: LocalAttempt = { ...attempt, updatedAt: new Date().toISOString() };
  try {
    s.setItem(key(puzzleDate), JSON.stringify(payload));
  } catch {
    // QuotaExceeded etc. — silently ignore; we'll save the next time.
  }
}

// Iterate every locally-stored Linescordle attempt — used by the stats
// page and by the sign-in-time sync. Returns [puzzleDate, attempt]
// pairs sorted by date ascending.
export function listAttempts(): Array<{ puzzleDate: string; attempt: LocalAttempt }> {
  const s = safeStorage();
  if (!s) return [];
  const out: Array<{ puzzleDate: string; attempt: LocalAttempt }> = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const puzzleDate = k.slice(PREFIX.length);
    const raw = s.getItem(k);
    if (!raw) continue;
    try {
      const attempt = JSON.parse(raw) as LocalAttempt;
      out.push({ puzzleDate, attempt });
    } catch {
      // skip malformed
    }
  }
  return out.sort((a, b) => a.puzzleDate.localeCompare(b.puzzleDate));
}

export function clearAllAttempts(): void {
  const s = safeStorage();
  if (!s) return;
  const keysToDelete: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(PREFIX)) keysToDelete.push(k);
  }
  for (const k of keysToDelete) s.removeItem(k);
}

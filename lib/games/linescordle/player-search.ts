// Server-only player-name index used by the typing autocomplete in
// the Linescordle UI. Loaded once per process from the players cache
// (~26K canonical MLB players), then filtered in-memory per request.
//
// Why players, not historical_player_lines.distinct(player_name): the
// players table is already deduplicated and small enough to load
// eagerly. Distincting 3M+ line rows is expensive and the answer set
// in practice ("anyone who played 1950+") is a subset of the cache.
//
// The names we serve to the client are always the *display* form
// ("José Reyes"), since suggestions render the readable name. The
// normalized form is kept alongside for the matching pass.

import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { normalize } from "./feedback";

type Entry = { display: string; normalized: string };

let cache: Entry[] | null = null;
let loading: Promise<Entry[]> | null = null;

async function loadAll(): Promise<Entry[]> {
  const db = supabaseAdmin();
  const PAGE = 1000;
  let cursor = 0;
  // MLB has multiple distinct players who share a full_name — there
  // are at least three "Pedro Martinez" entries in the cache, for
  // example. The autocomplete only needs one suggestion per spelling,
  // so we dedupe by normalized form at index-build time.
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (;;) {
    const { data, error } = await db
      .from("players")
      .select("id, full_name")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`player-search load: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; full_name: string | null }>) {
      if (!r.full_name) continue;
      const norm = normalize(r.full_name);
      if (norm.length === 0) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({ display: r.full_name, normalized: norm });
    }
    cursor = (data[data.length - 1] as { id: number }).id;
    if (data.length < PAGE) break;
  }
  return out;
}

async function getIndex(): Promise<Entry[]> {
  if (cache) return cache;
  if (loading) return loading;
  loading = loadAll().then((entries) => {
    cache = entries;
    loading = null;
    return entries;
  });
  return loading;
}

export type SearchConstraints = {
  // What the user has typed so far for the current row. Matched as a
  // PREFIX on the candidate's normalized form, so "PEDR" finds names
  // starting with PEDR.
  query: string;
  // Required: candidates must match the puzzle's target length.
  nameLength: number;
  // [position, letter] pairs derived from prior guesses' greens.
  // Candidate must have `letter` at exactly `position`.
  greens: Array<[number, string]>;
  // Letters that turned yellow at any position in a prior guess —
  // i.e. they exist somewhere in the answer. Candidate must contain
  // each one (anywhere). We deliberately ignore the "not at THIS
  // position" subtlety per the v1 spec — close enough for typing
  // assistance.
  yellows: string[];
  // Normalized guess strings to exclude from results. Stops the user's
  // already-played names from showing up in their own suggestion list.
  exclude?: string[];
};

const MAX_RESULTS = 30;

export async function searchPlayerNames(c: SearchConstraints): Promise<string[]> {
  const all = await getIndex();
  // Sanitize the query so it can only match what the keyboard can type.
  const q = c.query.toUpperCase().replace(/[^A-Z]/g, "");
  const excludeSet = new Set(c.exclude ?? []);
  const matches: string[] = [];
  for (const e of all) {
    if (excludeSet.has(e.normalized)) continue;
    if (e.normalized.length !== c.nameLength) continue;
    let ok = true;
    for (const [pos, letter] of c.greens) {
      if (e.normalized[pos] !== letter) { ok = false; break; }
    }
    if (!ok) continue;
    for (const y of c.yellows) {
      if (!e.normalized.includes(y)) { ok = false; break; }
    }
    if (!ok) continue;
    if (q && !e.normalized.startsWith(q)) continue;
    matches.push(e.display);
    if (matches.length >= MAX_RESULTS) break;
  }
  return matches;
}

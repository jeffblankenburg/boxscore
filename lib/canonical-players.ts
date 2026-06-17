// Canonical player lookup. Maps vendor PlayerIDs (statsapi MLBAMID,
// SDIO PlayerID) to our internal canonical slug, the value of
// players.name_slug after migration 0050.
//
// The lookup is bulk-loaded once per process and cached in-memory.
// At ~27k rows × a few small strings, the working set is ~3MB — well
// within budget for a long-lived server process, and avoids per-render
// per-player DB queries when adapting box scores.
//
// Cache invalidation: none. The set of MLB players changes slowly (a
// handful of new call-ups per week) and the cron that refreshes daily
// data restarts the process. If we ever need warmer freshness, add a
// TTL or wire the daily cron's "new player" path to invalidate.

import { supabaseAdmin } from "./supabase";

export type CanonicalPlayerRecord = {
  internalId:   number;
  slug:         string;
  mlbId:        number | null;
  sdioPlayerId: number | null;
};

export type CanonicalPlayerLookup = {
  byMlbId:        Map<number, CanonicalPlayerRecord>;
  bySdioPlayerId: Map<number, CanonicalPlayerRecord>;
  byInternalId:   Map<number, CanonicalPlayerRecord>;
};

let cached:    Promise<CanonicalPlayerLookup> | null = null;
let resolved:  CanonicalPlayerLookup | null         = null;

const PAGE = 1000;

async function load(): Promise<CanonicalPlayerLookup> {
  const sb = supabaseAdmin();
  const byMlbId        = new Map<number, CanonicalPlayerRecord>();
  const bySdioPlayerId = new Map<number, CanonicalPlayerRecord>();
  const byInternalId   = new Map<number, CanonicalPlayerRecord>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("players")
      .select("id, mlb_id, sdio_player_id, name_slug")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`canonical-players load: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ id: number; mlb_id: number | null; sdio_player_id: number | null; name_slug: string | null }>) {
      if (!r.name_slug) continue;
      const rec: CanonicalPlayerRecord = {
        internalId:   r.id,
        slug:         r.name_slug,
        mlbId:        r.mlb_id ?? null,
        sdioPlayerId: r.sdio_player_id ?? null,
      };
      byInternalId.set(r.id, rec);
      if (r.mlb_id != null)         byMlbId.set(r.mlb_id, rec);
      if (r.sdio_player_id != null) bySdioPlayerId.set(r.sdio_player_id, rec);
    }
    if (data.length < PAGE) break;
  }
  return { byMlbId, bySdioPlayerId, byInternalId };
}

/** Get the cached canonical-player lookup, loading on first call.
 *  Adapter call sites should await this once before invoking an MLB
 *  adapter so the synchronous lookup helpers in player-ref.ts can
 *  resolve PlayerRefs without each construction site having to thread
 *  the lookup through. */
export async function getCanonicalPlayerLookup(): Promise<CanonicalPlayerLookup> {
  if (resolved) return resolved;
  if (!cached) cached = load().then((r) => { resolved = r; return r; });
  return cached;
}

/** Synchronous accessor for the cached lookup. Returns null if the
 *  loader hasn't been awaited yet — adapters then fall back to
 *  "unknown-{vendor}-{id}" slugs so the box still renders. */
export function canonicalPlayerLookupSync(): CanonicalPlayerLookup | null {
  return resolved;
}

/** Drop the cache. Used by tests + the migration-script smoke test. */
export function _resetCanonicalPlayerCache(): void {
  cached = null;
  resolved = null;
}

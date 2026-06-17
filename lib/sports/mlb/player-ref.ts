// Adapter-side helpers for constructing canonical MlbPlayerRef objects.
// Vendor adapters (from-statsapi, from-sdio) carry vendor PlayerIDs;
// these helpers resolve those PlayerIDs to our canonical name_slug via
// the CanonicalPlayerLookup loaded at the top of each adapter run.
//
// Why centralized: MlbPlayerRef gets constructed in dozens of places
// (batters, pitchers, decisions, probable pitchers, leaders,
// transactions). Inlining the lookup-and-fallback at every site is
// noisy and easy to drift; a shared helper keeps the "unknown" key
// stable and the fallback logic in one place.

import { canonicalPlayerLookupSync, type CanonicalPlayerRecord } from "../../canonical-players";
import type { MlbPlayerRef } from "./types";

type Vendor = "statsapi" | "sdio";

function lookupRec(vendor: Vendor, vendorId: number): CanonicalPlayerRecord | undefined {
  const lookup = canonicalPlayerLookupSync();
  if (!lookup) return undefined;
  return vendor === "statsapi"
    ? lookup.byMlbId.get(vendorId)
    : lookup.bySdioPlayerId.get(vendorId);
}

/** Build a canonical MlbPlayerRef given a vendor PlayerID and full name.
 *  Reads the cached canonical-player lookup; the call site must have
 *  awaited getCanonicalPlayerLookup() once before this is invoked.
 *  Falls back to an "unknown-{vendor}-{vendorId}" slug when the lookup
 *  misses (e.g. a new SDIO call-up not yet in the players table) — the
 *  URL won't resolve to a real player page, but the box still renders. */
export function playerRef(vendor: Vendor, vendorId: number, fullName: string): MlbPlayerRef {
  const rec = lookupRec(vendor, vendorId);
  return {
    id:       rec?.slug ?? `unknown-${vendor}-${vendorId}`,
    fullName,
    mlbId:    rec?.mlbId ?? (vendor === "statsapi" ? vendorId : null),
  };
}

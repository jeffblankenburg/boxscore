// Admin-editable overrides for per-team social hashtags. The coded defaults +
// derived tags live in lib/social-content.ts; this layer reads the
// team_hashtags table (migration 0084) and merges overrides on top, and backs
// the /admin/hashtags editor. See GH #119.
//
// team_key semantics (must match social-content's caption-lookup keys):
//   mlb              -> nickname
//   nba/wnba/nfl     -> abbreviation
//   ncaaf            -> normalized school name
// `official` is the hashtag without the leading '#'; null = "no official tag"
// (an explicit override suppressing the coded default).

import { supabaseAdmin } from "./supabase";
import { defaultOfficialMap, hashtagRoster, type HashtagRosterRow } from "./social-content";

export type OverrideRow = { label: string; official: string | null };

// All override rows for a sport, keyed by team_key. Tolerant of the table not
// existing yet (pre-migration) or a transient read error — returns an empty map
// so callers fall back to the coded defaults rather than throwing.
export async function loadOverrideRows(sport: string): Promise<Map<string, OverrideRow>> {
  const out = new Map<string, OverrideRow>();
  try {
    const { data, error } = await supabaseAdmin()
      .from("team_hashtags")
      .select("team_key, label, official")
      .eq("sport", sport);
    if (error) {
      // Expected before migration 0084 is applied — stay quiet so the posting
      // crons don't spam logs; fall back to coded defaults. Any other error is
      // worth surfacing.
      const missingTable = error.code === "PGRST205" || /team_hashtags/.test(error.message);
      if (!missingTable) console.error(`loadOverrideRows(${sport}): ${error.message}`);
      return out;
    }
    for (const r of data ?? []) {
      const official = r.official && r.official.trim() ? r.official.trim() : null;
      out.set(r.team_key, { label: r.label, official });
    }
  } catch (err) {
    console.error(`loadOverrideRows(${sport}): ${(err as Error).message}`);
  }
  return out;
}

// The official-hashtag map a caption run should use: coded defaults with DB
// overrides merged on top (a null override suppresses the default). Keyed by
// the sport's caption-lookup key. Pass this to imagePostContent's officialMap.
export async function resolvedOfficialMap(sport: string): Promise<Record<string, string | null>> {
  const merged: Record<string, string | null> = { ...defaultOfficialMap(sport) };
  const overrides = await loadOverrideRows(sport);
  for (const [key, row] of overrides) merged[key] = row.official;
  return merged;
}

export type AdminHashtagRow = HashtagRosterRow & {
  current: string | null;   // effective official (override if set, else default)
  isOverride: boolean;      // an admin row exists in the DB
  isCustom: boolean;        // admin-added team not in the coded roster (e.g. an NCAAF school)
};

// The full editable table for a sport: the coded roster with any overrides
// applied, plus admin-added teams that aren't in the coded roster.
export async function adminRoster(sport: string): Promise<AdminHashtagRow[]> {
  const overrides = await loadOverrideRows(sport);
  const base = hashtagRoster(sport);
  const rows: AdminHashtagRow[] = base.map((r) => {
    const ov = overrides.get(r.key);
    return {
      ...r,
      current: ov ? ov.official : r.defaultOfficial,
      isOverride: !!ov,
      isCustom: false,
    };
  });
  // Admin-added teams (override keys with no coded roster row).
  const baseKeys = new Set(base.map((r) => r.key));
  for (const [key, ov] of overrides) {
    if (baseKeys.has(key)) continue;
    rows.push({
      key,
      label: ov.label,
      derived: [`#${ov.label.replace(/[^a-zA-Z0-9]/g, "")}`],
      defaultOfficial: null,
      current: ov.official,
      isOverride: true,
      isCustom: true,
    });
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

// Upsert an override. `official` is normalized: blank → null (explicit "no
// tag"), and any leading '#' the admin typed is stripped.
export async function saveTeamHashtag(args: {
  sport: string;
  teamKey: string;
  label: string;
  official: string | null;
}): Promise<void> {
  const official = args.official?.trim().replace(/^#/, "") || null;
  const { error } = await supabaseAdmin()
    .from("team_hashtags")
    .upsert(
      {
        sport: args.sport,
        team_key: args.teamKey,
        label: args.label,
        official,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sport,team_key" },
    );
  if (error) throw new Error(`saveTeamHashtag: ${error.message}`);
}

// Delete an override row, reverting the team to its coded default.
export async function resetTeamHashtag(sport: string, teamKey: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("team_hashtags")
    .delete()
    .eq("sport", sport)
    .eq("team_key", teamKey);
  if (error) throw new Error(`resetTeamHashtag: ${error.message}`);
}

import { supabaseAdmin } from "./supabase";

// Source of truth for "which sports exist and who can see them." Backed by
// the sports table (migration 0015). Every UI surface that lists sports —
// /subscribe, /settings, footer, admin dashboard — reads through here and
// passes `includeAdminOnly` based on whether the viewer is an admin.

export type SportVisibility = "admin_only" | "public";

export type Sport = {
  id: string;
  name: string;
  visibility: SportVisibility;
  created_at: string;
  updated_at: string;
};

const COLS = "id, name, visibility, created_at, updated_at";

/**
 * Returns sports filtered by visibility. Pass `includeAdminOnly: true` for
 * admin contexts (admin dashboard, admin-authenticated settings page). Pass
 * false (the default) for any UI surface a non-admin user could see.
 */
export async function getVisibleSports(
  opts: { includeAdminOnly?: boolean } = {},
): Promise<Sport[]> {
  const query = supabaseAdmin().from("sports").select(COLS).order("name", { ascending: true });
  const filtered = opts.includeAdminOnly ? query : query.eq("visibility", "public");
  const { data, error } = await filtered;
  if (error) throw new Error(`getVisibleSports: ${error.message}`);
  return (data ?? []) as Sport[];
}

/**
 * Returns every sport regardless of visibility. Use only in admin contexts
 * where the caller needs the full catalog (e.g. the admin visibility toggle
 * UI). Public-facing code should call `getVisibleSports()` instead.
 */
export async function getAllSports(): Promise<Sport[]> {
  return getVisibleSports({ includeAdminOnly: true });
}

export async function getSportById(id: string): Promise<Sport | null> {
  const { data, error } = await supabaseAdmin()
    .from("sports")
    .select(COLS)
    .eq("id", id)
    .maybeSingle<Sport>();
  if (error) throw new Error(`getSportById: ${error.message}`);
  return data ?? null;
}

/**
 * True if the sport exists and is visible to the caller. Centralizes the
 * "is this sport accessible right now" check for route guards — replaces
 * the old hardcoded VALID_SPORTS = {"mlb"} sets scattered across the app.
 */
export async function isSportVisible(
  id: string,
  opts: { includeAdminOnly?: boolean } = {},
): Promise<boolean> {
  const sport = await getSportById(id);
  if (!sport) return false;
  if (sport.visibility === "public") return true;
  return Boolean(opts.includeAdminOnly);
}

/**
 * Admin-only: flip a sport's visibility. This is the launch action — moving
 * a sport from 'admin_only' to 'public' makes it appear in the subscribe
 * form, settings page, and any other public sport list with no deploy.
 */
export async function setSportVisibility(
  id: string,
  visibility: SportVisibility,
): Promise<Sport> {
  const { data, error } = await supabaseAdmin()
    .from("sports")
    .update({ visibility, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(COLS)
    .single<Sport>();
  if (error) throw new Error(`setSportVisibility: ${error.message}`);
  return data;
}

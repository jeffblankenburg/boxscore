// Read/write helpers for the admin_settings key/value table. All settings
// are stored as text; callers parse to boolean / int / json as needed.
// Migration: supabase/migrations/0026_admin_settings.sql.

import { supabaseAdmin } from "./supabase";

export async function getAdminSetting(key: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("admin_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`getAdminSetting(${key}): ${error.message}`);
  return (data?.value as string | undefined) ?? null;
}

export async function setAdminSetting(
  key: string,
  value: string,
  updatedBy?: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("admin_settings")
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    });
  if (error) throw new Error(`setAdminSetting(${key}): ${error.message}`);
}

// Boolean flag wrapper — treats "true" (case-insensitive) as enabled,
// anything else as disabled. Convenient for kill-switches.
export async function isFlagEnabled(key: string): Promise<boolean> {
  const v = await getAdminSetting(key);
  return v != null && v.toLowerCase() === "true";
}

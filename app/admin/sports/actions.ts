"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "../require-admin";
import { setSportVisibility } from "@/lib/sports";

/**
 * Flip a sport's visibility between admin_only and public. This is the
 * launch action — moving a sport from admin_only to public makes it appear
 * on /subscribe, /settings, and any other public sport list with no deploy.
 */
export async function toggleSportVisibility(formData: FormData) {
  await requireAdmin();
  const sport = formData.get("sport");
  const next = formData.get("next");
  if (
    typeof sport !== "string" ||
    (next !== "admin_only" && next !== "public")
  ) {
    redirect("/admin/sports?error=invalid");
  }
  await setSportVisibility(sport as string, next as "admin_only" | "public");
  redirect(`/admin/sports?ok=${encodeURIComponent(`${sport} → ${next}`)}`);
}

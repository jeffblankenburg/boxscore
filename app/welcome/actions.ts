"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { sanitizeDemographics } from "@/lib/demographics";

// Save the demographic form. Authenticates via the subscriber session
// cookie set by /c/[token]. The "Skip" button on the welcome page
// submits an empty form — we still mark demographics_completed_at so
// the welcome step doesn't keep re-prompting.
export async function saveDemographics(formData: FormData) {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  if (!session) redirect("/settings");

  const payload = sanitizeDemographics({
    country:     formData.get("country")     as string | null,
    region:      formData.get("region")      as string | null,
    age_band:    formData.get("age_band")    as string | null,
    income_band: formData.get("income_band") as string | null,
    gender:      formData.get("gender")      as string | null,
  });

  const { error } = await supabaseAdmin()
    .from("subscribers")
    .update({
      ...payload,
      demographics_completed_at: new Date().toISOString(),
    })
    .eq("id", session.subscriber_id);
  if (error) {
    console.error(`saveDemographics: ${error.message}`);
    redirect("/welcome?error=save_failed");
  }
  redirect("/settings?welcome=1");
}

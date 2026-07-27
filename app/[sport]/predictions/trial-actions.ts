"use server";

// Activate the one-time free trial from the storefront (Jeff's note). Identity
// from the session; grants a 3-day comp entitlement and unlocks the page.

import { revalidatePath } from "next/cache";
import { getSessionSubscriber } from "@/lib/subscriber-session";
import { activateTrial } from "@/lib/predictions-trial";

export type ActivateTrialResult = { ok: true; accessEnd: string } | { ok: false; error: string };

export async function activatePredictionsTrial(): Promise<ActivateTrialResult> {
  const sub = await getSessionSubscriber();
  if (!sub) return { ok: false, error: "Please sign in first." };
  try {
    const { accessEnd } = await activateTrial(sub.id);
    revalidatePath("/mlb/predictions");
    return { ok: true, accessEnd };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

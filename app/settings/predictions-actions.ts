"use server";

// Server actions for the /settings Predictions Subscription card (#111, Phase 4).
// Identity always comes from the session cookie; the client passes no ids.

import { revalidatePath } from "next/cache";
import { getSessionSubscriber } from "@/lib/subscriber-session";
import {
  cancelPredictionsSubscription,
  createUpdatePaymentSetupIntent,
  finalizeUpdatePayment,
} from "@/lib/predictions-account";

const SPORT = "mlb"; // launch sport; add a param when a 2nd predictions sport ships

export type CancelResult =
  | { ok: true; refundCents: number; accessEndISO: string }
  | { ok: false; error: string };

export async function cancelPredictions(): Promise<CancelResult> {
  const sub = await getSessionSubscriber();
  if (!sub) return { ok: false, error: "Please sign in." };
  try {
    const { refundCents, accessEndISO } = await cancelPredictionsSubscription(sub.id, SPORT);
    revalidatePath("/settings");
    return { ok: true, refundCents, accessEndISO };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type StartUpdateResult = { ok: true; clientSecret: string } | { ok: false; error: string };

export async function startUpdatePayment(): Promise<StartUpdateResult> {
  const sub = await getSessionSubscriber();
  if (!sub) return { ok: false, error: "Please sign in." };
  try {
    const { clientSecret } = await createUpdatePaymentSetupIntent(sub.id);
    return { ok: true, clientSecret };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type FinishUpdateResult = { ok: true } | { ok: false; error: string };

export async function finishUpdatePayment(setupIntentId: string): Promise<FinishUpdateResult> {
  const sub = await getSessionSubscriber();
  if (!sub) return { ok: false, error: "Please sign in." };
  try {
    await finalizeUpdatePayment(sub.id, SPORT, setupIntentId);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

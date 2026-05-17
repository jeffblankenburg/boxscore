// Resend webhook receiver.
//
// Resend uses Svix for signed delivery. Three headers carry the signature:
//   svix-id          — unique message id (used for idempotency)
//   svix-timestamp   — Unix seconds the event was emitted
//   svix-signature   — HMAC over `${id}.${timestamp}.${body}`
//
// Setup (Resend dashboard):
//   1. Webhooks → Add endpoint → POST https://boxscore.email/api/webhooks/resend
//   2. Subscribe to: email.bounced, email.complained, email.delivery_delayed
//      (Add email.opened / email.clicked later for #25)
//   3. Copy the signing secret → set RESEND_WEBHOOK_SECRET in Vercel + .env.local
//
// Behavior:
//   - email.bounced    → auto-unsubscribe (reason="bounce")
//   - email.complained → auto-unsubscribe (reason="complaint")
//   - email.delivery_delayed → log only; Resend will retry
//   - anything else    → log only; we keep it for future surface area
//
// Idempotency: every event is recorded in webhook_events keyed on svix-id.
// A duplicate delivery is acknowledged with 200 OK and dropped.

import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { unsubscribeByEmail } from "@/lib/subscribers";
import { hasWebhookEvent, recordWebhookEvent } from "@/lib/webhooks";

export const runtime = "nodejs";

// Resend event payload (only the fields we care about). The full schema has
// many more — we keep this narrow on purpose so a Resend addition doesn't
// silently break parsing.
type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;        // Resend's message id (matches sends.resend_id)
    to?: string[] | string;
    from?: string;
    subject?: string;
    // bounced / complained envelopes:
    bounce?: { type?: string; subType?: string; message?: string };
    complaint?: { feedbackType?: string };
  };
};

function recipientOf(event: ResendWebhookEvent): string | null {
  const to = event.data?.to;
  if (!to) return null;
  if (Array.isArray(to)) return to[0] ?? null;
  return to;
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("RESEND_WEBHOOK_SECRET not set; refusing webhook.");
    return new NextResponse("Webhook secret not configured", { status: 500 });
  }

  // We must read the raw body once for both signature verification and event
  // processing — req.text() consumes the stream.
  const rawBody = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse("Missing svix headers", { status: 400 });
  }

  let event: ResendWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ResendWebhookEvent;
  } catch (e) {
    console.warn(`Resend webhook signature verification failed: ${(e as Error).message}`);
    return new NextResponse("Signature verification failed", { status: 401 });
  }

  // Idempotency check up front — short-circuit retries before doing work.
  if (await hasWebhookEvent(svixId)) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Side effects first. Every handler must be idempotent so a Svix retry
  // (triggered by a 500) can safely re-run.
  let actionResult: Record<string, unknown> = { action: "logged", type: event.type };
  try {
    switch (event.type) {
      case "email.bounced": {
        // Resend marks hard vs soft bounces via data.bounce.type. Only hard
        // bounces auto-unsubscribe; soft bounces are retried by Resend itself.
        const bounceType = event.data?.bounce?.type?.toLowerCase();
        const isHard = bounceType === "hard" || bounceType === "permanent";
        if (!isHard) {
          actionResult = { action: "soft_bounce_logged", bounceType };
          break;
        }
        const email = recipientOf(event);
        if (!email) {
          console.warn(`bounce event ${svixId} has no recipient`);
          actionResult = { action: "no_recipient" };
          break;
        }
        const sub = await unsubscribeByEmail(email, "bounce");
        actionResult = { action: sub ? "unsubscribed" : "noop", email };
        break;
      }
      case "email.complained": {
        const email = recipientOf(event);
        if (!email) {
          console.warn(`complaint event ${svixId} has no recipient`);
          actionResult = { action: "no_recipient" };
          break;
        }
        const sub = await unsubscribeByEmail(email, "complaint");
        actionResult = { action: sub ? "unsubscribed" : "noop", email };
        break;
      }
      case "email.delivery_delayed":
        // Soft signal; Resend retries on its own. Logging is enough.
        actionResult = { action: "logged" };
        break;
    }
  } catch (e) {
    console.error(`Resend webhook handler error for ${event.type}: ${(e as Error).message}`);
    // 500 → Svix retries. The event isn't recorded yet, so the retry will
    // re-run the handler. Side effects are idempotent, so re-running is safe.
    return new NextResponse("Handler error", { status: 500 });
  }

  // Record AFTER successful processing so retries actually replay on failure.
  try {
    await recordWebhookEvent({ id: svixId, eventType: event.type, payload: event });
  } catch (e) {
    // The side effect already happened. We just couldn't write the audit row.
    // Log and ack — duplicating the side effect on a Svix retry is harmless
    // because unsubscribeByEmail is idempotent.
    console.error(`recordWebhookEvent failed (event ${svixId}): ${(e as Error).message}`);
  }

  return NextResponse.json({ ok: true, ...actionResult });
}

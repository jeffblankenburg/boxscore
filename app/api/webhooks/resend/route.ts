// Resend webhook receiver.
//
// Resend uses Svix for signed delivery. Three headers carry the signature:
//   svix-id          — unique message id (used for idempotency)
//   svix-timestamp   — Unix seconds the event was emitted
//   svix-signature   — HMAC over `${id}.${timestamp}.${body}`
//
// Setup (Resend dashboard):
//   1. Webhooks → Add endpoint → POST https://boxscore.email/api/webhooks/resend
//   2. Subscribe to: email.delivered, email.bounced, email.complained,
//      email.delivery_delayed, email.opened, email.clicked
//   3. Copy the signing secret → set RESEND_WEBHOOK_SECRET in Vercel + .env.local
//
// Behavior (in addition to writing every tracked event to email_events so the
// admin search can display real per-send status):
//   - email.delivered        → record only
//   - email.bounced          → record + auto-unsubscribe on hard bounces
//   - email.complained       → record + auto-unsubscribe (reason="complaint")
//   - email.delivery_delayed → record only; Resend will retry on its own
//   - email.opened           → record only
//   - email.clicked          → record only
//
// Idempotency: every event is recorded in webhook_events keyed on svix-id.
// A duplicate delivery is acknowledged with 200 OK and dropped before any
// side effect runs.

import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { unsubscribeByEmail } from "@/lib/subscribers";
import {
  countRecentBouncesOfSubType,
  hasWebhookEvent,
  recordEmailEvent,
  recordWebhookEvent,
  truncateIp,
} from "@/lib/webhooks";

// Soft-bounce subtypes Resend classifies as `Transient` but which, in practice,
// recur with the same content rejection (Apple's CS01 reputation reject is the
// canonical case). Counted across a rolling window; once a recipient hits the
// threshold we treat it like a hard bounce and unsubscribe. The threshold
// counts PRIOR bounces — so a value of 1 means "suppress on the 2nd occurrence
// in the window", giving every recipient one fluke chance before we stop.
const SOFT_BOUNCE_SUPPRESS_SUBTYPES = ["ContentRejected"] as const;
const SOFT_BOUNCE_WINDOW_DAYS = 30;
const SOFT_BOUNCE_PRIOR_THRESHOLD = 1;

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
    // opened / clicked envelopes:
    user_agent?: string;
    userAgent?: string;
    ip_address?: string;
    ipAddress?: string;
    link?: string;            // clicked-link URL
  };
};

function recipientOf(event: ResendWebhookEvent): string | null {
  const to = event.data?.to;
  if (!to) return null;
  if (Array.isArray(to)) return to[0] ?? null;
  return to;
}

// Write the event into email_events so the /admin search can render real per-
// send status (Delivered / Bounced / Delayed / Complained / Opened / Clicked).
// Returns false if Resend didn't include an email_id — we can't link it to a
// send row, so we skip without throwing. Throws on a DB error, which falls
// through to a 500 and a Svix retry.
async function logEmailEvent(event: ResendWebhookEvent): Promise<boolean> {
  const resendId = event.data?.email_id;
  if (!resendId) return false;
  await recordEmailEvent({
    resendId,
    eventType: event.type,
    eventAt: event.created_at,
    userAgent: event.data?.user_agent ?? event.data?.userAgent ?? null,
    ip: truncateIp(event.data?.ip_address ?? event.data?.ipAddress ?? null),
    payload: event.data,
  });
  return true;
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
      case "email.delivered": {
        const recorded = await logEmailEvent(event);
        actionResult = { action: recorded ? "recorded" : "no_email_id" };
        break;
      }
      case "email.bounced": {
        // Resend marks hard vs soft bounces via data.bounce.type. Hard bounces
        // auto-unsubscribe immediately. Soft bounces normally just get recorded
        // (Resend retries on its own) — EXCEPT when the subType is one we know
        // recurs with the same content rejection. Apple's CS01 reputation
        // bounce arrives as Transient/ContentRejected but the same recipient
        // bounces every day; continuing to send only worsens our reputation,
        // so we suppress after the threshold prior occurrences in the window.
        const bounceType = event.data?.bounce?.type?.toLowerCase();
        const bounceSubType = event.data?.bounce?.subType ?? null;
        const isHard = bounceType === "hard" || bounceType === "permanent";
        const email = recipientOf(event);

        let suppressReason: "hard" | "repeated_soft" | null = isHard ? "hard" : null;

        if (
          !isHard
          && email
          && bounceSubType
          && (SOFT_BOUNCE_SUPPRESS_SUBTYPES as readonly string[]).includes(bounceSubType)
        ) {
          const priorCount = await countRecentBouncesOfSubType(
            email,
            bounceSubType,
            SOFT_BOUNCE_WINDOW_DAYS,
          );
          if (priorCount >= SOFT_BOUNCE_PRIOR_THRESHOLD) {
            suppressReason = "repeated_soft";
          }
        }

        if (suppressReason && email) {
          const sub = await unsubscribeByEmail(email, "bounce");
          actionResult = {
            action: sub ? "unsubscribed" : "noop",
            email,
            bounceType,
            bounceSubType,
            suppressReason,
          };
        } else if (suppressReason && !email) {
          console.warn(`bounce event ${svixId} has no recipient`);
          actionResult = { action: "no_recipient", bounceType, bounceSubType };
        } else {
          actionResult = { action: "soft_bounce_recorded", bounceType, bounceSubType };
        }
        await logEmailEvent(event);
        break;
      }
      case "email.complained": {
        const email = recipientOf(event);
        if (email) {
          const sub = await unsubscribeByEmail(email, "complaint");
          actionResult = { action: sub ? "unsubscribed" : "noop", email };
        } else {
          console.warn(`complaint event ${svixId} has no recipient`);
          actionResult = { action: "no_recipient" };
        }
        await logEmailEvent(event);
        break;
      }
      case "email.delivery_delayed": {
        // Soft signal; Resend retries on its own. We still record so the
        // search can show "Delayed" while the retry is pending.
        const recorded = await logEmailEvent(event);
        actionResult = { action: recorded ? "recorded" : "no_email_id" };
        break;
      }
      case "email.opened":
      case "email.clicked": {
        const recorded = await logEmailEvent(event);
        if (!recorded) console.warn(`${event.type} event ${svixId} has no email_id`);
        actionResult = { action: recorded ? "recorded" : "no_email_id" };
        break;
      }
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

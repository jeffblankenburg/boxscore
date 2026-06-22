import { notFound, redirect } from "next/navigation";
import {
  findByUnsubscribeToken,
  unsubscribeSubscriber,
} from "@/lib/subscribers";

export const metadata = { title: "Unsubscribed — boxscore" };
export const dynamic = "force-dynamic";

// GET never state-changes here — mail scanners (Gmail link-safety, Outlook
// SafeLinks, Slack unfurls, etc.) pre-fetch link URLs, and we don't want
// them to silently unsubscribe real users on our behalf. The state change
// happens only via the form POST (server action) below.
//
// Mail-client native "Unsubscribe" buttons (List-Unsubscribe-Post one-click,
// RFC 8058) POST to a separate endpoint at /api/u/[token] — see route.ts there.
// That path doesn't have a UI; the user gets unsubbed without a survey.

const PREVIEW_TOKEN = "admin-preview";

// Dropdown options shown above the unsub button. Kept short on purpose —
// each option should reflect a real action we could take in response:
//   too_many      → frequency / digest cadence work
//   not_relevant  → content fit; possible re-engagement campaign
//   never_signed  → spam complaint signal; tighten signup flow
//   switching     → competitive intel
//   taking_break  → likely resubscribers; soft hold strategy
//   other         → free text takes over
//
// Stored as the literal `value` string in subscribers.unsubscribe_user_reason.
const UNSUB_REASONS = [
  { value: "too_many",       label: "Too many emails" },
  { value: "not_relevant",   label: "Not relevant to my interests" },
  { value: "never_signed",   label: "I didn't subscribe to this" },
  { value: "switching",      label: "Switching to a different newsletter" },
  { value: "taking_break",   label: "Taking a break from sports" },
  { value: "other",          label: "Other (please tell us below)" },
] as const;

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (token === PREVIEW_TOKEN) {
    return (
      <section className="subscribe-card">
        <h1 className="subscribe-h1">Unsubscribe?</h1>
        <p className="subscribe-lede">
          Click below to stop sending the daily digest to{" "}
          <code>you@example.com</code>.
        </p>
        <form>
          <UnsubscribeSurveyFields disabled />
          <div className="subscribe-form">
            <button type="button" className="subscribe-button" disabled>
              Confirm unsubscribe
            </button>
          </div>
        </form>
        <p className="subscribe-fine">
          <em>Preview mode</em> — admins see this when they click the
          unsubscribe link in an email preview. Button is intentionally
          inert; nothing happens.
        </p>
      </section>
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const subscriber = await findByUnsubscribeToken(token);
  if (!subscriber) notFound();

  if (subscriber.status !== "active") {
    return (
      <section className="subscribe-card">
        <h1 className="subscribe-h1">Unsubscribed</h1>
        <p className="subscribe-lede">
          <code>{subscriber.email}</code> is no longer on the list.
        </p>
        <p className="subscribe-fine">
          Changed your mind? <a href="/subscribe">Resubscribe</a>. No hard feelings.
        </p>
      </section>
    );
  }

  async function doUnsubscribe(formData: FormData) {
    "use server";
    const sub = await findByUnsubscribeToken(token);
    if (sub && sub.status === "active") {
      // Whitelist the dropdown value; ignore tampered submissions. Survey
      // fields are optional — never block the unsub action on them.
      const rawReason = String(formData.get("user_reason") ?? "");
      const userReason = UNSUB_REASONS.some((r) => r.value === rawReason)
        ? rawReason
        : null;
      const rawFeedback = String(formData.get("feedback") ?? "").trim();
      const feedback = rawFeedback.length > 0
        ? rawFeedback.slice(0, 2000) // hard cap; the textarea has its own visible limit
        : null;
      await unsubscribeSubscriber(sub.id, "user", { userReason, feedback });
    }
    redirect(`/u/${token}`);
  }

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Unsubscribe?</h1>
      <p className="subscribe-lede">
        Click below to stop sending the daily digest to{" "}
        <code>{subscriber.email}</code>.
      </p>
      <form action={doUnsubscribe}>
        <UnsubscribeSurveyFields />
        <div className="subscribe-form">
          <button type="submit" className="subscribe-button">
            Confirm unsubscribe
          </button>
        </div>
      </form>
      <p className="subscribe-fine">
        Changed your mind? <a href="/">Back to today&rsquo;s digest</a>.
      </p>
    </section>
  );
}

// Reason dropdown + optional free-text feedback. Both inputs are optional —
// the unsubscribe action proceeds whether or not the subscriber fills them
// in. We never want to make leaving harder than staying.
function UnsubscribeSurveyFields({ disabled }: { disabled?: boolean } = {}) {
  return (
    <div className="unsub-survey">
      <label className="unsub-survey-label" htmlFor="unsub-user-reason">
        Mind telling us why? <span className="unsub-survey-optional">(optional)</span>
      </label>
      <select
        id="unsub-user-reason"
        name="user_reason"
        className="unsub-survey-select"
        defaultValue=""
        disabled={disabled}
      >
        <option value="">—</option>
        {UNSUB_REASONS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <label className="unsub-survey-label" htmlFor="unsub-feedback">
        Anything else? <span className="unsub-survey-optional">(optional)</span>
      </label>
      <textarea
        id="unsub-feedback"
        name="feedback"
        className="unsub-survey-textarea"
        rows={3}
        maxLength={2000}
        placeholder="What would have kept you subscribed?"
        disabled={disabled}
      />
    </div>
  );
}

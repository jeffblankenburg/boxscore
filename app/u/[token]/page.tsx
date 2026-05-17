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

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
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

  async function doUnsubscribe() {
    "use server";
    const sub = await findByUnsubscribeToken(token);
    if (sub && sub.status === "active") {
      await unsubscribeSubscriber(sub.id);
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
      <form action={doUnsubscribe} className="subscribe-form">
        <button type="submit" className="subscribe-button">
          Confirm unsubscribe
        </button>
      </form>
      <p className="subscribe-fine">
        Changed your mind? <a href="/">Back to today's digest</a>.
      </p>
    </section>
  );
}

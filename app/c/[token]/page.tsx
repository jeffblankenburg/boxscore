import { notFound } from "next/navigation";
import {
  confirmSubscriber,
  findByConfirmToken,
} from "@/lib/subscribers";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emails/templates";
import { siteOrigin } from "@/lib/site";
import { getDigest } from "@/lib/digests";
import { yesterdayInET, prettyDate } from "@/lib/dates";

export const metadata = { title: "You're in — boxscore.email" };

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const subscriber = await findByConfirmToken(token);
  if (!subscriber) notFound();

  // Flip pending → active (idempotent if already active).
  // If they were already unsubscribed, skip the welcome email.
  const wasNotActive = subscriber.status !== "active";
  const wasUnsubscribed = subscriber.status === "unsubscribed";

  if (!wasUnsubscribed) {
    await confirmSubscriber(subscriber.id);
  }

  // Send welcome email only on first activation, not on re-clicks.
  if (wasNotActive && !wasUnsubscribed) {
    const origin = await siteOrigin();
    const digestDate = yesterdayInET();
    const digest = await getDigest("mlb", digestDate);
    if (digest) {
      const digestUrl = `${origin}/mlb/${digestDate}`;
      const unsubscribeUrl = `${origin}/u/${subscriber.unsubscribe_token}`;
      const { subject, html, text } = welcomeEmail({
        digestDate,
        digestPrettyDate: prettyDate(digestDate),
        digestUrl,
        unsubscribeUrl,
      });
      // Don't fail the confirmation if welcome fails — log and move on.
      try {
        await sendEmail({ to: subscriber.email, subject, html, text });
      } catch (err) {
        console.error("welcome send failed:", (err as Error).message);
      }
    }
  }

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">
        {wasUnsubscribed ? "Already unsubscribed" : "You're in"}
      </h1>
      {wasUnsubscribed ? (
        <p className="subscribe-lede">
          This email previously unsubscribed. <a href="/subscribe">Sign up again</a> if you'd like to start receiving the digest.
        </p>
      ) : (
        <p className="subscribe-lede">
          Confirmed. Your first digest will hit at <b>5am ET</b> tomorrow.
          Check your inbox now — we just sent you yesterday's edition
          as a welcome.
        </p>
      )}
      <p className="subscribe-fine">
        <a href="/">Go to today's digest</a>
      </p>
    </section>
  );
}

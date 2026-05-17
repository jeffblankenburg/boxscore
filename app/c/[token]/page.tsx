import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  confirmSubscriberIfPending,
  findByConfirmToken,
} from "@/lib/subscribers";
import { sendEmail } from "@/lib/email";
import { welcomeEmail } from "@/lib/emails/templates";
import { siteOrigin } from "@/lib/site";
import { getDigest } from "@/lib/digests";
import { yesterdayInET, prettyDate } from "@/lib/dates";
import { isLikelyBot } from "@/lib/bot-detect";

export const metadata = { title: "You're in — boxscore" };
export const dynamic = "force-dynamic";

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const h = await headers();
  const looksLikeBot = isLikelyBot(h.get("user-agent"));

  const subscriber = await findByConfirmToken(token);
  if (!subscriber) notFound();

  const wasUnsubscribed = subscriber.status === "unsubscribed";

  // Skip activation entirely for likely bots (link scanners, social-card
  // previewers, etc.). When the real user clicks from a normal browser, the
  // atomic update below activates the subscription.
  //
  // Atomic transition returns non-null *only* if THIS request moved the row
  // from pending → active. Guarantees the welcome below runs exactly once
  // even if multiple legitimate requests arrive concurrently.
  const justActivated = (wasUnsubscribed || looksLikeBot)
    ? null
    : await confirmSubscriberIfPending(subscriber.id);

  if (justActivated) {
    const origin = await siteOrigin();
    const digestDate = yesterdayInET();
    const digest = await getDigest("mlb", digestDate);
    if (digest && digest.email_html) {
      const digestUrl = `${origin}/mlb/${digestDate}`;
      const unsubscribeUrl = `${origin}/u/${justActivated.unsubscribe_token}`;
      const { subject, html, text } = welcomeEmail({
        digestPrettyDate: prettyDate(digestDate),
        digestUrl,
        unsubscribeUrl,
        digestEmailHtml: digest.email_html,
      });
      try {
        await sendEmail({ to: justActivated.email, subject, html, text });
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
          This email previously unsubscribed.{" "}
          <a href="/subscribe">Sign up again</a> if you'd like to start
          receiving the digest.
        </p>
      ) : (
        <p className="subscribe-lede">
          Confirmed. Your first digest is in your inbox; the next one will hit
          at <b>5am ET</b> tomorrow morning.
        </p>
      )}
      <p className="subscribe-fine">
        <a href="/">Go to today's digest</a>
      </p>
    </section>
  );
}

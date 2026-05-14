import { notFound } from "next/navigation";
import {
  findByUnsubscribeToken,
  unsubscribeSubscriber,
} from "@/lib/subscribers";

export const metadata = { title: "Unsubscribed — boxscore.email" };

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const subscriber = await findByUnsubscribeToken(token);
  if (!subscriber) notFound();

  const wasActive = subscriber.status === "active";
  if (wasActive) {
    await unsubscribeSubscriber(subscriber.id);
  }

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Unsubscribed</h1>
      <p className="subscribe-lede">
        We won't send <code>{subscriber.email}</code> the daily digest anymore.
        {wasActive ? "" : " (Already done — this link had been used before.)"}
      </p>
      <p className="subscribe-fine">
        Changed your mind? <a href="/subscribe">Resubscribe</a>. No hard feelings.
      </p>
    </section>
  );
}

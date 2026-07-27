import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { getSessionSubscriber } from "@/lib/subscriber-session";
import { hasPredictionsAccess } from "@/lib/predictions-entitlements";
import { stripePublishableKey } from "@/lib/stripe";
import { checkoutOpen } from "@/lib/predictions-checkout";
import { sellableSkus, RECURRING_SKUS } from "@/lib/predictions-pricing";
import { todayInET } from "@/lib/dates";
import { SubscribeClient, type PlanOption } from "./SubscribeClient";
import "./subscribe.css";

export const dynamic = "force-dynamic"; // per-subscriber auth + Stripe; never cache
export const metadata = {
  title: "Subscribe · Predictions · boxscore",
  robots: { index: false },
};

function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

const PLAN_META: Record<"week" | "month", { label: string; sub: string }> = {
  week: { label: "Weekly", sub: "7 days · auto-renews" },
  month: { label: "Monthly", sub: "31 days · auto-renews" },
};

export default async function SubscribePage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();

  const today = todayInET();
  const subscriber = await getSessionSubscriber();

  // Absolute return_url for the Payment Element (localhost in dev, prod host in prod).
  const h = await headers();
  const host = h.get("host") ?? "boxscore.email";
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const successUrl = `${proto}://${host}/mlb/predictions/subscribe/success`;

  return (
    <div className="sub-page">
      <h1 className="sub-title">boxscore Predictions</h1>
      <p className="sub-lede">
        Full access to the daily model — every day&apos;s plays, the season track record,
        and the numbers behind each pick.
      </p>

      <SubscribeBody subscriber={subscriber} today={today} successUrl={successUrl} />

      <p className="sub-back">
        <Link href="/mlb/predictions">← Back to Predictions</Link>
      </p>
    </div>
  );
}

async function SubscribeBody({
  subscriber,
  today,
  successUrl,
}: {
  subscriber: Awaited<ReturnType<typeof getSessionSubscriber>>;
  today: string;
  successUrl: string;
}) {
  if (!checkoutOpen()) {
    return <p className="sub-note">Subscriptions aren&apos;t open yet — check back soon.</p>;
  }

  if (!subscriber) {
    return (
      <p className="sub-note">
        Please <Link href="/settings">sign in</Link> to subscribe. It&apos;s the same email you
        get the newsletter at — we&apos;ll send a magic link.
      </p>
    );
  }

  if (await hasPredictionsAccess(subscriber.id, "mlb", today)) {
    return (
      <div className="sub-active">
        <p className="sub-note">You already have an active subscription. 🎉</p>
        <p><Link href="/mlb/predictions">Go to Predictions →</Link> · <Link href="/settings">Manage in Settings</Link></p>
      </div>
    );
  }

  // Plans buyable today (2026 in-season → weekly + monthly).
  const skus = sellableSkus(today).filter((s): s is "week" | "month" => s === "week" || s === "month");
  const plans: PlanOption[] = skus.map((sku) => {
    const price = RECURRING_SKUS.find((r) => r.sku === sku)!.amountCents;
    return { sku, label: PLAN_META[sku].label, priceLabel: priceLabel(price), sub: PLAN_META[sku].sub };
  });

  if (plans.length === 0) {
    return <p className="sub-note">No plans are available for purchase right now.</p>;
  }

  return <SubscribeClient publishableKey={stripePublishableKey()} plans={plans} successUrl={successUrl} />;
}

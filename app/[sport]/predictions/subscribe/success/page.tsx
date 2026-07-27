import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionSubscriber } from "@/lib/subscriber-session";
import { listEntitlements } from "@/lib/predictions-entitlements";
import { prettyDate } from "@/lib/dates";
import { SuccessPoll } from "./SuccessPoll";
import "../subscribe.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscribed · Predictions · boxscore", robots: { index: false } };

export default async function SubscribeSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ redirect_status?: string; try?: string }>;
}) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();
  const { redirect_status, try: tryParam } = await searchParams;

  const subscriber = await getSessionSubscriber();
  if (!subscriber) {
    return (
      <div className="sub-page">
        <h1 className="sub-title">Almost there</h1>
        <p className="sub-note">Please <Link href="/settings">sign in</Link> to see your subscription.</p>
      </div>
    );
  }

  // The webhook (invoice.paid) writes the entitlement moments after payment.
  // Read the newest active one; if it hasn't landed yet, poll a few times.
  const rows = await listEntitlements(subscriber.id, "mlb");
  const active = rows.find((r) => !r.revokedAt && r.source === "stripe");
  const tries = Number(tryParam ?? "0");

  if (redirect_status && redirect_status !== "succeeded") {
    return (
      <div className="sub-page">
        <h1 className="sub-title">Payment not completed</h1>
        <p className="sub-note">Your payment didn&apos;t go through ({redirect_status}). No charge was made.</p>
        <p className="sub-back"><Link href="/mlb/predictions/subscribe">Try again →</Link></p>
      </div>
    );
  }

  if (!active) {
    return (
      <div className="sub-page">
        <h1 className="sub-title">Payment received</h1>
        <p className="sub-note">Activating your access…</p>
        {/* Webhook lag: reload a few times before giving up gracefully. */}
        <SuccessPoll tries={tries} max={6} />
        {tries >= 6 && (
          <p className="sub-note">
            This is taking longer than usual. Your payment succeeded — refresh in a minute,
            or check <Link href="/settings">Settings</Link>.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="sub-page">
      <h1 className="sub-title">You&apos;re in. 🎉</h1>
      <p className="sub-lede">
        Your boxscore Predictions subscription is active through{" "}
        <strong>{prettyDate(active.accessEnd)}</strong>.
      </p>
      <p className="sub-back">
        <Link href="/mlb/predictions">Go to Predictions →</Link> · <Link href="/settings">Manage subscription</Link>
      </p>
    </div>
  );
}

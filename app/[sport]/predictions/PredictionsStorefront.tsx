import { SubscribeClient, type PlanOption } from "./subscribe/SubscribeClient";
import { TrialActivate } from "./TrialActivate";

// The paywall storefront at the top of /mlb/predictions (#111 / Jeff's notes):
// two pricing options + the full on-site checkout, right where the picks would
// be. Cancel-anytime is emphasized up front on purpose — this shouldn't feel
// scammy or hard to leave. Everything below the storefront (results, win %,
// season history) stays public; only today's picks sit behind it.

export function PredictionsStorefront({
  publishableKey,
  plans,
  successUrl,
  gameCount,
  picksPending,
  trialEligible,
}: {
  publishableKey: string;
  plans: PlanOption[];
  successUrl: string;
  gameCount: number;
  picksPending: boolean;
  trialEligible: boolean;
}) {
  const lede = picksPending
    ? "Today's plays lock at 10:30 AM ET, once the morning lines are set."
    : gameCount > 0
      ? `${gameCount} games on today's slate. Subscribe to see the model's plays — today's and every day's, all season.`
      : "Subscribe to get the model's plays every day of the season.";

  return (
    <section className="pr-store pr-framed">
      <h2 className="pr-recap-head">Today&apos;s Plays</h2>
      <p className="pr-store-lede">{lede}</p>

      {trialEligible && <TrialActivate />}

      <p className="pr-store-cancel">
        <strong>Cancel anytime.</strong> If you cancel, we refund the unused days automatically —
        no emails, no hoops. Manage or cancel in one click from Settings.
      </p>

      {plans.length > 0 ? (
        <SubscribeClient publishableKey={publishableKey} plans={plans} successUrl={successUrl} />
      ) : (
        <p className="pr-store-lede">Subscriptions aren&apos;t open right now — check back soon.</p>
      )}

      <p className="pr-store-terms">
        Predictions are informational and for entertainment only — no guarantee of results.
        By subscribing you agree to the <a href="/terms">Terms</a>.
      </p>
    </section>
  );
}

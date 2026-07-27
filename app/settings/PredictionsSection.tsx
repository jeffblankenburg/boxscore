import Link from "next/link";
import { getPredictionsAccountState, type PredictionsAccountState } from "@/lib/predictions-account";
import { stripePublishableKey } from "@/lib/stripe";
import { checkoutOpen } from "@/lib/predictions-checkout";
import { prettyDate } from "@/lib/dates";
import { PredictionsManage } from "./PredictionsManage";

// The Predictions Subscription surface on /settings (#111, Phase 4). Paid
// predictions are league-wide per sport. MLB is live; NFL/NCAA/NBA are
// coming-soon placeholders (their prediction models don't exist yet).

const COMING_SOON: { sport: string; label: string }[] = [
  { sport: "nfl", label: "NFL" },
  { sport: "ncaaf", label: "NCAA Football" },
  { sport: "nba", label: "NBA" },
];

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
function planLabel(product: string): string {
  return product === "week" ? "Weekly" : product === "month" ? "Monthly" : product === "season" ? "Season" : "Playoffs";
}

export async function PredictionsSection({ subscriberId }: { subscriberId: string }) {
  const mlb = await getPredictionsAccountState(subscriberId, "mlb");

  return (
    <>
      <h2 className="settings-section-h">Predictions</h2>
      <p className="subscribe-fine">
        Full access to the daily model — plays, the season track record, and the numbers behind
        each pick. Sold per sport.
      </p>

      <div className="ps-card">
        <div className="ps-card-head">
          <span className="ps-sport-name">MLB</span>
        </div>
        <MlbState state={mlb} />
      </div>

      {COMING_SOON.map((s) => (
        <div className="ps-card ps-soon" key={s.sport}>
          <div className="ps-card-head">
            <span className="ps-sport-name">{s.label}</span>
            <span className="ps-soon-tag">Coming soon</span>
          </div>
        </div>
      ))}
    </>
  );
}

function MlbState({ state }: { state: PredictionsAccountState }) {
  if (state.state === "none") {
    return checkoutOpen() ? (
      <div className="ps-body">
        <p className="ps-note">Not subscribed.</p>
        <Link href="/mlb/predictions/subscribe" className="ps-btn ps-btn-link">Subscribe →</Link>
      </div>
    ) : (
      <p className="ps-note">Not open yet — check back soon.</p>
    );
  }

  if (state.state === "comped") {
    return <p className="ps-note">Complimentary access through <strong>{prettyDate(state.accessEnd)}</strong>.</p>;
  }

  // active | past_due
  const renewLine = state.autoRenew && state.nextChargeISO && state.nextChargeCents != null
    ? `Renews ${prettyDate(state.nextChargeISO)} for ${money(state.nextChargeCents)}.`
    : "Does not renew.";
  const cardLine = state.card ? `${state.card.brand} ···· ${state.card.last4}` : null;

  return (
    <div className="ps-body">
      {state.state === "past_due" && (
        <p className="ps-banner">Your last payment failed — update your card to keep access.</p>
      )}
      <p className="ps-note">
        <strong>{planLabel(state.product)}</strong> — access through <strong>{prettyDate(state.accessEnd)}</strong>.
        {" "}{renewLine}
        {cardLine && <><br /><span className="ps-muted">{cardLine}</span></>}
      </p>
      <PredictionsManage
        publishableKey={stripePublishableKey()}
        refundLabel={money(state.refundIfCancelledNowCents)}
      />
    </div>
  );
}

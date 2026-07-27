"use client";

// "Activate free 3-day trial" button on the storefront, shown only to a
// logged-in, eligible, not-yet-activated subscriber. One click grants the comp
// and reloads so the page unlocks.

import { useState } from "react";
import { activatePredictionsTrial } from "./trial-actions";

export function TrialActivate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setBusy(true);
    setError(null);
    const res = await activatePredictionsTrial();
    if (res.ok) {
      window.location.reload(); // now entitled → picks unlock
    } else {
      setError(res.error);
      setBusy(false);
    }
  }

  return (
    <div className="pr-trial">
      <p className="pr-trial-copy">
        <strong>You&apos;re in early.</strong> Try the full model free for 3 days — no card needed.
      </p>
      <button type="button" className="pr-trial-btn" disabled={busy} onClick={activate}>
        {busy ? "Activating…" : "Start my free 3-day trial"}
      </button>
      {error && <p className="pr-trial-error">{error}</p>}
    </div>
  );
}

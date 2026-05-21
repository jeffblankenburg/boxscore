"use client";

// Consolidated "Run a cron" panel: shared date input, a dropdown of every
// cron route this sport supports, and a single Run button. The modal
// safeguards for the destructive sends (send-email, send-team-email) are
// inlined here — clicking Run on a guarded route opens the two-step
// confirm-then-type-SEND flow before any request fires.
//
// Date semantics: the input shows the EDITION date (the day the email
// goes out / the masthead date). The cron API expects games_date, so
// buildFormData translates by subtracting one day.

import { useState, useTransition } from "react";
import { triggerCron } from "../actions";

function prevDayIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

type Route =
  | "generate"
  | "send-email"
  | "send-team-email"
  | "post-bluesky"
  | "post-twitter"
  | "post-facebook";

const GUARDED: ReadonlySet<Route> = new Set(["send-email", "send-team-email"]);
const RESETTABLE: ReadonlySet<Route> = new Set(["post-bluesky", "post-twitter", "post-facebook"]);

const ROUTE_LABELS: Record<Route, string> = {
  "generate": "Generate digest",
  "send-email": "Send email to subscribers",
  "send-team-email": "Send team digests to subscribers",
  "post-bluesky": "Post to BlueSky",
  "post-twitter": "Post to Twitter",
  "post-facebook": "Post to Facebook",
};

export function CronPanel({
  sport,
  returnTo,
  defaultDate,
  expectedRoutes,
  activeSubs,
  teamSendCount,
}: {
  sport: string;
  returnTo: string;
  defaultDate: string;
  expectedRoutes: readonly Route[];
  activeSubs: number;
  teamSendCount: number;
}) {
  const [date, setDate] = useState(defaultDate);
  const [route, setRoute] = useState<Route>(expectedRoutes[0] ?? "generate");
  const [reset, setReset] = useState(false);
  const [stage, setStage] = useState<"idle" | "confirm" | "typed">("idle");
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const isGuarded = GUARDED.has(route);
  const isResettable = RESETTABLE.has(route);
  const audience = route === "send-team-email" ? teamSendCount : activeSubs;
  const audienceNoun = route === "send-team-email" ? "team-digest send" : "active subscriber";
  const audienceLabel = `${audience.toLocaleString()} ${audienceNoun}${audience === 1 ? "" : "s"}`;

  function buildFormData(): FormData {
    const fd = new FormData();
    fd.set("route", route);
    // Input is edition date; cron API expects games_date = edition - 1.
    fd.set("date", prevDayIso(date));
    fd.set("sport", sport);
    fd.set("returnTo", returnTo);
    if (reset && isResettable) fd.set("reset", "1");
    return fd;
  }

  function handleRun() {
    if (isGuarded) {
      setStage("confirm");
      return;
    }
    startTransition(() => triggerCron(buildFormData()));
  }

  function cancel() {
    setStage("idle");
    setTyped("");
  }

  function fire() {
    startTransition(async () => {
      await triggerCron(buildFormData());
    });
  }

  return (
    <div className="admin-cron-panel">
      <div className="admin-cron-row">
        <label className="admin-cron-field">
          <span className="admin-trigger-label">Date</span>
          <input
            className="admin-input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="admin-cron-field admin-cron-field-wide">
          <span className="admin-trigger-label">Cron</span>
          <select
            className="admin-input"
            value={route}
            onChange={(e) => {
              setRoute(e.target.value as Route);
              // Reset checkbox doesn't survive cron changes — it's only
              // meaningful for the post-* routes.
              setReset(false);
            }}
          >
            {expectedRoutes.map((r) => (
              <option key={r} value={r}>{ROUTE_LABELS[r]}</option>
            ))}
          </select>
        </label>
        {isResettable && (
          <label className="admin-cron-reset">
            <input
              type="checkbox"
              checked={reset}
              onChange={(e) => setReset(e.target.checked)}
            />
            <span>reset</span>
          </label>
        )}
        <button
          type="button"
          className="admin-btn"
          onClick={handleRun}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Running…" : "Run"}
        </button>
      </div>

      {stage !== "idle" && (
        <div
          role="dialog"
          aria-modal="true"
          className="admin-guard-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
        >
          <div className="admin-guard-modal">
            {stage === "confirm" && (
              <>
                <h2 className="admin-guard-title">Send to {audienceLabel}?</h2>
                <p className="admin-guard-body">
                  This will fan out the <code>{date}</code> digest to every
                  matching subscriber. Sends are not reversible.
                </p>
                <p className="admin-guard-body">
                  Make sure you intend to do this. If yesterday&apos;s digest
                  hasn&apos;t been generated yet, run <code>generate</code> first.
                </p>
                <div className="admin-guard-actions">
                  <button type="button" className="admin-btn admin-btn-ghost" onClick={cancel}>
                    Cancel
                  </button>
                  <button type="button" className="admin-btn" onClick={() => setStage("typed")}>
                    Continue
                  </button>
                </div>
              </>
            )}
            {stage === "typed" && (
              <>
                <h2 className="admin-guard-title">Type <code>SEND</code> to confirm</h2>
                <p className="admin-guard-body">
                  Final check. Type <code>SEND</code> below and click the
                  button to fire the email to all {audienceLabel}.
                </p>
                <input
                  className="admin-input admin-guard-input"
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoFocus
                  placeholder="SEND"
                  aria-label="Type SEND to confirm"
                />
                <div className="admin-guard-actions">
                  <button type="button" className="admin-btn admin-btn-ghost" onClick={cancel}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={fire}
                    disabled={typed !== "SEND" || pending}
                    aria-busy={pending}
                  >
                    {pending ? "Sending…" : "Fire the send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

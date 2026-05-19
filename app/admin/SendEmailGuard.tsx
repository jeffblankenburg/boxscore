"use client";

// Multi-step confirmation for the "send to all subscribers" button.
//
// Why: an accidental click on this button fans out to every active subscriber.
// That's irreversible, customer-visible, and burns sender reputation if the
// content was wrong. Three friction points before the request fires:
//   1. The initial "Send email to subscribers" button.
//   2. Modal #1: "About to send to N subscribers" with explicit Continue.
//   3. Modal #2: type SEND to enable the final button.
//
// This guard wraps the existing TriggerForm server action — the actual cron
// invocation is unchanged. We just gate the form submission.

import { useState, useTransition } from "react";
import { triggerCron } from "./actions";

export function SendEmailGuard({
  defaultDate,
  activeSubscribers,
  sport = "mlb",
  returnTo = "/admin",
}: {
  defaultDate: string;
  activeSubscribers: number;
  sport?: string;
  returnTo?: string;
}) {
  const [stage, setStage] = useState<"idle" | "confirm" | "typed">("idle");
  const [date, setDate] = useState(defaultDate);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const cancel = () => {
    setStage("idle");
    setTyped("");
  };

  const fire = () => {
    const fd = new FormData();
    fd.set("route", "send-email");
    fd.set("date", date);
    fd.set("sport", sport);
    fd.set("returnTo", returnTo);
    startTransition(async () => {
      await triggerCron(fd);
    });
  };

  return (
    <div className="admin-trigger-form">
      <label>
        <span className="admin-trigger-label">Send email to subscribers</span>
        <input
          className="admin-input"
          type="date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="admin-btn"
        onClick={() => setStage("confirm")}
        disabled={pending}
      >
        Run send-email
      </button>

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
                <h2 className="admin-guard-title">Send to {activeSubscribers.toLocaleString()} subscribers?</h2>
                <p className="admin-guard-body">
                  This will fan out the <code>{date}</code> digest to every
                  active subscriber. Sends are not reversible.
                </p>
                <p className="admin-guard-body">
                  Make sure you intend to do this. If yesterday's digest hasn't
                  been generated yet, run <code>generate</code> first.
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
                  button to fire the email to all{" "}
                  {activeSubscribers.toLocaleString()} active subscribers.
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

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import posthog from "posthog-js";
import { submitAdInquiry } from "./actions";
import { BUDGETS, FORMATS } from "./options";

// Inquiry form on /advertise. Newspaper-styled — looks like the "letters to
// the editor" coupon you'd cut out and mail in. Server action sends the
// message via Resend so it lands in the inbox immediately AND persists to
// advertise_inquiries with attribution (utm + referer + posthog session)
// so /admin/leads can reconstruct how each prospect found us. Honeypot
// field drops bot submissions without telling them.

type Attribution = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  referer: string;
  landing_path: string;
  posthog_session: string;
};

function captureAttribution(): Attribution {
  if (typeof window === "undefined") {
    return { utm_source: "", utm_medium: "", utm_campaign: "", utm_term: "",
             utm_content: "", referer: "", landing_path: "", posthog_session: "" };
  }
  const params = new URLSearchParams(window.location.search);
  // Document.referrer is empty when the visitor landed directly OR when the
  // referring site set rel=noreferrer; in either case we just send "".
  const referer = document.referrer ?? "";
  // landing_path = the path within boxscore.email where the session started.
  // sessionStorage is set by PostHogPageview on the first pageview of the
  // session; falls back to current path if missing.
  let landing = "";
  try {
    landing = sessionStorage.getItem("boxscore_landing_path") ?? window.location.pathname;
  } catch {
    landing = window.location.pathname;
  }
  let sessionId = "";
  try { sessionId = posthog.get_session_id() ?? ""; } catch { sessionId = ""; }
  return {
    utm_source:   params.get("utm_source")   ?? "",
    utm_medium:   params.get("utm_medium")   ?? "",
    utm_campaign: params.get("utm_campaign") ?? "",
    utm_term:     params.get("utm_term")     ?? "",
    utm_content:  params.get("utm_content")  ?? "",
    referer,
    landing_path: landing,
    posthog_session: sessionId,
  };
}

export function InquiryForm() {
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Captured once on mount so utm + referer reflect the moment they arrived
  // — not the moment they hit submit (which could be after route changes
  // that wiped the URL params).
  const attribution = useRef<Attribution | null>(null);
  useEffect(() => { attribution.current = captureAttribution(); }, []);

  return (
    <form
      className="advertise-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const a = attribution.current ?? captureAttribution();
        for (const [k, v] of Object.entries(a)) fd.set(k, v);
        const email = String(fd.get("email") ?? "").trim();
        setError(null);
        startTransition(async () => {
          const result = await submitAdInquiry(fd);
          if (result.ok) {
            setStatus("ok");
            // Identify the visitor in PostHog by the email they just shared
            // — back-fills the anonymous pageviews from this session onto
            // a now-known person so /admin/leads can link to their journey.
            try { if (email) posthog.identify(email, { email }); } catch { /* noop */ }
            (e.target as HTMLFormElement).reset();
          } else {
            setStatus("error");
            setError(result.error);
          }
        });
      }}
    >
      <div className="advertise-form-row">
        <label className="advertise-form-field">
          <span>Name</span>
          <input name="name" type="text" required autoComplete="name" />
        </label>
        <label className="advertise-form-field">
          <span>Email</span>
          <input name="email" type="email" required autoComplete="email" />
        </label>
      </div>

      <label className="advertise-form-field">
        <span>Company or brand <em>(optional)</em></span>
        <input name="company" type="text" autoComplete="organization" />
      </label>

      <label className="advertise-form-field">
        <span>Budget</span>
        <select name="budget" defaultValue="">
          <option value="">Pick a range</option>
          {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>

      <fieldset className="advertise-form-field advertise-form-formats">
        <legend>Formats of interest</legend>
        <div className="advertise-form-checks">
          {FORMATS.map((f) => (
            <label key={f} className="advertise-form-check">
              <input type="checkbox" name="formats" value={f} />
              <span>{f}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="advertise-form-field">
        <span>Message</span>
        <textarea
          name="message"
          required
          rows={5}
          placeholder="What are you advertising, when do you want to run, anything else worth knowing."
        />
      </label>

      {/* Honeypot — hidden from real users, irresistible to bots. */}
      <div className="advertise-form-trap" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="advertise-form-foot">
        <button type="submit" className="advertise-form-submit" disabled={pending}>
          {pending ? "Sending…" : "Send inquiry"}
        </button>
        {status === "ok" && (
          <p className="advertise-form-ok" role="status">
            Got it. Reply within one business day — usually same day.
          </p>
        )}
        {status === "error" && error && (
          <p className="advertise-form-error" role="alert">{error}</p>
        )}
      </div>
    </form>
  );
}

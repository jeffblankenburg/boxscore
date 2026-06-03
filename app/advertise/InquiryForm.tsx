"use client";

import { useState, useTransition } from "react";
import { submitAdInquiry } from "./actions";
import { BUDGETS, FORMATS } from "./options";

// Inquiry form on /advertise. Newspaper-styled — looks like the "letters to
// the editor" coupon you'd cut out and mail in. Server action sends the
// message via Resend so it lands in the inbox immediately; honeypot field
// drops bot submissions without telling them.

export function InquiryForm() {
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="advertise-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await submitAdInquiry(fd);
          if (result.ok) {
            setStatus("ok");
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

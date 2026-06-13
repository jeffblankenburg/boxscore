"use client";

// Demographics form — shared by /welcome (new subscribers, post-confirm)
// and /settings (existing subscribers filling in retroactively). All
// fields optional; "Save and continue" submits whatever's filled in,
// "Skip for now" submits an empty form and marks the welcome step done
// so the user isn't pestered.

import { useState } from "react";
import {
  AGE_BANDS,
  INCOME_BANDS,
  GENDERS,
  COUNTRIES,
  US_STATES,
} from "@/lib/demographics";
import { saveDemographics } from "./actions";
// Co-locate the stylesheet with the component so it's pulled in
// wherever the form is mounted (welcome page AND settings card).
// The previous setup only loaded welcome.css from /welcome/page.tsx,
// so /settings rendered the form completely unstyled.
import "./welcome.css";

export type DemographicsFormProps = {
  // Initial values when editing an existing row from /settings. On
  // /welcome these are all null.
  initial?: {
    country?:     string | null;
    region?:      string | null;
    age_band?:    string | null;
    income_band?: string | null;
    gender?:      string | null;
  };
  // "Save and continue" / "Skip" semantics — only the welcome page
  // shows the Skip button. /settings replaces it with "Cancel".
  showSkip?: boolean;
};

export function DemographicsForm({ initial, showSkip = true }: DemographicsFormProps) {
  // Drives whether the State dropdown is rendered. Region only makes
  // sense for US right now (Canadian provinces / Bundesländer aren't
  // in the advertiser dashboard yet), so we hide the field entirely
  // for any other country selection.
  const [country, setCountry] = useState<string>(initial?.country ?? "");

  return (
    <form action={saveDemographics} className="welcome-form">
      <div className="welcome-field">
        <label htmlFor="country">Country</label>
        <select
          id="country"
          name="country"
          defaultValue={initial?.country ?? ""}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="">—</option>
          {COUNTRIES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {country === "US" ? (
        <div className="welcome-field">
          <label htmlFor="region">State</label>
          <select id="region" name="region" defaultValue={initial?.region ?? ""}>
            <option value="">—</option>
            {US_STATES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="welcome-field">
        <label htmlFor="age_band">Age range</label>
        <select id="age_band" name="age_band" defaultValue={initial?.age_band ?? ""}>
          <option value="">—</option>
          {AGE_BANDS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="welcome-field">
        <label htmlFor="income_band">Household income</label>
        <select id="income_band" name="income_band" defaultValue={initial?.income_band ?? ""}>
          <option value="">—</option>
          {INCOME_BANDS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="welcome-field">
        <label htmlFor="gender">What best describes you?</label>
        <select
          id="gender"
          name="gender"
          defaultValue={initial?.gender ?? ""}
        >
          <option value="">—</option>
          {GENDERS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="welcome-actions">
        <button type="submit" className="welcome-submit">Save and continue</button>
        {showSkip ? (
          // Skip = leave the form without saving anything. Because
          // demographics_completed_at stays null, the next sign-in
          // (via /auth/[token]) will push them back to /welcome —
          // intentional, per the "skip should not be complete" spec.
          <a href="/settings" className="welcome-skip">
            Skip for now
          </a>
        ) : null}
      </div>
    </form>
  );
}

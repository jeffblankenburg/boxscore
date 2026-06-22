"use client";

import { useEffect, useState } from "react";

// Renders hidden form inputs carrying the acquisition attribution captured
// by the root-layout script (see AttributionCapture in app/layout.tsx). Read
// from sessionStorage on mount; absent on first render so SSR HTML doesn't
// include stale empty inputs. Empty strings stay empty (the server action
// coalesces to null).
//
// If sessionStorage was never populated (private mode, JS disabled before
// hydration, etc.), this component renders nothing and the server action
// writes nulls for attribution. That's an accurate signal: "we don't know."

type Attribution = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  referrer: string;
  landing_path: string;
};

const STORAGE_KEY = "boxscore_attr";

const FIELDS: Array<keyof Attribution> = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
  "landing_path",
];

export default function AttributionFields() {
  const [attr, setAttr] = useState<Attribution | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<Attribution>;
      setAttr({
        utm_source: parsed.utm_source ?? "",
        utm_medium: parsed.utm_medium ?? "",
        utm_campaign: parsed.utm_campaign ?? "",
        utm_content: parsed.utm_content ?? "",
        utm_term: parsed.utm_term ?? "",
        referrer: parsed.referrer ?? "",
        landing_path: parsed.landing_path ?? "",
      });
    } catch {
      // sessionStorage unavailable or JSON malformed — leave hidden inputs out.
    }
  }, []);

  if (!attr) return null;

  return (
    <>
      {FIELDS.map((name) => (
        <input key={name} type="hidden" name={name} value={attr[name]} />
      ))}
    </>
  );
}

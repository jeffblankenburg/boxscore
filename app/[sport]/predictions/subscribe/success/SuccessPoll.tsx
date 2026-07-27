"use client";

// Bridges the brief gap between payment confirmation and the webhook writing
// the entitlement. Reloads the success page (incrementing ?try) every ~2s up
// to `max` times, then stops so the page can show a graceful fallback.

import { useEffect } from "react";

export function SuccessPoll({ tries, max }: { tries: number; max: number }) {
  useEffect(() => {
    if (tries >= max) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("try", String(tries + 1));
      window.location.replace(url.toString());
    }, 2000);
    return () => clearTimeout(t);
  }, [tries, max]);

  return <p className="sub-note" aria-live="polite">Checking…</p>;
}

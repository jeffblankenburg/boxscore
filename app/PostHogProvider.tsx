"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

// Client-side PostHog bootstrap. We disable PostHog's built-in pageview
// auto-capture (which doesn't fire on App Router soft navigations) and emit
// $pageview ourselves whenever the pathname or query string changes.
//
// Required env vars (NEXT_PUBLIC_ so they reach the browser):
//   NEXT_PUBLIC_POSTHOG_KEY   — project API key from posthog.com
//   NEXT_PUBLIC_POSTHOG_HOST  — e.g. https://us.i.posthog.com (US cloud)
// If the key is unset (e.g. in local dev), this component is a silent no-op.

let initialized = false;

function ensureInit() {
  if (initialized) return;
  if (typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: false,        // we fire $pageview manually below
    capture_pageleave: true,
    // Sessions can leak PII in admin previews — turn recordings off until
    // we explicitly opt them in.
    disable_session_recording: true,
    persistence: "localStorage+cookie",
  });
  initialized = true;
}

export function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    ensureInit();
    if (!initialized) return;
    // Don't track the admin surface — it's auth-only, low volume, and would
    // pollute the funnel reports.
    if (pathname?.startsWith("/admin")) return;
    const qs = searchParams?.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

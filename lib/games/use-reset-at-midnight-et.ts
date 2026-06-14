"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Watches the ET wall-clock date and calls router.refresh() the moment
// the ET date rolls over past `initialDateET`. The server pages compute
// `playedOn` via todayInET() and are force-dynamic, so a refresh pulls
// in tomorrow's puzzle/stat/sequence as soon as midnight ET ticks.
//
// Two triggers:
//   1. A precise setTimeout fired at the next midnight ET (re-scheduled
//      after each fire so a long-lived tab keeps resetting nightly).
//   2. visibilitychange — backgrounded tabs throttle setTimeout, so we
//      also check on refocus in case the timer drifted past the
//      rollover while the tab was hidden.
export function useResetAtMidnightET(initialDateET: string) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function nowDateET(): string {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
      });
      const parts = fmt.formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}`;
    }

    function msUntilNextMidnightET(): number {
      const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
      });
      const parts = fmt.formatToParts(new Date());
      const get = (t: string) =>
        Number(parts.find((p) => p.type === t)?.value ?? "0");
      // Intl returns "24" for midnight on some platforms — clamp to 0.
      const h = get("hour") % 24;
      const m = get("minute");
      const s = get("second");
      const msIntoDay = ((h * 60 + m) * 60 + s) * 1000;
      // +1500ms safety pad so we fire AFTER the rollover, not at the
      // instant of it (avoids "still yesterday" race).
      return 24 * 60 * 60 * 1000 - msIntoDay + 1500;
    }

    function tryRefresh() {
      if (nowDateET() !== initialDateET) router.refresh();
    }

    function schedule() {
      timer = setTimeout(() => {
        tryRefresh();
        schedule();
      }, msUntilNextMidnightET());
    }

    function onVisible() {
      if (document.visibilityState === "visible") tryRefresh();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [initialDateET, router]);
}

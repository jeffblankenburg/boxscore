export function yesterdayInET(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Today's date as YYYY-MM-DD in America/New_York. Used by the games
// surface as the puzzle-date key so the daily rollover happens at
// midnight ET (matching MLB's home timezone and the digest cron). A
// naive `new Date().toISOString().slice(0,10)` rolls over at 00:00
// UTC instead, which is 8pm ET (summer) — players see tomorrow's
// puzzle while their wall clock still says today.
export function todayInET(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// MM-DD of today in ET. Used by the historical OTD picker / admin viewer
// to filter by calendar day across all years.
export function todayMMDDInET(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}-${get("day")}`;
}

export function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

// Shorter form for email subject lines: "May 18, 2026". No weekday so the
// subject stays scannable in a crowded inbox.
export function shortPrettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y
      && dt.getUTCMonth() === m - 1
      && dt.getUTCDate() === d;
}

// Newspaper-style "Vol. X, Issue Y" counter for the dateline's bottom-right:
//   Issue  = day-of-year (Jan 1 = 1, Dec 31 = 365/366). Resets every year.
//   Volume = calendar year - launch year + 1. 2026 = Vol. 1, 2027 = Vol. 2.
// Both are pure functions of the date — no launch-day gating, no stored
// state — so regenerating any past or future digest produces a consistent
// counter every time.
const LAUNCH_YEAR = 2026;

export function issueNumber(sendDateIso: string): number {
  const [y, m, d] = sendDateIso.split("-").map(Number) as [number, number, number];
  const dt = Date.UTC(y, m - 1, d);
  const jan1 = Date.UTC(y, 0, 1);
  return Math.floor((dt - jan1) / 86_400_000) + 1;
}

export function volumeNumber(sendDateIso: string): number {
  const y = Number(sendDateIso.slice(0, 4));
  // 0 for pre-launch years — renderers gate the chip on a truthy check,
  // so pre-2026 archived editions render no Vol./Issue at all.
  if (y < LAUNCH_YEAR) return 0;
  return y - LAUNCH_YEAR + 1;
}

// Returns the date one day after `iso` in ISO format. Used to fetch the
// "tomorrow" schedule for the Today's Games section of a yesterday-dated digest.
export function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export function prevDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

// Add (or subtract) whole days to an ISO YYYY-MM-DD calendar date. UTC-noon
// math so DST transitions never shift the result. Used to derive entitlement
// windows (access_start + termDays - 1) for the predictions paywall.
export function addDaysToISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Whole days from ISO `a` to ISO `b` (b − a). Negative if b precedes a.
// UTC-noon-free integer math; DST-safe since both are pure calendar dates.
export function daysBetweenISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// The ET calendar date (YYYY-MM-DD) a Unix-seconds instant falls on. Stripe
// timestamps are Unix seconds; entitlement windows are ET calendar dates, so
// a charge at 2026-07-27T18:30Z maps to the 2026-07-27 ET edition.
export function etDateFromUnixSeconds(unixSeconds: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(unixSeconds * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Format an ISO-8601 timestamp (UTC) as a short ET clock time, e.g. "7:05 PM ET".
// Returns "TBD" without the suffix when the input isn't a valid date.
export function timeInET(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "TBD";
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
  return `${clock} ET`;
}

// Shared fetch for ESPN's hidden APIs (site.api.espn.com / *.web.api.espn.com).
//
// Why this exists: ESPN's edge (Akamai) intermittently returns 403/429 to
// datacenter egress IPs under burst load. On 2026-10-23 a cron-time 403 on the
// NBA scoreboard took down the generate + send runs for EVERY ESPN-backed sport
// (NBA/WNBA/NHL/NFL/NCAAF/NCAAM/NCAAW). The cause: each module had its own
// copy-pasted getJson that only retried 5xx — `res.status < 500` threw
// immediately, so a transient 403 was instantly fatal with no retry.
//
// This centralizes the fetch so every sport behaves the same: retry the
// transient blocks (403/408/425/429 + 5xx) with backoff + jitter, and send a
// browser User-Agent + Referer so we look less like a bot. Real client errors
// (400/401) are never retried; 404 is returned for the caller to interpret
// (unknown player id vs missing scoreboard).

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Transient = worth retrying. 403/429 are ESPN's edge throttling/bot blocks
// (not a permanent auth failure); 408/425 are timeout-ish; 5xx are ESPN cache
// rebuilds. 400/401/451 are real and never retried.
const TRANSIENT = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

export async function espnFetch(url: string, signal?: AbortSignal): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      cache: "no-store",
      signal,
      headers: {
        "User-Agent": UA,
        Referer: "https://www.espn.com/",
        Accept: "application/json, text/plain, */*",
      },
    });
    if (res.ok || res.status === 404) return res;
    if (!TRANSIENT.has(res.status) || attempt === MAX_ATTEMPTS) return res;
    // Short, jittered backoff — ESPN's throttle windows are brief, and jitter
    // spreads a cron's concurrent fetches so they don't retry in lockstep.
    const delay = 500 * attempt + Math.floor(Math.random() * 400);
    await new Promise((r) => setTimeout(r, delay));
  }
  return res!;
}

// JSON convenience. Returns parsed JSON on 2xx. On 404: null when `nullOn404`
// (unknown player/team id), else throws. Any other non-ok throws after retries.
export async function espnJson(
  url: string,
  opts: { nullOn404?: boolean; signal?: AbortSignal } = {},
): Promise<unknown | null> {
  const res = await espnFetch(url, opts.signal);
  if (res.ok) return res.json();
  if (res.status === 404 && opts.nullOn404) return null;
  throw new Error(`ESPN ${res.status} for ${url}`);
}

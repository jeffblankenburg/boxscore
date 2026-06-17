// Low-level SportsDataIO HTTP client. Returns raw JSON from SDIO endpoints
// with the API key tucked into the query string. Nothing about the digest
// or canonical model lives here — that's sdio-fetch-daily.ts and the SDIO
// canonical adapter respectively.

const BASE = "https://api.sportsdata.io/v3/mlb";

function getKey(): string {
  const k = process.env.SPORTSDATAIO_API_KEY;
  if (!k) throw new Error("SPORTSDATAIO_API_KEY not set");
  return k;
}

// SDIO date paths use YYYY-MMM-DD (e.g. 2026-JUN-15). statsapi uses
// YYYY-MM-DD; we keep ISO at every boundary and convert only on the way
// out to SDIO URLs.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function isoToSdioDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  if (!y || !m || !d) throw new Error(`isoToSdioDate: invalid iso ${iso}`);
  return `${y}-${MONTHS[m - 1]}-${String(d).padStart(2, "0")}`;
}

export async function sdioGet(path: string): Promise<unknown> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Strip the key out of logged URLs — these errors land in Vercel logs
    // and we don't want our SDIO key in plaintext there.
    const sanitized = url.replace(/key=[^&]+/, "key=***");
    throw new Error(`SDIO ${res.status} for ${sanitized}`);
  }
  return res.json();
}

import { headers } from "next/headers";

/**
 * The canonical site origin (e.g., "https://boxscore.email" or
 * "http://localhost:3001"). Used to build absolute URLs for email links AND
 * for puppeteer to fetch the rendered digest page when generating share
 * images.
 *
 * Resolution order:
 *   1. SITE_ORIGIN env var (explicit override; useful in CI/scripts).
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel auto-sets this to the custom
 *      domain (e.g. "boxscore.email"). Critical: when crons run, the inbound
 *      request host is a deployment-specific URL like "boxscore-abc123.vercel.app"
 *      which sits behind Vercel Deployment Protection. Hitting that URL from
 *      puppeteer returns an SSO login wall, not the page we want. The
 *      production URL is publicly reachable.
 *   3. Inbound request's host header — fine for browser-driven requests on
 *      the production domain, and the only option in local dev.
 */
export async function siteOrigin(): Promise<string> {
  if (process.env.SITE_ORIGIN) return process.env.SITE_ORIGIN;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const h = await headers();
  const host = h.get("host") ?? "boxscore.email";
  const forwardedProto = h.get("x-forwarded-proto");
  const proto = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

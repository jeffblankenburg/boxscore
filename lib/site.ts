import { headers } from "next/headers";

/**
 * Production origin for anything externally visible — links baked into
 * outbound emails (confirm/unsub/digest/manage), magic-link tokens, and
 * URLs embedded in social-post text. The origin must be reachable to the
 * recipient, which means it must NOT be `localhost` in production and
 * must NOT be a Vercel deployment-specific URL even when the cron ran
 * on a preview deployment.
 *
 * Dev override: set EMAIL_LINK_BASE=http://localhost:3000 in .env.local
 * to make magic-link / confirm emails point at the local server. Real
 * inboxes won't reach a localhost URL, of course — only useful when
 * sending test emails to yourself with Resend in dev and clicking the
 * resulting links from your dev browser.
 *
 * Use this — not `siteOrigin()` — anywhere a URL ends up in front of a
 * subscriber's eyeballs. Reserve `siteOrigin()` for server-to-server
 * fetches inside the same deployment (admin → /api/cron/*) and for
 * puppeteer's `baseUrl` when rendering share images.
 */
export const EMAIL_LINK_BASE = process.env.EMAIL_LINK_BASE ?? "https://boxscore.email";

/**
 * The reachable site origin for the current deployment (e.g.,
 * "https://boxscore.email", "https://boxscore-abc123.vercel.app", or
 * "http://localhost:3001"). Used by admin server actions to fetch their own
 * /api/cron routes and by puppeteer to fetch the rendered digest page when
 * generating share images.
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

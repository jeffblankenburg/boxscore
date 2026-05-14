import { headers } from "next/headers";

/**
 * The canonical site origin (e.g., "https://boxscore.email" or
 * "http://localhost:3001"), derived from the inbound request. Used to build
 * absolute URLs for email links.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "boxscore.email";
  const forwardedProto = h.get("x-forwarded-proto");
  const proto = forwardedProto ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

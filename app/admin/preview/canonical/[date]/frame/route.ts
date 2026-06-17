// Iframe content for the canonical preview tool. Loads the chosen
// data source (statsapi or sdio) from its respective daily_raw table,
// runs the canonical adapter, bridges to DailyData, and hands it to the
// EXACT production renderer (renderContent / renderEmailContent). The
// only difference between this surface and /[sport]/[date] is the
// upstream path; the HTML body is byte-identical when the underlying
// data agrees.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, prettyDate } from "@/lib/dates";
import { BRAND } from "@/lib/brand";
import { SOCIAL_ICON_DATA_BY_SLUG } from "@/lib/brand-icon-data";

import { getDailyRaw } from "@/lib/daily-raw";
import { getSdioDailyRaw } from "@/lib/sports/mlb/sources/sdio-storage";
import { adaptStatsapiDailyRaw } from "@/lib/sports/mlb/adapters/from-statsapi";
import { adaptSdioDailyPayload } from "@/lib/sports/mlb/adapters/from-sdio";
import { getCanonicalPlayerLookup } from "@/lib/canonical-players";
import { renderCanonicalWeb, type HighlightMap } from "@/lib/sports/mlb/render/web";
import { renderCanonicalEmail } from "@/lib/sports/mlb/render/email";
import { diffCanonical, highlightKeysFor } from "@/lib/sports/mlb/diff";
import type { CanonicalDailyData } from "@/lib/sports/mlb/canonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (sessionToken && (await validateSession(sessionToken))) return true;
  return false;
}

function socialIconSvg(slug: string): string {
  const data = SOCIAL_ICON_DATA_BY_SLUG[slug];
  if (!data) return "";
  return `<svg viewBox="${data.viewBox}" width="18" height="18" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="${data.path}"/></svg>`;
}

function siteHeaderHtml(iconUrl: string): string {
  const socialLinks = BRAND.social
    .map(
      (s) =>
        `<a href="${s.href}" class="social-icon" aria-label="${s.label}" target="_blank" rel="noopener noreferrer">${socialIconSvg(s.slug)}</a>`,
    )
    .join("");
  return `<header class="site-header">
  <div class="brand">
    <a href="/">
      <img src="${iconUrl}" alt="" width="28" height="28" class="brand-icon">
      <span>boxscore</span>
    </a>
  </div>
  <nav class="social" aria-label="Social">${socialLinks}</nav>
  <div class="header-cta">
    <a class="games-pill" href="/games">Games</a>
    <a class="support" href="/r/support?src=web-header">Tip Jar</a>
    <a class="subscribe" href="${BRAND.subscribeUrl}">Subscribe →</a>
  </div>
</header>`;
}

function siteFooterHtml(): string {
  const legal = BRAND.footerLinks
    .map((link) => {
      const attrs = link.external ? ` target="_blank" rel="noopener noreferrer"` : "";
      return `<a href="${link.href}"${attrs}>${link.label}</a>`;
    })
    .join("");
  return `<footer class="site-footer">
  <span class="site-footer-credit">
    <a href="/">${BRAND.name}</a> · ${BRAND.tagline}
  </span>
  <span class="site-footer-legal">${legal}</span>
</footer>`;
}

async function loadCanonical(date: string, source: "statsapi" | "sdio"): Promise<CanonicalDailyData | null> {
  if (source === "sdio") {
    const payload = await getSdioDailyRaw("mlb", date);
    if (!payload) return null;
    return adaptSdioDailyPayload(date, payload);
  }
  const raw = await getDailyRaw("mlb", date);
  if (!raw) return null;
  return adaptStatsapiDailyRaw(date, raw);
}

function missingDataHtml(date: string, source: "statsapi" | "sdio"): string {
  const what = source === "sdio" ? "SDIO" : "statsapi.mlb.com";
  const hint = source === "sdio"
    ? "Click 'Fetch SDIO now' on the parent page to pull it."
    : "The daily cron writes statsapi rows at 09:00 UTC.";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 14px/1.5 system-ui, sans-serif; padding: 32px; color: #444; }
    code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
  </style></head><body>
    <h2 style="margin: 0 0 8px;">No ${what} data for ${date}</h2>
    <p>${hint}</p>
  </body></html>`;
}

// Gmail clips email bodies over ~102KB and renders "[Message clipped] View
// entire message" at the cut. The threshold is measured against the raw
// HTML payload (post-MIME-decode), so we count UTF-8 bytes of the full
// rendered email — preamble, body, footer, everything — and insert a
// loud visual marker at the next safe tag boundary past the threshold.
// Preview-only: production sends never hit this code path.
const GMAIL_CLIP_BYTES = 102 * 1024;

function injectGmailClipMarker(fullHtml: string): string {
  const total = Buffer.byteLength(fullHtml, "utf8");
  if (total <= GMAIL_CLIP_BYTES) return fullHtml;

  // UTF-8 multi-byte safety: walk character-by-character, accumulating
  // bytes, until we cross the threshold. Then advance to the next safe
  // tag-close boundary so the marker doesn't land mid-element.
  let bytes = 0;
  let charIdx = 0;
  for (; charIdx < fullHtml.length; charIdx++) {
    const cp = fullHtml.charCodeAt(charIdx);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : (cp >= 0xD800 && cp <= 0xDBFF ? 4 : 3);
    if (cp >= 0xD800 && cp <= 0xDBFF) charIdx++; // skip low surrogate
    if (bytes >= GMAIL_CLIP_BYTES) break;
  }
  // Advance to the next "</div>" boundary so the marker lands between
  // top-level blocks instead of inside a <tbody> (which would break
  // table layout). Falling back to "</table>" if no div is nearby, and
  // raw charIdx if neither — the marker is a preview-only diagnostic so
  // a slightly-worse fallback is fine.
  const search = fullHtml.slice(charIdx);
  let m = search.search(/<\/div>/i);
  if (m === -1) m = search.search(/<\/table>/i);
  const insertAt = m === -1 ? charIdx : charIdx + search.indexOf(">", m) + 1;

  const marker = `
<div style="border-top:3px dashed #d62828;background:#fff5f5;padding:10px 14px;margin:6px 0;font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#d62828;font-weight:700;text-align:center;letter-spacing:0.02em;">
  ↑ Gmail clip threshold (≈102 KB) · everything below this line gets hidden behind "[Message clipped] View entire message"
</div>`;
  return fullHtml.slice(0, insertAt) + marker + fullHtml.slice(insertAt);
}

export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { date } = await params;
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  const url = new URL(req.url);
  const source: "statsapi" | "sdio" = url.searchParams.get("source") === "sdio" ? "sdio" : "statsapi";
  const surface: "web" | "email"   = url.searchParams.get("surface") === "email" ? "email" : "web";
  const highlight = url.searchParams.get("highlight") === "1";

  // Warm the canonical-player lookup before running the adapter — the
  // adapter's MlbPlayerRef builder reads the cache synchronously.
  await getCanonicalPlayerLookup();
  const canonical = await loadCanonical(date, source);
  if (!canonical) {
    return new NextResponse(missingDataHtml(date, source), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // Highlight overlay: load the OTHER source as well, diff the two
  // canonical bundles, and pass the per-side highlight set to the
  // renderer. Quietly degrades to "no highlights" if the other source
  // has no data — preview still renders without errors.
  let hl: HighlightMap = undefined;
  if (highlight) {
    const otherCanonical = await loadCanonical(date, source === "statsapi" ? "sdio" : "statsapi");
    if (otherCanonical) {
      const [left, right] = source === "statsapi"
        ? [canonical, otherCanonical]
        : [otherCanonical, canonical];
      const report = diffCanonical("statsapi", "SportsDataIO", left, right);
      hl = highlightKeysFor(report, source === "statsapi" ? "left" : "right");
    }
  }

  let html: string;
  if (surface === "email") {
    // Canonical email renderer reads CanonicalDailyData directly — no
    // bridge to legacy DailyData. dailyEmail() still wraps the body in
    // the email shell (preamble, unsubscribe footer, EMAIL_STYLES <head>).
    const fullHtml = dailyEmail({
      sport: "mlb",
      digestDate: canonical.date,
      digestPrettyDate: prettyDate(canonical.date),
      digestUrl:     "#",
      unsubscribeUrl:"#",
      manageUrl:     "#",
      gamesUrl:      "#",
      tipJarUrl:     "#",
      digestEmailHtml: renderCanonicalEmail(canonical),
    }).html;
    html = injectGmailClipMarker(fullHtml);
  } else {
    const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
    const iconUrl = "https://boxscore.email/icon.png";
    html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap">
<style>${globalsCss}</style>
</head>
<body>
<div class="newspaper">
${siteHeaderHtml(iconUrl)}
${renderCanonicalWeb(canonical, hl)}
${siteFooterHtml()}
</div>
</body>
</html>`;
  }

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";
import { loadDailyData } from "@/lib/daily";
import { loadNbaData } from "@/lib/nba";
import { loadWnbaData } from "@/lib/wnba";
import { renderContent } from "@/lib/render";
import { renderEmailContent } from "@/lib/render-email";
import {
  renderBasketballContent,
  renderBasketballEmailContent,
} from "@/lib/render-basketball";
import { dailyEmail } from "@/lib/emails/templates";
import { BRAND } from "@/lib/brand";
import type { DigestMode } from "@/lib/digest-mode";
import { MLB_PREVIEW_FIXTURES, MLB_PREVIEW_MODES } from "@/lib/mlb-preview-fixtures";
import {
  BASKETBALL_PREVIEW_MODES,
  basketballFixtureDate,
  type BasketballPreviewMode,
} from "@/lib/basketball-preview-fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (sessionToken && (await validateSession(sessionToken))) return true;
  return false;
}

function asMlbMode(s: string | null): DigestMode {
  const valid = new Set<DigestMode>(MLB_PREVIEW_MODES);
  if (s && (valid as Set<string>).has(s)) return s as DigestMode;
  return "regular";
}

function asBasketballMode(s: string | null): BasketballPreviewMode {
  const valid = new Set<string>(BASKETBALL_PREVIEW_MODES);
  if (s && valid.has(s)) return s as BasketballPreviewMode;
  return "current";
}

function siteHeaderHtml(iconUrl: string): string {
  const socialLinks = BRAND.social
    .map((s) => `<a href="${s.href}">${s.label}</a>`)
    .join("");
  return `<header class="site-header">
  <div class="brand">
    <a href="/">
      <img src="${iconUrl}" alt="" width="28" height="28" class="brand-icon">
      <span>boxscore</span>
    </a>
  </div>
  <nav class="social">${socialLinks}</nav>
  <div class="header-cta">
    <a class="support" href="/r/support?src=web-header">Support</a>
    <a class="subscribe" href="${BRAND.subscribeUrl}">Subscribe →</a>
  </div>
</header>`;
}

function siteFooterHtml(): string {
  return `<footer class="site-footer">
  <span class="site-footer-credit">
    <a href="/">${BRAND.name}</a> · ${BRAND.tagline}
  </span>
  <span class="site-footer-legal">
    <a href="/r/support?src=web-footer">Tip jar</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </span>
</footer>`;
}

export async function GET(req: Request, { params }: { params: Promise<{ sport: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { sport } = await params;
  if (sport !== "mlb" && sport !== "nba" && sport !== "wnba") {
    return NextResponse.json({ error: `unknown sport: ${sport}` }, { status: 404 });
  }

  const url = new URL(req.url);
  const surface: "web" | "email" = url.searchParams.get("surface") === "email" ? "email" : "web";

  // Load + render per sport. Both paths produce a { digestDate, digestPrettyDate,
  // webBody, emailBody } bundle so the email/web wrapping below is shared.
  let digestDate: string;
  let digestPrettyDate: string;
  let webBody: string;
  let emailBody: string;
  if (sport === "mlb") {
    const mode = asMlbMode(url.searchParams.get("mode"));
    const fixtureDate = MLB_PREVIEW_FIXTURES[mode];
    const data = await loadDailyData(fixtureDate);
    digestDate = data.date;
    digestPrettyDate = data.prettyDate;
    webBody = renderContent(data);
    emailBody = renderEmailContent(data);
  } else {
    const mode = asBasketballMode(url.searchParams.get("mode"));
    const fixtureDate = basketballFixtureDate(sport, mode);
    const data = sport === "nba"
      ? await loadNbaData(fixtureDate)
      : await loadWnbaData(fixtureDate);
    digestDate = data.date;
    digestPrettyDate = data.prettyDate;
    webBody = renderBasketballContent(data);
    emailBody = renderBasketballEmailContent(data);
  }

  let html: string;
  if (surface === "email") {
    html = dailyEmail({
      sport,
      digestDate,
      digestPrettyDate,
      digestUrl: "#",
      unsubscribeUrl: "#",
      digestEmailHtml: emailBody,
    }).html;
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
${webBody}
${siteFooterHtml()}
</div>
</body>
</html>`;
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

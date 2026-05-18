import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";
import { loadDailyData } from "@/lib/daily";
import { renderContent } from "@/lib/render";
import { renderEmailContent } from "@/lib/render-email";
import { dailyEmail } from "@/lib/emails/templates";
import { BRAND } from "@/lib/brand";
import type { DigestMode } from "@/lib/digest-mode";
import { MLB_PREVIEW_FIXTURES, MLB_PREVIEW_MODES } from "@/lib/mlb-preview-fixtures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (sessionToken && (await validateSession(sessionToken))) return true;
  const legacy = jar.get("boxscore_admin")?.value;
  const secret = process.env.ADMIN_SECRET;
  return Boolean(secret && legacy === secret);
}

function asMode(s: string | null): DigestMode {
  const valid = new Set<DigestMode>(MLB_PREVIEW_MODES);
  if (s && (valid as Set<string>).has(s)) return s as DigestMode;
  return "regular";
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
  const url = new URL(req.url);
  const mode = asMode(url.searchParams.get("mode"));
  const surface: "web" | "email" = url.searchParams.get("surface") === "email" ? "email" : "web";

  const fixtureDate = MLB_PREVIEW_FIXTURES[mode];
  const data = await loadDailyData(fixtureDate);

  let html: string;
  if (surface === "email") {
    html = dailyEmail({
      sport,
      digestDate: data.date,
      digestPrettyDate: data.prettyDate,
      digestUrl: "#",
      unsubscribeUrl: "#",
      digestEmailHtml: renderEmailContent(data),
    }).html;
  } else {
    const globalsCss = await readFile(join(process.cwd(), "app", "globals.css"), "utf-8");
    const iconUrl = "https://boxscore.email/icon.png";
    const webBody = renderContent(data);
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

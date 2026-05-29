import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BRAND } from "@/lib/brand";
import { PaperModeToggle } from "./PaperModeToggle";
import { PostHogPageview } from "./PostHogProvider";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";

export const metadata = {
  title: "boxscore",
  description: "Daily MLB digest. Sent every morning at 5am ET.",
  icons: {
    icon: "/background_icon.png",
    apple: "/background_icon.png",
  },
  // Auto-discovery for feed readers. Feedly / Inoreader / NetNewsWire pick this
  // up when a user pastes any boxscore.email URL — they read the <head>, find
  // the application/rss+xml alternate, and offer to subscribe.
  alternates: {
    types: {
      "application/rss+xml": [
        { title: "boxscore — MLB", url: "/rss/mlb" },
      ],
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="newspaper">
          <SiteHeader />
          {children}
          <SiteFooter />
        </div>
        <Analytics />
        <SpeedInsights />
        <Suspense fallback={null}>
          <PostHogPageview />
        </Suspense>
      </body>
    </html>
  );
}

async function SiteHeader() {
  // Read the session server-side so the right CTA renders on first paint —
  // signed-in users go straight to "⚙ Settings"; anonymous visitors see
  // "Subscribe →". Cost: every page is now dynamically rendered, which
  // drops the static cache on the digest pages. The DB query is one
  // session lookup per request, cheap at our traffic.
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  const isAuthed = !!session;
  return (
    <header className="site-header">
      <div className="brand">
        <a href="/">
          <img src="/icon.png" alt="" width={28} height={28} className="brand-icon" />
          <span>boxscore</span>
        </a>
      </div>
      <nav className="social">
        {BRAND.social.map((s) => (
          <a key={s.label} href={s.href}>{s.label}</a>
        ))}
      </nav>
      <div className="header-cta">
        <a className="support" href="/r/support?src=web-header" target="_blank" rel="noopener noreferrer">Tip Jar</a>
        {isAuthed ? (
          <a className="subscribe" href="/settings">
            <span className="auth-gear" aria-hidden="true">⚙</span> Settings
          </a>
        ) : (
          <a className="subscribe" href={BRAND.subscribeUrl}>Subscribe →</a>
        )}
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer-credit">
        <a href="/">{BRAND.name}</a> · {BRAND.tagline}
      </span>
      <span className="site-footer-legal">
        {BRAND.footerLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {link.label}
          </a>
        ))}
      </span>
      <Suspense fallback={null}>
        <PaperModeToggle />
      </Suspense>
    </footer>
  );
}

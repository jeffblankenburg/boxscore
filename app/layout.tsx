import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BRAND } from "@/lib/brand";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { PaperModeToggle } from "./PaperModeToggle";
import { PostHogPageview } from "./PostHogProvider";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { SOCIAL_ICON_BY_SLUG } from "./brand-icons";

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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Middleware sets `x-admin: 1` (admin shell) or `x-games: 1` (games
  // shell) on those requests so the public-site chrome (newspaper
  // wrapper, SiteHeader, SiteFooter) can step aside and the surface-
  // specific layout takes over the viewport.
  const h = await headers();
  const isAdmin = h.get("x-admin") === "1";
  const isGames = h.get("x-games") === "1";
  const bare = isAdmin || isGames;

  return (
    <html lang="en">
      <body>
        {bare ? (
          children
        ) : (
          <>
            <SiteSchema />
            <div className="newspaper">
              <SiteHeader />
              {children}
              <SiteFooter />
            </div>
          </>
        )}
        <Analytics />
        <SpeedInsights />
        <Suspense fallback={null}>
          <PostHogPageview />
        </Suspense>
      </body>
    </html>
  );
}

// JSON-LD on every public page. Two entities linked via @graph so Google
// and AI crawlers know the site's identity once (publisher of every
// digest, owner of the social profiles) without each page restating it.
function SiteSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${EMAIL_LINK_BASE}/#website`,
        url: EMAIL_LINK_BASE,
        name: BRAND.name,
        description: "Daily MLB box scores, standings, and stat leaders — sent as a morning email and archived on the web.",
        publisher: { "@id": `${EMAIL_LINK_BASE}/#org` },
      },
      {
        "@type": "Organization",
        "@id": `${EMAIL_LINK_BASE}/#org`,
        name: BRAND.name,
        url: EMAIL_LINK_BASE,
        logo: `${EMAIL_LINK_BASE}/icon.png`,
        sameAs: BRAND.social.map((s) => s.href),
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
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
      <nav className="social" aria-label="Social">
        {BRAND.social.map((s) => {
          const Icon = SOCIAL_ICON_BY_SLUG[s.slug];
          return (
            <a
              key={s.slug}
              href={s.href}
              className="social-icon"
              aria-label={s.label}
              target="_blank"
              rel="noopener noreferrer"
            >
              {Icon ? <Icon /> : s.label}
            </a>
          );
        })}
      </nav>
      <div className="header-cta">
        <a className="games-pill" href="/games">Games</a>
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

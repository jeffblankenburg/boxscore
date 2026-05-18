import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BRAND } from "@/lib/brand";
import { PaperModeToggle } from "./PaperModeToggle";
import { PostHogPageview } from "./PostHogProvider";

export const metadata = {
  title: "boxscore",
  description: "Daily MLB digest. Sent every morning at 5am ET.",
  icons: {
    icon: "/background_icon.png",
    apple: "/background_icon.png",
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

function SiteHeader() {
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
        <a className="support" href="/r/support?src=web-header" target="_blank" rel="noopener noreferrer">Support</a>
        <a className="subscribe" href={BRAND.subscribeUrl}>Subscribe →</a>
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
        <a href="/r/support?src=web-footer" target="_blank" rel="noopener noreferrer">Tip jar</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </span>
      <Suspense fallback={null}>
        <PaperModeToggle />
      </Suspense>
    </footer>
  );
}

import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { PaperModeToggle } from "./PaperModeToggle";

export const metadata = {
  title: "boxscore.email",
  description: "Daily MLB digest. Sent every morning at 5am ET.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
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
          <span>boxscore<span className="dot">.</span>email</span>
        </a>
      </div>
      <nav className="social">
        {BRAND.social.map((s) => (
          <a key={s.label} href={s.href}>{s.label}</a>
        ))}
      </nav>
      <a className="subscribe" href={BRAND.subscribeUrl}>Subscribe →</a>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span className="site-footer-credit">
        <a href="/">{BRAND.name}</a> · {BRAND.tagline}
      </span>
      <Suspense fallback={null}>
        <PaperModeToggle />
      </Suspense>
    </footer>
  );
}

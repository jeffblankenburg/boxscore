import "./globals.css";
import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: "boxscore.email",
  description: "Daily MLB digest. Sent every morning at 5am ET.",
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
        <a href="/">boxscore<span className="dot">.</span>email</a>
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
      <a href="/">{BRAND.name}</a> · {BRAND.tagline}
    </footer>
  );
}

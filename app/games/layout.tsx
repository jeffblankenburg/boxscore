import type { ReactNode } from "react";
import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { BRAND } from "@/lib/brand";
import { GamesSubBar } from "./games-sub-bar";
import "./games.css";

// Games surface chrome. Slim sticky brand bar at the top, app-style.
// No social links (per design direction). Tip Jar + Settings/Subscribe
// only. Children render directly below the bar — each game page is
// responsible for its own title / content layout.

export default async function GamesLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  const isAuthed = !!session;

  return (
    <div className="g-shell">
      <header className="g-bar">
        <a className="g-brand" href="/" aria-label="boxscore home">
          <img src="/icon.png" alt="" width={24} height={24} className="g-brand-icon" />
          <span className="g-brand-mark">
            boxscore
          </span>
        </a>
        <nav className="g-bar-nav">
          <a
            className="g-link g-link-tip"
            href="/r/support?src=games-header"
            target="_blank"
            rel="noopener noreferrer"
          >
            Tip Jar
          </a>
          {isAuthed ? (
            <a className="g-link g-link-cta" href="/settings">
              <span aria-hidden="true">⚙</span> Settings
            </a>
          ) : (
            <a className="g-link g-link-cta" href={BRAND.subscribeUrl}>
              Subscribe →
            </a>
          )}
        </nav>
      </header>
      <GamesSubBar />
      <main className="g-main">{children}</main>
    </div>
  );
}

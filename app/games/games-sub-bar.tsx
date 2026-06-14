"use client";

// Sub-bar sits directly below the chrome bar on every games page:
// "boxscore games" wordmark on the left, three game pills on the right.
// Active pill is highlighted so the user always sees where they are
// and can hop to a different game in one tap.
//
// Pure navigation — no completion status here. The /games landing
// cards carry per-game daily status.

import { usePathname } from "next/navigation";

// Linescordle pill omitted while the difficulty knob is in flux. The
// route still resolves for direct visitors — we just don't link to it.
// See #65 for the redesign options.
const PILLS: Array<{ slug: string; label: string; href: string }> = [
  { slug: "statsharks",   label: "Stat Sharks",   href: "/games/statsharks"   },
  { slug: "time-machine", label: "Time Machine",  href: "/games/time-machine" },
];

export function GamesSubBar() {
  const path = usePathname();
  return (
    <div className="g-sub-bar">
      <div className="g-sub-bar-inner">
        <a href="/games" className="g-sub-bar-mark">
          <span className="g-sub-bar-mark-lo">boxscore</span>
          <span className="g-sub-bar-mark-hi">games</span>
        </a>
        <nav className="g-sub-bar-pills" aria-label="Games">
          {PILLS.map((p) => {
            const active = path === p.href;
            return (
              <a
                key={p.slug}
                href={p.href}
                className={`g-sub-bar-pill${active ? " g-sub-bar-pill-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {p.label}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

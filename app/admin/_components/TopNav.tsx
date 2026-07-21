"use client";

// Full-width top navigation for the admin shell. Two zones:
//   • Leagues  — one tab per sport (registry-driven via the `sports` prop)
//   • Platform — the cross-sport areas from nav-config
// The active tab is derived from the pathname via resolveContext so it stays
// in sync with the contextual left nav (Sidebar).

import { usePathname } from "next/navigation";
import { PLATFORM_AREAS, resolveContext } from "./nav-config";
import type { SportLink } from "./Sidebar";

const SPORT_EMOJI: Record<string, string> = {
  mlb: "⚾", nba: "\u{1F3C0}", wnba: "\u{1F3C0}", nfl: "\u{1F3C8}", ncaaf: "\u{1F3C8}",
};

export function TopNav({ sports }: { sports: SportLink[] }) {
  const pathname = usePathname();
  const ctx = resolveContext(pathname, sports.map((s) => s.id));

  return (
    <nav className="a-topnav" aria-label="Primary">
      <div className="a-topnav-brand">
        boxscore <small>admin</small>
      </div>

      <div className="a-topnav-zone" aria-label="Leagues">
        {sports.map((s) => {
          const active = ctx.kind === "league" && ctx.id === s.id;
          return (
            <a
              key={s.id}
              href={`/admin/${s.id}`}
              className={`a-topnav-tab a-topnav-league-${s.id}${active ? " active" : ""}`}
            >
              <span aria-hidden="true">{SPORT_EMOJI[s.id] ?? "\u{1F3DF}"}</span>
              <span>{s.name}</span>
            </a>
          );
        })}
      </div>

      <div className="a-topnav-divider" aria-hidden="true" />

      <div className="a-topnav-zone" aria-label="Platform">
        {PLATFORM_AREAS.map((area) => {
          const active = ctx.kind === "platform" && ctx.id === area.id;
          return (
            <a
              key={area.id}
              href={area.href}
              className={`a-topnav-tab${active ? " active" : ""}`}
            >
              {area.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

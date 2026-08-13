// The one masthead generator for every league digest, web + email. Emits the
// sport-nav row + the dateline; each digest renderer calls this instead of its
// own bespoke dateline, so the four surfaces can't drift (they used to — the
// dateline edition-date bug came from four copies). The wordmark/utility band
// above it stays in the email shell (lib/emails/templates.ts) and SiteHeader
// (app/layout.tsx) because its links are per-recipient and resolved at send
// time; this generator owns everything from the sport nav down.
//
// `date` is the games date; the edition date (games + 1) is computed HERE, so
// the newspaper "+1" convention lives in exactly one place.

import { nextDay, prettyDate } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import type { Sport } from "@/lib/sports";

export type NavSport = { id: string; label: string };

// Display order + short labels for the nav. Fixed for now (MLB|NFL|NCAAF|NBA|
// WNBA); a future in-season-first sort can replace the ordering in
// mastheadNavSports without touching the generator. Sports not listed (soccer,
// golf, …) fall to the end in registry order. Labels are abbreviations because
// the registry `name` ("College Football") is too wide for a nav row.
const NAV_ORDER = ["mlb", "nfl", "ncaaf", "nba", "wnba", "nhl"];
const NAV_LABEL: Record<string, string> = {
  mlb: "MLB", nfl: "NFL", ncaaf: "NCAAF", nba: "NBA", wnba: "WNBA", nhl: "NHL",
};

/** Order + label the public sports for the masthead nav. Caller passes the
 *  result of getVisibleSports() so visibility (and future sports) flow through. */
export function mastheadNavSports(sports: Sport[]): NavSport[] {
  const rank = (id: string) => {
    const i = NAV_ORDER.indexOf(id);
    return i === -1 ? NAV_ORDER.length : i;
  };
  return [...sports]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((s) => ({ id: s.id, label: NAV_LABEL[s.id] ?? s.id.toUpperCase() }));
}

function webNav(navSports: NavSport[], current: string): string {
  if (navSports.length === 0) return "";
  const links = navSports
    .map((s) => {
      const cls = s.id === current ? "masthead-nav-link is-current" : "masthead-nav-link";
      return `<a class="${cls}" href="/${s.id}">${s.label}</a>`;
    })
    .join("");
  return `<nav class="masthead-nav" aria-label="Sports">${links}</nav>`;
}

function emailNav(navSports: NavSport[], current: string): string {
  if (navSports.length === 0) return "";
  const links = navSports
    .map((s) => {
      const weight = s.id === current ? "800" : "400";
      return `<a href="${EMAIL_LINK_BASE}/${s.id}" style="display:inline-block;margin:0 6px;text-decoration:none;color:#161410;font-weight:${weight};font-size:13px;letter-spacing:0.04em;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;">${s.label}</a>`;
    })
    .join("");
  return `<div style="text-align:center;padding:0 0 3px;line-height:1;">${links}</div>`;
}

/**
 * The masthead: sport nav (current sport bold, links undecorated) above the
 * edition-date dateline. Web uses globals.css classes; email is fully
 * inline-styled for client robustness.
 */
export function renderMasthead(opts: {
  date: string;                 // games date; edition date computed internally
  sport: string;                // current sport — bolded in the nav
  surface: "web" | "email";
  navSports?: NavSport[];       // omitted/empty → dateline only, no nav
}): string {
  const pretty = prettyDate(nextDay(opts.date));
  const nav = opts.navSports ?? [];
  if (opts.surface === "web") {
    return `${webNav(nav, opts.sport)}
<div class="dateline"><div class="dateline-row"><span class="dateline-text">${pretty}</span></div></div>`;
  }
  return `${emailNav(nav, opts.sport)}
<div style="border-top:3px double #161410;border-bottom:1px solid #161410;padding:8px 0;margin:0 0 14px;text-align:center;"><div style="font-style:italic;font-weight:800;letter-spacing:-0.005em;font-size:22px;font-size:clamp(16px,4.2vw,24px);">${pretty}</div></div>`;
}

// Link helpers for NBA/WNBA digests + player pages. Parallels football's
// lib/sports/football/player-links.ts and MLB's lib/player-links.ts.
//
// Player pages carry the ESPN athlete id IN the URL slug —
// /{league}/player/{name-slug}-{espnId} — so the route is self-decoding (strip
// the trailing -digits back to the id, no DB lookup). Team links point at the
// team's digest page /{league}/{slug}.
//
// The basketball renderer emits ONE body for both web and email, so every link
// takes a `web` flag: web → relative href + the shared unstyled `team-link` /
// `player-link` classes (globals.css); email → absolute href + inline
// color:inherit for mail-client resilience.

import { EMAIL_LINK_BASE } from "./site";
import { teamsBySport, type Sport } from "./teams";

export type BasketballLeague = "nba" | "wnba";

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Recover the ESPN athlete id from a URL segment — trailing -digits of a
// `name-slug-12345`, or a bare numeric id. Null when the segment carries none.
export function decodeAthleteId(segment: string): string | null {
  if (/^\d+$/.test(segment)) return segment;
  const m = segment.match(/-(\d+)$/);
  return m ? m[1]! : null;
}

export function basketballPlayerPath(
  league: BasketballLeague,
  ref: { id: string; slug?: string | null },
): string {
  const slug = ref.slug ? `${ref.slug}-${ref.id}` : ref.id;
  return `/${league}/player/${slug}`;
}

// Last name = everything after the first token, so "Gilgeous-Alexander" and
// "Van Vleet" stay intact. Mirrors initialLast/lastName in the renderers.
export function lastNameOf(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : full;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
export function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// web: relative href + class; email: absolute href + inline styles (mail
// clients strip <style> unreliably, so the inline color:inherit is the belt).
export function linkAnchor(
  path: string,
  text: string,
  web: boolean,
  webClass: string,
  emailClass: string,
): string {
  const href = web ? path : `${EMAIL_LINK_BASE}${path}`;
  return web
    ? `<a class="${webClass}" href="${escAttr(href)}">${escText(text)}</a>`
    : `<a class="${emailClass}" href="${escAttr(href)}" style="color:inherit;text-decoration:none">${escText(text)}</a>`;
}

export function playerLink(
  league: BasketballLeague,
  ref: { id: string; slug?: string | null },
  text: string,
  web: boolean,
): string {
  return linkAnchor(basketballPlayerPath(league, ref), text, web, "player-link", "es-player-link");
}

// ESPN exposes a team's nickname ("Knicks") on scoreboard/standings entries,
// which matches teams.ts `nickname` — but NOT the abbreviation ("NY" vs
// "NYK"). Resolve the boxscore slug by nickname and link to the team page;
// fall back to plain (escaped) text when there's no match.
export function teamLinkByNickname(
  league: BasketballLeague,
  nickname: string,
  text: string,
  web: boolean,
): string {
  const team = teamsBySport(league as Sport).find((t) => t.nickname === nickname);
  if (!team) return escText(text);
  return linkAnchor(`/${league}/${team.slug}`, text, web, "team-link", "es-team-link");
}

// Boxscore team slug for an ESPN team, matched by full name or nickname.
export function teamSlugForEspn(
  league: BasketballLeague,
  espn: { displayName?: string | null; nickname?: string | null },
): string | null {
  const team = teamsBySport(league as Sport).find(
    (t) => t.name === espn.displayName || t.nickname === espn.nickname,
  );
  return team?.slug ?? null;
}

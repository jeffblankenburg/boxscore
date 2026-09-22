// Link helpers for NHL digests + player pages. NHL-only port of
// lib/basketball-links.ts. Player pages carry the ESPN athlete id in the URL
// slug — /nhl/player/{name-slug}-{espnId} — so the route is self-decoding.
// Team links point at the team's digest page /nhl/{slug}.

import { EMAIL_LINK_BASE } from "./site";
import { teamsBySport } from "./teams";

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function decodeAthleteId(segment: string): string | null {
  if (/^\d+$/.test(segment)) return segment;
  const m = segment.match(/-(\d+)$/);
  return m ? m[1]! : null;
}

export function hockeyPlayerPath(ref: { id: string; slug?: string | null }): string {
  const slug = ref.slug ? `${ref.slug}-${ref.id}` : ref.id;
  return `/nhl/player/${slug}`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
export function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function linkAnchor(
  path: string, text: string, web: boolean, webClass: string, emailClass: string,
): string {
  const href = web ? path : `${EMAIL_LINK_BASE}${path}`;
  return web
    ? `<a class="${webClass}" href="${escAttr(href)}">${escText(text)}</a>`
    : `<a class="${emailClass}" href="${escAttr(href)}" style="color:inherit;text-decoration:none">${escText(text)}</a>`;
}

export function playerLink(ref: { id: string; slug?: string | null }, text: string, web: boolean): string {
  return linkAnchor(hockeyPlayerPath(ref), text, web, "player-link", "es-player-link");
}

// ESPN exposes a team's nickname ("Senators") on scoreboard/standings entries,
// which matches teams.ts `nickname` — resolve the team page slug by nickname.
export function teamLinkByNickname(nickname: string, text: string, web: boolean): string {
  const team = teamsBySport("nhl").find((t) => t.nickname === nickname);
  if (!team) return escText(text);
  return linkAnchor(`/nhl/${team.slug}`, text, web, "team-link", "es-team-link");
}

// Team page slug for an ESPN team, matched by full name or nickname. Used by the
// cron to decide which teams played (→ which team digests to write).
export function teamSlugForEspn(espn: { displayName?: string | null; nickname?: string | null }): string | null {
  const team = teamsBySport("nhl").find(
    (t) => t.name === espn.displayName || t.nickname === espn.nickname,
  );
  return team?.slug ?? null;
}

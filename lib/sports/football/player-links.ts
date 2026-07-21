// Player-page link helpers for football. Parallels lib/player-links.ts (MLB),
// but football has no players table yet, so the athlete id is carried IN the
// URL slug: /{league}/player/{name-slug}-{espnId} (e.g.
// /nfl/player/josh-allen-3918298). The id suffix makes the slug self-decoding
// — the route strips the trailing -digits back to the ESPN id with no DB
// lookup — while the name prefix keeps the URL readable and SEO-friendly.
//
// A bare numeric segment (/nfl/player/3918298) is also accepted for links
// emitted before a name was known.

import type { FootballLeague } from "./types";
import type { FootballPlayerRef } from "./types";

/** Build the canonical path for a player. */
export function footballPlayerPath(
  league: FootballLeague,
  ref: Pick<FootballPlayerRef, "id" | "slug">,
): string {
  const slug = ref.slug ? `${ref.slug}-${ref.id}` : ref.id;
  return `/${league}/player/${slug}`;
}

/** Recover the ESPN athlete id from a URL segment — either the trailing
 *  numeric suffix of a `name-slug-12345` form, or a bare numeric id. Returns
 *  null when the segment carries no id. */
export function decodeAthleteId(segment: string): string | null {
  if (/^\d+$/.test(segment)) return segment;
  const m = segment.match(/-(\d+)$/);
  return m ? m[1]! : null;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Last name = everything after the first token, so compound surnames
 *  ("St. Brown", "Van Ginkel") stay intact. Mirrors lastNameOf in the
 *  digest renderer. */
export function lastNameOf(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : full;
}

/** Web anchor to a player page, wrapping the given visible text. */
export function playerLinkWeb(
  league: FootballLeague,
  ref: Pick<FootballPlayerRef, "id" | "slug">,
  text: string,
): string {
  return `<a class="player-link" href="${escapeAttr(footballPlayerPath(league, ref))}">${escapeText(text)}</a>`;
}

/** Last-name web link — the box-score / leader-table variant. */
export function lastNameLinkWeb(league: FootballLeague, ref: FootballPlayerRef): string {
  return playerLinkWeb(league, ref, lastNameOf(ref.fullName));
}

/** Full-name web link. */
export function fullNameLinkWeb(league: FootballLeague, ref: FootballPlayerRef): string {
  return playerLinkWeb(league, ref, ref.fullName);
}

import { EMAIL_LINK_BASE } from "./site";
import { lastName } from "./names";

// Wraps a player's display name in a link to /mlb/player/{slug}. Shared
// across the MLB web and email renderers. Slug is the canonical
// name_slug from the players table (e.g. "aaron-judge"), resolved at
// the adapter boundary.
//
// Falls back to plain text when no id/slug is in the person object —
// defensive only; production adapters always populate the slug (with a
// "unknown-{vendor}-{id}" placeholder when the lookup misses).

// PersonRef accepts string OR number for id during the slug rollout.
// Number = legacy DailyData numeric mlb_id; string = canonical name_slug.
// The /mlb/player/[id] route handler resolves both to the same player.
type PersonRef = {
  id?: string | number | null;
  fullName?: string | null;
};

const slugOf = (p: PersonRef): string | null =>
  p.id == null ? null : String(p.id);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;")
   .replace(/'/g, "&#39;");

export function lastNameLinkWeb(p: PersonRef): string {
  const text = esc(lastName(p.fullName ?? ""));
  const slug = slugOf(p);
  return slug
    ? `<a class="player-link" href="/mlb/player/${encodeURIComponent(slug)}">${text}</a>`
    : text;
}

// Email variant: absolute URL + inline color/decoration overrides since
// many mail clients strip <style> blocks and the underline default reads
// wrong against the digest's text-forward aesthetic.
export function lastNameLinkEmail(p: PersonRef): string {
  const text = esc(lastName(p.fullName ?? ""));
  const slug = slugOf(p);
  return slug
    ? `<a class="es-player-link" href="${EMAIL_LINK_BASE}/mlb/player/${encodeURIComponent(slug)}" style="color:inherit;text-decoration:none">${text}</a>`
    : text;
}

// Full-name variants — used where we show the whole name (e.g. All-Star
// rosters) rather than just the last name.
export function fullNameLinkWeb(p: PersonRef): string {
  const text = esc(p.fullName ?? "");
  const slug = slugOf(p);
  return slug
    ? `<a class="player-link" href="/mlb/player/${encodeURIComponent(slug)}">${text}</a>`
    : text;
}
export function fullNameLinkEmail(p: PersonRef): string {
  const text = esc(p.fullName ?? "");
  const slug = slugOf(p);
  return slug
    ? `<a class="es-player-link" href="${EMAIL_LINK_BASE}/mlb/player/${encodeURIComponent(slug)}" style="color:inherit;text-decoration:none">${text}</a>`
    : text;
}

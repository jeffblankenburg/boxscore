import { EMAIL_LINK_BASE } from "./site";
import { lastName } from "./names";

// Wraps a player's display name in a link to /mlb/player/{id}. Shared
// across the MLB web and email renderers — same DOM shape as the team
// link, just for players. Falls back to plain text when no id is in the
// person object (defensive — statsapi always returns one for batters,
// pitchers, decisions, and leaders).

type PersonRef = {
  id?: number | null;
  personId?: number | null;
  fullName?: string | null;
};

const idOf = (p: PersonRef): number | null => p.personId ?? p.id ?? null;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;")
   .replace(/'/g, "&#39;");

export function lastNameLinkWeb(p: PersonRef): string {
  const text = esc(lastName(p.fullName ?? ""));
  const id = idOf(p);
  return id
    ? `<a class="player-link" href="/mlb/player/${id}">${text}</a>`
    : text;
}

// Email variant carries inline styles because many clients strip <style>
// blocks. Absolute URL because relative links break when the email is
// rendered outside the site origin (Gmail web, Apple Mail offline cache).
// Hover-underline is intentionally web-only; most email clients don't
// honour :hover anyway.
export function lastNameLinkEmail(p: PersonRef): string {
  const text = esc(lastName(p.fullName ?? ""));
  const id = idOf(p);
  return id
    ? `<a class="es-player-link" href="${EMAIL_LINK_BASE}/mlb/player/${id}" style="color:inherit;text-decoration:none">${text}</a>`
    : text;
}

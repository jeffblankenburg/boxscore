// Shared formatting helpers for standings clinch indicators + magic numbers.
// Kept renderer-agnostic (pure string/data in, string/data out) so the web
// (render.ts), email (render-email.ts), and team surfaces all present the same
// letters, the same September-onward magic-number gate, and the same wild-card
// elimination filter. All inputs come straight from the statsapi standings
// feed; nothing here is computed from primitives.

import type { TeamRecord } from "./mlb";

// MLB's agate clinch letters, verified against 2025 season-end standings
// (statsapi clinchIndicator). Ordered most- to least-significant for the key.
export const CLINCH_LETTERS = ["z", "y", "x", "w"] as const;
export const CLINCH_LABELS: Record<string, string> = {
  z: "clinched best record",
  y: "clinched division",
  x: "clinched playoff berth",
  w: "clinched wild card",
};

// Magic numbers only surface from September on. Before that a division
// leader's MN is ~140 and meaningless noise; the feed still returns it, so we
// gate on the edition date (YYYY-MM-DD). Jeff's call, 2026-08-23.
export function showMagicNumbers(date: string): boolean {
  return Number(date.slice(5, 7)) >= 9;
}

// The magic number to display for a team, or null. Only the division leader
// carries one; once clinched the feed returns "-" (suppressed here — the
// clinch letter already conveys it).
export function magicFor(t: TeamRecord): string | null {
  const mn = t.magicNumber;
  return mn && mn !== "-" ? mn : null;
}

// The clinch letter for a team, or null when it hasn't clinched (or the feed
// returned an unrecognized value).
export function clinchLetter(t: TeamRecord): string | null {
  const c = t.clinchIndicator;
  return c && CLINCH_LABELS[c] ? c : null;
}

// A team is out of the wild-card race when the feed marks its WC elimination
// number "E". Used to drop dead teams from the wild-card standings.
export function eliminatedFromWildCard(t: TeamRecord): boolean {
  return t.wildCardEliminationNumber === "E";
}

// Prefix a team name with its clinch letter, agate-style ("y-Rays"). Returns
// the name unchanged when the team hasn't clinched. The caller decides where
// the letter sits relative to any team-link markup.
export function withClinchPrefix(name: string, t: TeamRecord): string {
  const c = clinchLetter(t);
  return c ? `${c}-${name}` : name;
}

// Build a "very brief key" listing only the clinch letters that actually
// appear in the rendered standings, in significance order. Empty string when
// nothing has clinched yet (early/mid season), so the legend stays hidden.
export function clinchKeyLine(present: Iterable<string>): string {
  const set = new Set(present);
  const parts = CLINCH_LETTERS.filter((l) => set.has(l)).map(
    (l) => `${l} = ${CLINCH_LABELS[l]}`,
  );
  return parts.join(", ");
}

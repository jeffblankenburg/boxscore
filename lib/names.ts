// Player-name display helpers. Shared between the web renderer
// (lib/render.ts) and the email renderer (lib/render-email.ts) so a name
// rule changes in one place, not two.

// Extracts the surname for display in box scores, leaders tables,
// pitching-decisions lines, etc. The MLB statsapi returns players as
// `{ fullName: "First Last" }` in most endpoints (schedule decisions,
// probable pitchers), so we operate on the fullName string rather than
// pulling separate name fields. Box-score endpoints do return a separate
// `lastName` field, but threading that through every call site would
// duplicate this logic — keeping the regex centralized is the cheaper
// solution and it has to exist for the fullName-only paths anyway.
//
// Rules (matched to MLB.com's own box-score conventions):
//   1. Strip Roman-numeral suffixes ("II", "III", "IV") off the end.
//      MLB does NOT strip generational suffixes ("Jr.", "Sr.") — those stay
//      attached to the surname ("Guerrero Jr.", "Tatis Jr.") to disambiguate
//      from the same-named parent.
//   2. After identifying the last word as the surname head, walk backward
//      while the previous word is a known particle (Spanish "de", "de la",
//      "del"; Dutch "van", "van der"; French "le", "du"; honorific "St.")
//      and include each particle as part of the surname.
//
// Examples (all verified):
//   "Mike Trout"              → "Trout"
//   "Vladimir Guerrero Jr."   → "Guerrero Jr."
//   "Cedric Mullins II"       → "Mullins"
//   "Elly De La Cruz"         → "De La Cruz"
//   "Bryan De La Cruz"        → "De La Cruz"
//   "Jose De Leon"            → "De Leon"
//   "Tomas Della Rocca"       → "Della Rocca"
//   "Andrew Van Slyke"        → "Van Slyke"
//   "Brandon St. Pierre"      → "St. Pierre"
//   "Hyun Jin Ryu"            → "Ryu"   (multi-word given name, no particle)
//
// Particle list is intentionally conservative — only the prefixes we've seen
// in active rosters. Adding a new one (e.g., a player named "Da Silva")
// means adding one entry to PARTICLES below and re-rendering affected digests.

// Suffixes that get stripped from the display (MLB convention drops these).
const STRIPPED_SUFFIXES = new Set(["II", "III", "IV"]);

// Suffixes that get walked past to find the surname head, then re-appended
// to the output (MLB keeps these — "Guerrero Jr." not "Guerrero").
const KEPT_SUFFIXES = new Set(["Jr.", "Jr", "Sr.", "Sr"]);

const PARTICLES = new Set([
  // Spanish / Portuguese
  "de", "del", "della", "da", "dal", "di",
  // Dutch / German
  "van", "von", "der",
  // French + Spanish
  "la", "los", "las", "le", "du",
  // Honorific (kept lowercase here; check is case-insensitive)
  "saint", "st.",
]);

export function lastName(full: string): string {
  if (!full) return full;
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return full;

  // Step 1: walk past trailing suffixes to find the surname head. Remember
  // any KEPT suffixes so we can re-attach them at the end.
  let end = parts.length - 1;
  const trailingKept: string[] = [];
  while (end > 0) {
    const word = parts[end] ?? "";
    if (STRIPPED_SUFFIXES.has(word)) { end--; continue; }
    if (KEPT_SUFFIXES.has(word)) { trailingKept.unshift(word); end--; continue; }
    break;
  }

  // Step 2: walk backward from the surname head, accumulating particles
  // ("de", "la", "van", etc.) into the surname.
  let start = end;
  while (start > 0 && PARTICLES.has((parts[start - 1] ?? "").toLowerCase())) {
    start--;
  }

  // Safety: if start hit 0 the input had no first-name word
  // (e.g., just "De La Cruz" with no first name) — collapse to the head
  // alone rather than consuming the whole string.
  if (start === 0) start = end;

  const surname = parts.slice(start, end + 1).join(" ");
  return trailingKept.length > 0
    ? `${surname} ${trailingKept.join(" ")}`
    : surname;
}

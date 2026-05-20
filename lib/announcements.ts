import { supabaseAdmin } from "./supabase";

// Per-day announcement banners. Read by the send crons (league + team) and
// prepended above the digest body when present for the day being sent.
//
// Scope: rows are keyed on (sport, date). A row with sport='*' is a global
// banner that applies to every sport's send on that date. Sport-specific
// rows take precedence — if both exist for a given (sport, date), the
// sport-specific one wins. This lets an operator post one cross-sport note
// (a launch announcement, e.g.) while still being able to override it for a
// single sport when needed.
//
// Authoring: the stored string is a tiny markdown-lite — newlines become
// <br>, plus four inline conventions:
//   **bold**            → <strong>
//   *italic*            → <em>
//   __underline__       → <u>
//   [text](https://...) → black-underlined <a>
// Raw HTML passes through untouched so an admin can still drop in custom
// markup when they need it. The format function is applied at READ time
// (sends + previews); the admin form's textarea always shows the raw
// authored string so editing round-trips cleanly.

export const GLOBAL_ANNOUNCEMENT_SPORT = "*";

function formatAnnouncement(raw: string): string {
  let s = raw;
  // Order matters: doubles before singles so `**bold**` isn't mis-parsed
  // as `*italic*` containing a stray asterisk.
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<u>$1</u>");
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "<em>$1</em>");
  // Links inherit the surrounding text color (black-ish) and keep the
  // default underline — per request, no blue.
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color:inherit;">$1</a>',
  );
  // Author-typed newlines become <br>. Raw HTML tags spanning multiple
  // lines (rare) get a stray <br> inside — harmless.
  s = s.replace(/\n/g, "<br>");
  return s;
}

/**
 * Best-effort lookup for the send crons + previews. Returns the formatted
 * HTML (markdown applied, newlines converted) ready to drop into the email
 * shell. Sport-specific wins over global; null if neither exists.
 */
export async function getAnnouncement(
  sport: string,
  date: string,
): Promise<string | null> {
  const [specific, global] = await Promise.all([
    getSpecificAnnouncement(sport, date),
    getSpecificAnnouncement(GLOBAL_ANNOUNCEMENT_SPORT, date),
  ]);
  const raw = specific ?? global ?? null;
  return raw === null ? null : formatAnnouncement(raw);
}

/**
 * Exact-row lookup — no fallback. Used by the admin UI so the operator can
 * see what's set for each scope independently (sport-specific vs global).
 */
export async function getSpecificAnnouncement(
  sport: string,
  date: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("announcements")
    .select("html")
    .eq("sport", sport)
    .eq("date", date)
    .maybeSingle<{ html: string }>();
  if (error) throw new Error(`getSpecificAnnouncement: ${error.message}`);
  return data?.html ?? null;
}

export async function upsertAnnouncement(args: {
  sport: string;
  date: string;
  html: string;
}): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("announcements")
    .upsert(
      {
        sport: args.sport,
        date: args.date,
        html: args.html,
      },
      { onConflict: "sport,date" },
    );
  if (error) throw new Error(`upsertAnnouncement: ${error.message}`);
}

export async function deleteAnnouncement(
  sport: string,
  date: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("announcements")
    .delete()
    .eq("sport", sport)
    .eq("date", date);
  if (error) throw new Error(`deleteAnnouncement: ${error.message}`);
}

/**
 * Every announcement for this sport plus every global announcement. Used
 * by the admin page to show a list of what's set — without it, an admin
 * who saves an announcement for a future date can't easily verify it
 * landed (the form's textarea is keyed on the date input, which defaults
 * to yesterday). Returns raw text (no markdown conversion); the list UI
 * truncates + strips HTML for the preview.
 */
export type AnnouncementListItem = {
  sport: string;
  date: string;
  html: string;
  created_at: string;
};

export async function listAnnouncements(
  sport: string,
): Promise<AnnouncementListItem[]> {
  const { data, error } = await supabaseAdmin()
    .from("announcements")
    .select("sport, date, html, created_at")
    .in("sport", [sport, GLOBAL_ANNOUNCEMENT_SPORT])
    .order("date", { ascending: true });
  if (error) throw new Error(`listAnnouncements: ${error.message}`);
  return (data ?? []) as AnnouncementListItem[];
}

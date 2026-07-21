import { notFound } from "next/navigation";
import { getDigest } from "@/lib/digests";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, nextDay, prettyDate } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { BRAND } from "@/lib/brand";
import { isSportVisible } from "@/lib/sports";
import { requireAdmin } from "../../require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email preview · admin · boxscore", robots: { index: false } };

export default async function AdminEmailPreview({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ sport?: string }>;
}) {
  await requireAdmin();
  const { date } = await params;
  if (!isValidIsoDate(date)) notFound();
  // Sport-aware: the per-sport dashboard passes ?sport=. Defaults to mlb for
  // backward compat (old bookmarks / the plain /admin/email/{date} link).
  const { sport: sportParam } = await searchParams;
  const sport = sportParam && (await isSportVisible(sportParam, { includeAdminOnly: true })) ? sportParam : "mlb";

  const digest = await getDigest(sport, date);
  if (!digest || !digest.email_html) {
    return (
      <main className="admin">
        <h1>Email preview · {sport} · {date}</h1>
        <p>No <code>email_html</code> stored for {sport} on this date.</p>
      </main>
    );
  }

  const { getAnnouncement } = await import("@/lib/announcements");
  const announcementBanner = (await getAnnouncement(sport, date)) ?? undefined;
  const { html } = dailyEmail({
    sport,
    digestDate: date,
    digestPrettyDate: prettyDate(date),
    digestUrl: `${EMAIL_LINK_BASE}/${sport}/${nextDay(date)}`,
    unsubscribeUrl: `${EMAIL_LINK_BASE}/u/admin-preview`,
    manageUrl: `${EMAIL_LINK_BASE}/settings`,
    gamesUrl: `${EMAIL_LINK_BASE}/games`,
    tipJarUrl: BRAND.tipJarUrl,
    announcementBanner,
    digestEmailHtml: digest.email_html,
  });

  return (
    <main className="admin">
      <h1>Email preview · {prettyDate(date)}</h1>
      <p className="admin-meta">
        {(html.length / 1024).toFixed(1)} KB · isolated in iframe so the
        email's styles don't bleed into admin chrome.
      </p>
      <iframe
        srcDoc={html}
        className="admin-email-frame"
        title={`Email preview for ${date}`}
      />
    </main>
  );
}

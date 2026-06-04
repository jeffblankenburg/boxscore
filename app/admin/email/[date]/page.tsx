import { notFound } from "next/navigation";
import { getDigest } from "@/lib/digests";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, nextDay, prettyDate } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { requireAdmin } from "../../require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email preview · admin · boxscore", robots: { index: false } };

export default async function AdminEmailPreview({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  await requireAdmin();
  const { date } = await params;
  if (!isValidIsoDate(date)) notFound();

  const digest = await getDigest("mlb", date);
  if (!digest || !digest.email_html) {
    return (
      <main className="admin">
        <h1>Email preview · {date}</h1>
        <p>No <code>email_html</code> stored for this date.</p>
      </main>
    );
  }

  const { getAnnouncement } = await import("@/lib/announcements");
  const announcementBanner = (await getAnnouncement("mlb", date)) ?? undefined;
  const { html } = dailyEmail({
    sport: "mlb",
    digestDate: date,
    digestPrettyDate: prettyDate(date),
    digestUrl: `${EMAIL_LINK_BASE}/mlb/${nextDay(date)}`,
    unsubscribeUrl: `${EMAIL_LINK_BASE}/u/admin-preview`,
    manageUrl: `${EMAIL_LINK_BASE}/settings`,
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

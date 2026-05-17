import { notFound } from "next/navigation";
import { getDigest } from "@/lib/digests";
import { dailyEmail } from "@/lib/emails/templates";
import { isValidIsoDate, prettyDate } from "@/lib/dates";
import { siteOrigin } from "@/lib/site";
import { requireAdmin } from "../../require-admin";
import { AdminNav } from "../../AdminNav";

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
        <AdminNav />
        <h1>Email preview · {date}</h1>
        <p>No <code>email_html</code> stored for this date.</p>
      </main>
    );
  }

  const origin = await siteOrigin();
  const { html } = dailyEmail({
    digestPrettyDate: prettyDate(date),
    digestUrl: `${origin}/mlb/${date}`,
    unsubscribeUrl: `${origin}/u/admin-preview`,
    digestEmailHtml: digest.email_html,
  });

  return (
    <main className="admin">
      <AdminNav />
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

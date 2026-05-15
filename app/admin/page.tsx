import { yesterdayInET, prettyDate } from "@/lib/dates";
import { getDigest } from "@/lib/digests";
import { supabaseAdmin } from "@/lib/supabase";
import { SubmitButton } from "./SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · boxscore.email", robots: { index: false } };

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const date = yesterdayInET();
  const pretty = prettyDate(date);
  const digest = await getDigest("mlb", date);
  const { ok, error } = await searchParams;

  // Quick status counts
  const { count: subscriberCount } = await supabaseAdmin()
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  const { count: sendsToday } = await supabaseAdmin()
    .from("sends")
    .select("id", { count: "exact", head: true })
    .eq("digest_date", date)
    .is("error", null);

  const { count: socialPostsToday } = await supabaseAdmin()
    .from("social_posts")
    .select("id", { count: "exact", head: true })
    .eq("date", date)
    .is("error", null);

  return (
    <main className="admin">
      <h1>Admin</h1>

      {ok && (
        <p className="admin-success"><strong>✓</strong> {ok}</p>
      )}
      {error && (
        <p className="admin-error"><strong>Failed:</strong> {error}</p>
      )}

      <section>
        <h2>Status</h2>
        <ul className="admin-stats">
          <li><strong>Latest digest:</strong> {digest ? `${pretty} · ${digest.game_count} games · ${(digest.html.length / 1024).toFixed(0)} KB web / ${digest.email_html ? (digest.email_html.length / 1024).toFixed(0) + " KB email" : "no email_html"}` : "(none for yesterday)"}</li>
          <li><strong>Active subscribers:</strong> {subscriberCount ?? 0}</li>
          <li><strong>Emails sent today:</strong> {sendsToday ?? 0}</li>
          <li><strong>Social posts today:</strong> {socialPostsToday ?? 0}</li>
        </ul>
      </section>

      <section>
        <h2>Web</h2>
        <p>
          <a href={`/mlb/${date}`} target="_blank" rel="noreferrer">
            View /mlb/{date}
          </a>
          {" · "}
          <a href="/mlb" target="_blank" rel="noreferrer">/mlb</a>
        </p>
      </section>

      <section>
        <h2>Email</h2>
        <p>
          <a href={`/admin/email/${date}`} target="_blank" rel="noreferrer">
            Preview today's email (in browser)
          </a>
        </p>
        <SendEmailForm date={date} />
      </section>

      <section>
        <h2>Share images</h2>
        <p>
          <a href="/admin/images">View share images (and regenerate)</a>
        </p>
      </section>

      <section>
        <h2>Twitter compose</h2>
        <p>
          <a href="/admin/twitter">Copy posts to clipboard for manual Twitter posting</a>
        </p>
      </section>
    </main>
  );
}

function SendEmailForm({ date }: { date: string }) {
  return (
    <form action={async () => {
      "use server";
      const { sendAdminPreview } = await import("./actions");
      await sendAdminPreview(date);
    }}>
      <SubmitButton
        idleLabel="Send today's email to me"
        pendingLabel="Sending…"
      />
    </form>
  );
}

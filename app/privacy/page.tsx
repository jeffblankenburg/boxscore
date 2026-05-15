export const metadata = {
  title: "Privacy — boxscore.email",
  description: "How boxscore.email handles your data.",
};

const UPDATED = "May 15, 2026";

export default function PrivacyPage() {
  return (
    <article className="legal-page">
      <h1>Privacy</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <h2>What we collect</h2>
      <p>
        Your email address — that&apos;s it. We don&apos;t ask for a name, we don&apos;t
        track your activity on the site, and we don&apos;t set advertising cookies.
      </p>

      <h2>How we use it</h2>
      <p>
        Your email is used for one purpose: to send you the daily digest at 5am ET.
        We may also send the occasional service notice (e.g. confirming your
        subscription, or letting you know if the service is changing).
      </p>

      <h2>Where it lives</h2>
      <p>
        Your email is stored in a Supabase database (Postgres) and passed to
        Resend, our email delivery provider, each morning to send the digest.
        These are the only third parties that handle your address. We don&apos;t
        sell, rent, share, or trade it with anyone else.
      </p>

      <h2>Unsubscribing</h2>
      <p>
        Every email includes a one-click unsubscribe link and a List-Unsubscribe
        header. Either removes your address from the list immediately. We do not
        retain unsubscribed addresses for any purpose.
      </p>

      <h2>Logs</h2>
      <p>
        Our hosting provider (Vercel) keeps standard request logs (IP address,
        path, status code) for a short period for operational and security
        purposes. We don&apos;t use these logs to profile you or build any
        long-term record tied to your identity.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about your data, or want it deleted? Reply to any digest email
        and we&apos;ll handle it.
      </p>
    </article>
  );
}

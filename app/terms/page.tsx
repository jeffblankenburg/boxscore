export const metadata = {
  title: "Terms — boxscore",
  description: "Terms of service for boxscore.",
};

const UPDATED = "May 15, 2026";

export default function TermsPage() {
  return (
    <article className="legal-page">
      <h1>Terms &amp; conditions</h1>
      <p className="legal-updated">Last updated {UPDATED}</p>

      <h2>The deal</h2>
      <p>
        boxscore is a free daily newsletter that summarizes the previous
        day&apos;s Major League Baseball games. You give us an email address; we
        send you the digest each morning. You can stop receiving it at any time
        by clicking the unsubscribe link in any email.
      </p>

      <h2>No warranty</h2>
      <p>
        The service is provided &quot;as is.&quot; We make a good-faith effort to
        deliver the digest every morning, but we don&apos;t guarantee uptime,
        delivery, or the accuracy of any stat. Scores and stats come from MLB&apos;s
        public Stats API and reflect the data available at the time we render
        each morning; late corrections by official scorers won&apos;t be retroactively
        applied to past digests.
      </p>

      <h2>Not affiliated with MLB</h2>
      <p>
        boxscore is an independent project. It is not affiliated with,
        endorsed by, or sponsored by Major League Baseball, any MLB club, or any
        of their licensees. All team names, marks, and logos are the property of
        their respective owners and used here only for informational reference.
      </p>

      <h2>Your conduct</h2>
      <p>
        Don&apos;t subscribe email addresses you don&apos;t control. Don&apos;t
        scrape the site or attempt to disrupt it. If we detect abuse, we may
        block addresses or IPs at our discretion.
      </p>

      <h2>Changes</h2>
      <p>
        We may change these terms, the service, or shut it down at any time. If
        a change materially affects subscribers, we&apos;ll note it in a digest.
      </p>

      <h2>Liability</h2>
      <p>
        To the maximum extent allowed by law, we&apos;re not liable for any
        indirect, incidental, or consequential damages arising from your use of
        the service.
      </p>
    </article>
  );
}

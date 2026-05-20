export const metadata = {
  title: "Check your inbox — boxscore",
};

export default async function SubscribeSentPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const isSignin = mode === "signin";

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Check your inbox</h1>
      {isSignin ? (
        <p className="subscribe-lede">
          That address is already subscribed — so we sent you a sign-in link
          instead, from <strong>digest@boxscore.email</strong>. Click it to
          jump to your subscription settings. The link is good for 15 minutes
          and only works once.
        </p>
      ) : (
        <p className="subscribe-lede">
          We just sent a confirmation email from{" "}
          <strong>digest@boxscore.email</strong>. Click the link inside and
          you&rsquo;re in. The link is good for 30 days.
        </p>
      )}

      <h2 className="subscribe-subhead">Didn&rsquo;t see it?</h2>
      <ul className="subscribe-checklist">
        <li>
          <strong>Wait a minute or two.</strong> Most mail providers deliver
          instantly, but a few (especially Apple iCloud and corporate
          inboxes) hold new senders for a short delay.
        </li>
        <li>
          <strong>Check your Promotions tab</strong> if you use Gmail.
          Confirmation emails from new senders frequently land there
          instead of the main inbox.
        </li>
        <li>
          <strong>Check Spam or Junk.</strong> If you find it there, please
          mark it as &ldquo;Not Spam&rdquo; — it teaches your provider that
          this address is wanted, and helps future subscribers too.
        </li>
        <li>
          <strong>Work or school email?</strong> Your IT team may quarantine
          mail from new senders before it reaches you. Try a personal
          address (Gmail, iCloud, Outlook.com) instead.
        </li>
        <li>
          <strong>Check for typos.</strong> Common ones we&rsquo;ve seen:{" "}
          <code>gmial.com</code>, <code>gamil.com</code>,{" "}
          <code>yahooo.com</code>, <code>outlok.com</code>. If your
          address had one, the email bounced — just{" "}
          <a href="/subscribe">subscribe again</a> with the correct
          address.
        </li>
      </ul>

      <p className="subscribe-fine">
        Still not finding it after 10 minutes?{" "}
        <a href="/subscribe">Try again</a> — or reach out via one of the
        social links in the footer and we&rsquo;ll help sort it out.
      </p>
    </section>
  );
}

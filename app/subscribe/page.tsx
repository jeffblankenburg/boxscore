import { subscribe } from "./actions";

export const metadata = {
  title: "Subscribe — boxscore",
  description: "Daily MLB digest in your inbox, 5am ET.",
};

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Subscribe to the MLB digest</h1>
      <p className="subscribe-lede">
        Like the sports pages we used to read every day. Black & white. Standings, full box scores, league leaders — sent to your inbox every morning at <b>5am ET</b>.
      </p>
      <form action={subscribe} className="subscribe-form" noValidate>
        <input
          type="email"
          name="email"
          required
          placeholder="you@yourdomain.com"
          autoComplete="email"
          className="subscribe-input"
          aria-label="Email address"
        />
        <button type="submit" className="subscribe-button">
          Subscribe →
        </button>
      </form>
      {error === "invalid_email" && (
        <p className="subscribe-error">Please enter a valid email address.</p>
      )}
      <p className="subscribe-fine">
        We'll send one confirmation email. After you click the link,
        you're in. Unsubscribe in one click, any time.
      </p>
    </section>
  );
}

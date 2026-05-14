export const metadata = {
  title: "Check your inbox — boxscore.email",
};

export default function SubscribeSentPage() {
  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Check your inbox</h1>
      <p className="subscribe-lede">
        We just sent you a confirmation email. Click the link in it and
        you're in.
      </p>
      <p className="subscribe-fine">
        Didn't get it within a minute or two? Check spam, then{" "}
        <a href="/subscribe">try again</a>.
      </p>
    </section>
  );
}

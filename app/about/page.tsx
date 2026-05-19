export const metadata = {
  title: "About — boxscore",
  description:
    "boxscore is a daily MLB email digest — yesterday's scores, standings, and box scores, delivered every morning. Independent, free, supported by tips.",
};

export default function AboutPage() {
  return (
    <article className="legal-page">
      <h1>About boxscore</h1>

      <p>
        I remember scouring the sports page every morning with my Honey Nut
        Cheerios until my fingertips were covered in ink. The standings. The
        box scores from the night before. The agate type from the West Coast
        games that ran too late for the deadline. Everything you needed to
        know about yesterday, before you started today.
      </p>

      <p>
        That paper is mostly gone now. The information is everywhere and
        nowhere — buried in apps, fragmented across feeds, interrupted by
        notifications you didn&apos;t ask for. The morning ritual went with
        it.
      </p>

      <p>boxscore is my attempt to bring it back.</p>

      <h2>What it is</h2>
      <p>
        A daily email digest. Yesterday&apos;s scores, standings, league
        leaders, and full box scores — delivered every morning before you
        need them. No ads in the email, no clickbait, no video. Just the
        data, arranged so you can read it the way you used to read the paper.
      </p>

      <h2>Who runs it</h2>
      <p>
        Hi, I&apos;m Jeff Blankenburg. I&apos;ve been writing software for a
        long time, and I built boxscore because nobody else was making it
        exactly the way I remember the morning paper feeling. More about me
        at{" "}
        <a
          href="https://jeffblankenburg.info"
          target="_blank"
          rel="noopener noreferrer"
        >
          jeffblankenburg.info
        </a>
        .
      </p>

      <h2>How it&apos;s funded</h2>
      <p>
        boxscore is free. There are no subscriptions or paid tiers. If you
        find it useful and want to chip in toward keeping it running, there
        is a{" "}
        <a href="/r/support?src=about-page" target="_blank" rel="noopener noreferrer">
          tip jar
        </a>
        . Tips are voluntary, are not tied to your subscription, and are
        non-refundable. The email is exactly the same whether you tip or
        not, but your support helps keep this project running.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, bug reports, or just want to say hi:{" "}
        <a href="mailto:hello@boxscore.email">hello@boxscore.email</a>.
      </p>

      <h2>Not affiliated with MLB</h2>
      <p>
        boxscore is an independent project. It is not affiliated with,
        endorsed by, or sponsored by Major League Baseball, any MLB club, or
        any of their licensees. All team names, marks, and logos are the
        property of their respective owners and used here only for
        informational reference.
      </p>

      <h2>Fine print</h2>
      <p>
        The <a href="/terms">Terms</a> and{" "}
        <a href="/privacy">Privacy policy</a> cover the rest.
      </p>
    </article>
  );
}

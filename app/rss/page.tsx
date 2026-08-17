import type { Metadata } from "next";
import { getVisibleSports } from "@/lib/sports";
import { BRAND } from "@/lib/brand";

// Human-facing RSS chooser. Lists a feed for every publicly-launched sport;
// the per-sport feeds themselves are served by app/rss/[sport]/route.ts. Kept
// dynamic so a newly-launched sport appears here without a redeploy (the
// sports registry visibility is DB-backed).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RSS feeds — boxscore",
  description:
    "Follow boxscore in any feed reader. Each sport has its own RSS feed with the full daily digest — scores, standings, leaders, and box scores.",
};

export default async function RssIndexPage() {
  const sports = await getVisibleSports();
  const host = BRAND.domain;

  return (
    <article className="legal-page">
      <h1>RSS feeds</h1>

      <p>
        Prefer a feed reader to email? Every sport boxscore covers has its own
        RSS feed. Each item is a full daily edition — yesterday&apos;s scores,
        standings, league leaders, and box scores — embedded the same way it
        arrives in the newsletter, so your reader shows the whole page, not just
        a headline and a link.
      </p>

      <p>
        Paste any of these URLs into Feedly, Inoreader, NetNewsWire, or whatever
        you use. New editions post each morning, shortly after the email goes
        out.
      </p>

      <ul className="rss-feed-list">
        {sports.map((s) => (
          <li key={s.id}>
            <a href={`/rss/${s.id}`}>
              <strong>{s.name}</strong>{" "}
              <code>
                {host}/rss/{s.id}
              </code>
            </a>
          </li>
        ))}
      </ul>

      <p>
        Most readers also auto-detect these: open any{" "}
        <a href={`https://${host}`}>{host}</a> sport page in your reader and it
        will offer that sport&apos;s feed automatically.
      </p>
    </article>
  );
}

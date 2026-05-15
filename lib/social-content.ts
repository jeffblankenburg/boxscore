// Per-platform post content generators. Kept platform-agnostic where possible
// so adding BlueSky/Facebook later reuses the same shape.

export type DailyPostContext = {
  sport: string;        // "mlb"
  date: string;         // "2026-05-14"
  prettyDate: string;   // "Wednesday, May 14, 2026"
  gameCount: number;
  digestUrl: string;    // canonical URL on boxscore.email
};

const SPORT_LABEL: Record<string, string> = { mlb: "MLB" };

function dailyPostBody(ctx: DailyPostContext): string {
  const sport = SPORT_LABEL[ctx.sport] ?? ctx.sport.toUpperCase();
  return `⚾ ${sport} box scores · ${ctx.prettyDate} · ${ctx.gameCount} games

${ctx.digestUrl}`;
}

// Twitter and BlueSky use the same body for now. If we ever need
// platform-specific tweaks (different limits, hashtag conventions, etc.),
// they diverge here.
export function tweetText(ctx: DailyPostContext): string {
  return dailyPostBody(ctx);
}

export function blueskyText(ctx: DailyPostContext): string {
  return dailyPostBody(ctx);
}

// Per-image post content used by both the BlueSky cron (auto) and the admin
// Twitter compose page (manual paste). Same wording across platforms.
import type { ManifestEntry } from "./render-images";

const hashtag = (team: string): string => "#" + team.replace(/\s+/g, "");

export function imagePostContent(
  entry: ManifestEntry,
  prettyDate: string,
  digestUrl: string,
): { text: string; alt: string } {
  if (entry.type === "standings") {
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Standings · ${prettyDate}\n\n#MLB ${digestUrl}`,
      alt: `${name} Standings for ${prettyDate}.`,
    };
  }
  if (entry.type === "leaders") {
    const name = entry.league === "AL" ? "American League" : "National League";
    return {
      text: `${name} Leaders · ${prettyDate}\n\n#MLB ${digestUrl}`,
      alt: `${name} Leaders as of ${prettyDate}.`,
    };
  }
  const tags = entry.teams
    .filter((t) => t.length > 0)
    .map(hashtag)
    .join(" ");
  return {
    text: `${entry.title} · ${prettyDate}\n\n${tags} #MLB ${digestUrl}`.trim(),
    alt: `Box score: ${entry.title} on ${prettyDate}.`,
  };
}

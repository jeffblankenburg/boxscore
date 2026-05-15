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

export function tweetText(ctx: DailyPostContext): string {
  const sport = SPORT_LABEL[ctx.sport] ?? ctx.sport.toUpperCase();
  return `⚾ ${sport} box scores · ${ctx.prettyDate} · ${ctx.gameCount} games

${ctx.digestUrl}`;
}

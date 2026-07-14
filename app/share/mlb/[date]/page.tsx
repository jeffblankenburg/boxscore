import { notFound } from "next/navigation";
import { loadDailyData } from "@/lib/daily";
import { isValidIsoDate, prettyDate, prevDay } from "@/lib/dates";
import { ScoreboardImage, type ScoreTile } from "@/lib/scoreboard-image";

// The 1200×630 canvas that Puppeteer screenshots for the day's share image.
// URL date is the EDITION date (matches /mlb/[date] convention) and games
// are the previous day's. Not intended for human visitors — the og:image
// route serves the rendered PNG; this template is just the input.
//
// Chrome (site header/footer + .newspaper wrapper) is stripped via the
// .share-image-canvas :has() rule in globals.css so Puppeteer captures a
// clean 1200×630 viewport with nothing surrounding it.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Share image",
  robots: { index: false, follow: false },
};

export default async function ShareImageRoute({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date: editionDate } = await params;
  if (!isValidIsoDate(editionDate)) notFound();

  const gamesDate = prevDay(editionDate);
  const data = await loadDailyData(gamesDate);

  // Only completed games with both scores recorded. Anything in progress,
  // postponed, or suspended gets dropped — the scoreboard image is a
  // morning recap.
  const scores: ScoreTile[] = data.games
    .filter((g) =>
      g.game.status.abstractGameState === "Final"
      && typeof g.game.teams.away.score === "number"
      && typeof g.game.teams.home.score === "number"
    )
    .map((g) => ({
      away: tlaFor(data.teamAbbrev, g.game.teams.away.team),
      home: tlaFor(data.teamAbbrev, g.game.teams.home.team),
      aR: g.game.teams.away.score!,
      hR: g.game.teams.home.score!,
    }));

  return (
    <div className="share-image-canvas">
      {/* Image is dated by the GAMES date (what the scoreboard actually
          shows), not the edition date (which is what the URL uses). Standalone
          shares — screenshots, downloads, social posts — should describe the
          content, not the publication. */}
      <ScoreboardImage scores={scores} date={prettyDate(gamesDate)} />
    </div>
  );
}

// Live id→abbreviation map (from /v1/teams at fetch time) is the authoritative
// source; fall back to the schedule envelope's `abbreviation` field, then to
// the team name's first three uppercase letters as a last resort.
function tlaFor(
  map: Record<string, string>,
  team: { id: number; name: string; abbreviation?: string },
): string {
  // All-Star teams (159 AL / 160 NL) aren't in the 30-team abbrev map and
  // carry no abbreviation — resolve them to "AL"/"NL" so the ASG scoreboard
  // tile doesn't fall back to the "AME"/"NAT" name-slice.
  if (team.id === 159) return "AL";
  if (team.id === 160) return "NL";
  const fromMap = map[String(team.id)];
  if (fromMap) return fromMap;
  if (team.abbreviation) return team.abbreviation.toUpperCase();
  return team.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

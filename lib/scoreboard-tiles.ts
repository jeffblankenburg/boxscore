// Per-sport adapter: a day's completed games → ScoreTile[] for the scoreboard
// share image. Each sport has its own data loader + game shape; this collapses
// them to the away/home abbreviation + score pairs the ScoreboardImage renders.
// Used by the generic /share/[sport]/[date] share page.

import type { ScoreTile } from "./scoreboard-image";
import { prevDay } from "./dates";

// MLB team id → abbreviation resolution, mirroring the original share page.
function mlbTla(
  map: Record<string, string>,
  team: { id: number; name: string; abbreviation?: string },
): string {
  if (team.id === 159) return "AL";
  if (team.id === 160) return "NL";
  return (
    map[String(team.id)] ??
    team.abbreviation?.toUpperCase() ??
    team.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()
  );
}

// NCAAF fans out into a Top 25 board plus one per conference (the natural model
// from the digests) rather than one 100-game grid. `ncaafScope`: undefined/"top25"
// → games involving an AP-ranked team; a conference slug → that conference's games.
export async function scoreTilesForSport(
  sport: string,
  gamesDate: string,
  opts?: { ncaafScope?: string },
): Promise<ScoreTile[]> {
  if (sport === "mlb") {
    const { loadDailyData } = await import("./daily");
    const data = await loadDailyData(gamesDate);
    return data.games
      .filter(
        (g) =>
          g.game.status.abstractGameState === "Final" &&
          typeof g.game.teams.away.score === "number" &&
          typeof g.game.teams.home.score === "number",
      )
      .map((g) => ({
        away: mlbTla(data.teamAbbrev, g.game.teams.away.team),
        home: mlbTla(data.teamAbbrev, g.game.teams.home.team),
        aR: g.game.teams.away.score!,
        hR: g.game.teams.home.score!,
      }));
  }

  if (sport === "nba" || sport === "wnba") {
    const { loadNbaData } = await import("./nba");
    const { loadWnbaData } = await import("./wnba");
    const data = sport === "nba" ? await loadNbaData(gamesDate) : await loadWnbaData(gamesDate);
    return data.games
      .map((g) => g.event)
      .filter((e) => e.status === "final" && e.away.score != null && e.home.score != null)
      .map((e) => ({
        away: e.away.team.abbreviation,
        home: e.home.team.abbreviation,
        aR: e.away.score!,
        hR: e.home.score!,
      }));
  }

  if (sport === "nfl" || sport === "ncaaf") {
    const { loadFootballData } = await import("./sports/football/data");
    const data = await loadFootballData(sport, gamesDate);
    let games = data.games;
    // Rank by team id from the primary poll (AP → CFP → Coaches). Used to
    // supplement the scoreboard's per-game curatedRank, which can be missing on
    // some games — a team should still count/show as ranked if the poll lists it.
    const rk = data.rankings;
    const poll =
      rk.find((r) => /AP Top 25/i.test(r.poll)) ??
      rk.find((r) => /CFP|College Football Playoff/i.test(r.poll)) ??
      rk.find((r) => /Coaches/i.test(r.poll)) ??
      rk[0];
    const pollRank = new Map<string, number>();
    for (const e of poll?.entries ?? []) pollRank.set(e.team.id, e.rank);
    const rankOf = (ref: { id: string; rank?: number | null }): number | undefined =>
      ref.rank ?? pollRank.get(ref.id) ?? undefined;

    if (sport === "ncaaf") {
      const scope = opts?.ncaafScope;
      if (scope && scope !== "top25") {
        const { findConferenceBySlug, scopeToConference } = await import("./sports/football/conferences");
        const conf = findConferenceBySlug(scope);
        games = conf ? scopeToConference(data, conf).games : [];
      } else {
        // Top 25: any game with a ranked team, by curatedRank OR the poll.
        games = games.filter((g) => rankOf(g.awayTeam) != null || rankOf(g.homeTeam) != null);
      }
    }
    return games
      .filter((g) => g.status === "final" && g.awayScore != null && g.homeScore != null)
      .map((g) => ({
        away: g.awayTeam.abbr,
        home: g.homeTeam.abbr,
        aR: g.awayScore!,
        hR: g.homeScore!,
        aRank: sport === "ncaaf" ? rankOf(g.awayTeam) : undefined,
        hRank: sport === "ncaaf" ? rankOf(g.homeTeam) : undefined,
      }));
  }

  return [];
}

// The scoreboard is stamped with the GAMES date; the URL carries the EDITION
// date (games + 1), matching the /[sport]/[date] convention.
export function scoreboardGamesDate(editionDate: string): string {
  return prevDay(editionDate);
}

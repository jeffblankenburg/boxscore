// Composes the home page "complete edition": every sport that played YESTERDAY,
// its box scores, split into explicit newspaper columns server-side. Each column
// is topped with a league header (a league continuing into the next column shows
// its header again), so the first game of every column lands on the same line
// and you always know which league you're reading. Reuses the exact box-score
// renderers the emails use; reads the already-cached daily_raw per sport (no new
// data, no cron). Cached 300s in prod, bypassed in dev.
import { getVisibleSports } from "@/lib/sports";
import { mastheadNavSports } from "@/lib/masthead";
import { yesterdayInET } from "@/lib/dates";
import { cachedRead } from "@/lib/data-cache";

import { loadDailyRaw } from "@/lib/daily";
import { adaptStatsapiDailyRaw } from "@/lib/sports/mlb/adapters/from-statsapi";
import { getCanonicalPlayerLookup } from "@/lib/canonical-players";
import { renderMlbGames } from "@/lib/sports/mlb/render/web";
import { loadNbaData } from "@/lib/nba";
import { loadWnbaData } from "@/lib/wnba";
import { loadNcaamData } from "@/lib/ncaam";
import { loadNcaawData } from "@/lib/ncaaw";
import { renderBasketballGames } from "@/lib/render-basketball";
import { loadFootballData } from "@/lib/sports/football/data";
import { renderFootballGames } from "@/lib/sports/football/render/digest";
import { loadNhlData } from "@/lib/nhl";
import { renderHockeyGames } from "@/lib/render-hockey";

const IN_SEASON_DAYS = 5;

// One cell = a single game's box score, tagged with its league so the page can
// drop a league header when the league changes. The page flows these into a CSS
// multi-column container that balances by height and reflows 3/2/1 by width, so
// there's no server-side column split or height estimation to do here.
export type HomeCell = { html: string; leagueId: string; leagueName: string };

async function renderSportGames(sportId: string, date: string): Promise<string[]> {
  switch (sportId) {
    case "mlb": {
      const raw = await loadDailyRaw(date);
      await getCanonicalPlayerLookup();
      return renderMlbGames(adaptStatsapiDailyRaw(date, raw));
    }
    case "nba": return renderBasketballGames(await loadNbaData(date), true, "nba");
    case "wnba": return renderBasketballGames(await loadWnbaData(date), true, "wnba");
    case "ncaam": return renderBasketballGames(await loadNcaamData(date), true, "ncaam");
    case "ncaaw": return renderBasketballGames(await loadNcaawData(date), true, "ncaaw");
    case "nfl": return renderFootballGames(await loadFootballData("nfl", date), true);
    case "ncaaf": return renderFootballGames(await loadFootballData("ncaaf", date), true);
    case "nhl": return renderHockeyGames(await loadNhlData(date), true);
    default: return [];
  }
}

async function build(): Promise<HomeCell[]> {
  const sports = await getVisibleSports();
  const date = yesterdayInET();
  const navOrder = mastheadNavSports(sports).map((s) => s.id);
  const rank = (id: string) => {
    const i = navOrder.indexOf(id);
    return i === -1 ? navOrder.length : i;
  };

  const perSport = await Promise.all(
    [...sports].sort((a, b) => rank(a.id) - rank(b.id)).map(async (sport) => {
      try {
        return { sport, blocks: await renderSportGames(sport.id, date) };
      } catch (err) {
        console.error(`[home-edition] ${sport.id} failed: ${(err as Error).message}`);
        return { sport, blocks: [] as string[] };
      }
    }),
  );

  const cells: HomeCell[] = [];
  for (const { sport, blocks } of perSport) {
    for (const html of blocks) {
      cells.push({ html, leagueId: sport.id, leagueName: sport.name });
    }
  }
  return cells;
}

export function buildHomeEdition(): Promise<HomeCell[]> {
  // Skip the cache in dev so renderer/CSS edits show immediately.
  if (process.env.NODE_ENV === "development") return build();
  return cachedRead(build, ["home-edition"], 300);
}

// Composes the home page "complete edition": every sport that played YESTERDAY,
// its box scores flowed into one cross-sport masonry (so a light slate like a
// lone World Series game doesn't leave whitespace — the next sport packs in).
// Each sport opens with a linked header (→ /[sport]). Reuses the exact box-score
// renderers the emails use; reads the already-cached daily_raw per sport (no new
// data, no cron). Wrapped in a short cached read so the render runs once per
// interval, not per visitor.
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

// One cell in the grid: a single game's box score. The first game of each sport
// also carries the sport header (→ /[sport]), so headers ride inline with the
// games as the cells flow left-to-right, top-to-bottom.
export type HomeCell = { html: string; header?: { id: string; name: string } };

// Load the sport's data for `date` (cached daily_raw) and render each game's box
// score. Empty array when the sport didn't play that day.
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
        const blocks = await renderSportGames(sport.id, date);
        return { sport, blocks };
      } catch (err) {
        console.error(`[home-edition] ${sport.id} failed: ${(err as Error).message}`);
        return { sport, blocks: [] as string[] };
      }
    }),
  );

  const cells: HomeCell[] = [];
  for (const { sport, blocks } of perSport) {
    if (blocks.length === 0) continue; // didn't play yesterday → no header, no gap
    blocks.forEach((html, idx) => {
      cells.push(idx === 0 ? { html, header: { id: sport.id, name: sport.name } } : { html });
    });
  }
  return cells;
}

export function buildHomeEdition(): Promise<HomeCell[]> {
  // Skip the cache in dev so renderer/CSS edits show immediately.
  if (process.env.NODE_ENV === "development") return build();
  return cachedRead(build, ["home-edition"], 300);
}

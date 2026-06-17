// Orchestrates a single-day SDIO pull for the canonical preview tool.
// Hits every endpoint the SDIO canonical adapter needs in parallel, and
// returns the bundle as one object that gets stored as the `payload`
// column of daily_raw_sdio. The renderer never sees this shape — it
// passes through the from-sdio adapter to canonical types first.
//
// Endpoint inventory (verified on the production key 2026-06-05):
//
//   /scores/json/GamesByDateFinal/{date}  — completed games for a date
//   /scores/json/GamesByDate/{nextDay}    — tomorrow's slate (scheduled,
//                                           used by the "Today's Games"
//                                           preview section)
//   /stats/json/BoxScoresFinal/{date}     — box scores for that date's games
//   /pbp/json/PlayByPlayFinal/{gameId}    — one call per completed game;
//                                           we derive scoring plays from
//                                           the run-delta between plays
//   /scores/json/Standings/{season}       — full standings as of yesterday
//   /stats/json/PlayerSeasonStats/{season}— season-to-date player stats
//                                           (we derive leaders in adapter)
//   /scores/json/TransactionsByDate/{date}— roster moves on that date
//   /scores/json/teams                    — id ↔ abbreviation map
//   /projections/json/StartingLineupsByDate/{date}
//                                         — pre-game starting lineup card
//                                           per game. Each player's Position
//                                           here is their STARTING position
//                                           (DH/LF/3B/etc); combined with the
//                                           PlayerGame.Position from the box
//                                           score (final position) it lets
//                                           the adapter build authoritative
//                                           starter position chains for the
//                                           box-score "all positions" column.

import { sdioGet, isoToSdioDate } from "./sdio-client";
import { nextDay } from "@/lib/dates";

export type SdioDailyPayload = {
  games:        unknown;
  nextDayGames: unknown;
  boxScores:    unknown;
  // Keyed by SDIO GameID (as a stringified key — JSON object keys are
  // always strings). One PlayByPlayFinal envelope per completed game.
  playByPlay:   Record<string, unknown>;
  standings:    unknown;
  playerStats:  unknown;
  transactions: unknown;
  teams:        unknown;
  // Starting-lineup envelopes per game (array; one per game on the date).
  // Each envelope carries HomeBattingLineup / AwayBattingLineup — both are
  // starter-only. Used by the box adapter to seed each starter's lineup-
  // card position; the box's PlayerGame.Position contributes the final
  // position so we can render multi-position chains like "DH-C".
  startingLineups: unknown;
  // Full player roster snapshot. ~7K rows; carries each player's Status
  // ("60-Day Injured List" / "Active" / etc), InjuryStatus, InjuryBodyPart,
  // and InjuryStartDate. Used by the transaction adapter to synthesize
  // IL placements as transactions on the day they occur (SDIO's
  // TransactionsByDate endpoint doesn't surface IL movements; statsapi
  // does, so the canonical transactions list needs this to draw level).
  players: unknown;
};

// Pull GameID off the schedule envelope so the PBP fan-out knows what
// to ask for. The schedule shape is loose here — we only need GameID.
function gameIdsFromSchedule(raw: unknown): number[] {
  const games = (raw as Array<{ GameID?: number }> | null) ?? [];
  return games
    .map((g) => g.GameID)
    .filter((id): id is number => typeof id === "number");
}

export async function fetchSdioDaily(date: string): Promise<SdioDailyPayload> {
  const season = Number(date.slice(0, 4));
  if (!season || season < 2000) throw new Error(`fetchSdioDaily: bad season from date ${date}`);
  const d  = isoToSdioDate(date);
  const dn = isoToSdioDate(nextDay(date));

  // First wave: the seven non-PBP endpoints in parallel. PBP fans out
  // per-game so we need the schedule first to know how many games.
  // GamesByDate (next-day, scheduled) sits on a different SDIO tier than
  // the "Final" feeds and may 401 on accounts that haven't enabled the
  // Schedules add-on. Catch that locally so a missing schedules endpoint
  // doesn't tank the whole pull — the canonical preview's "Today's Games"
  // section will render empty, which is a visible degradation in the
  // side-by-side and exactly the thing the validation surface is for.
  const [games, nextDayGames, boxScores, standings, playerStats, transactions, teams, startingLineups, players] = await Promise.all([
    sdioGet(`/scores/json/GamesByDateFinal/${d}`),
    sdioGet(`/scores/json/GamesByDate/${dn}`).catch((e) => {
      console.warn(`fetchSdioDaily: nextDayGames(${dn}) failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }),
    sdioGet(`/stats/json/BoxScoresFinal/${d}`),
    sdioGet(`/scores/json/Standings/${season}`),
    sdioGet(`/stats/json/PlayerSeasonStats/${season}`),
    sdioGet(`/scores/json/TransactionsByDate/${d}`),
    sdioGet(`/scores/json/teams`),
    // Starting-lineup endpoint lives under /projections (it's a pre-game
    // projection until first pitch, then becomes the confirmed card).
    // Tier-401 catch in case a key doesn't have projections access — the
    // box renderer degrades to single-position display rather than
    // failing the whole pull.
    sdioGet(`/projections/json/StartingLineupsByDate/${d}`).catch((e) => {
      console.warn(`fetchSdioDaily: startingLineups(${d}) failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }),
    // Full player roster snapshot — carries IL status + InjuryStartDate
    // for every player. ~7K rows × ~3KB = 20MB; significant but only
    // pulled once daily. Same tier as the other /scores feeds.
    sdioGet(`/scores/json/Players`).catch((e) => {
      console.warn(`fetchSdioDaily: players failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }),
  ]);

  // Second wave: one PlayByPlayFinal per completed game. ~15 games on
  // a typical day; running them in parallel against SDIO is fine, and
  // we keep individual errors local (one busted game shouldn't tank
  // the whole pull). Stored keyed by GameID for adapter lookup.
  const ids = gameIdsFromSchedule(games);
  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await sdioGet(`/pbp/json/PlayByPlayFinal/${id}`)] as const;
      } catch (e) {
        console.warn(`fetchSdioDaily: PBP ${id} failed: ${e instanceof Error ? e.message : e}`);
        return [id, null] as const;
      }
    }),
  );
  const playByPlay: Record<string, unknown> = {};
  for (const [id, pbp] of results) if (pbp != null) playByPlay[String(id)] = pbp;

  return { games, nextDayGames, boxScores, playByPlay, standings, playerStats, transactions, teams, startingLineups, players };
}

// Data-loading wrapper around the fantasy projection module. Both the
// /mlb/fantasy page (live render) and the snapshot cron call this so
// they can never drift on which inputs go into the model.
//
// The shape mirrors lib/sports/mlb/predictions-data.ts.

import { supabaseAdmin } from "@/lib/supabase";
import { getSlate, type SlateGame } from "@/lib/mlb";
import { prevDay } from "@/lib/dates";
import { getCanonicalPlayerLookup } from "@/lib/canonical-players";
import {
  projectFantasySlate,
  type FantasyProjections,
  type HitterSeasonInput,
  type PitcherSeasonInput,
  type PlayerProfileInput,
} from "./fantasy";

// Stable version string. Bump when the model formula in fantasy.ts
// changes so historical snapshots stay attributable.
export const FANTASY_MODEL_VERSION = "v1-rates-slot-matchup";

type YesterdayBoxTeam = {
  team?: { id?: number; abbreviation?: string };
  battingOrder?: number[];
};
type YesterdayBoxscore = {
  teams?: { away?: YesterdayBoxTeam; home?: YesterdayBoxTeam };
};
type YesterdayGames = Record<string, { boxscore?: YesterdayBoxscore }>;

export type LoadedFantasy = {
  projections: FantasyProjections;
  /** Map from mlb_id (the key used inside projections) → internal players.id.
   *  Snapshots store both so calibration can join on either. */
  mlbToInternalId: Map<number, number>;
};

export async function loadFantasyForDate(date: string): Promise<LoadedFantasy> {
  const season = Number(date.slice(0, 4));
  const sb = supabaseAdmin();

  let slate: SlateGame[] = [];
  try {
    slate = await getSlate(date);
  } catch {
    slate = [];
  }
  const spMlbIds = new Set<number>();
  for (const g of slate) {
    if (g.away.probablePitcher) spMlbIds.add(g.away.probablePitcher.id);
    if (g.home.probablePitcher) spMlbIds.add(g.home.probablePitcher.id);
  }

  // Yesterday's daily_raw — per-team starting nine as the probable-lineup
  // fallback when today's lineup isn't posted yet.
  const { data: yRows } = await sb
    .from("daily_raw")
    .select("payload")
    .eq("sport", "mlb")
    .eq("date", prevDay(date))
    .limit(1);
  const probableHittersByTeamAbbr = new Map<string, number[]>();
  const yRow = yRows?.[0];
  if (yRow) {
    const games = ((yRow.payload as { games?: YesterdayGames })?.games) ?? {};
    for (const g of Object.values(games)) {
      const teams = g.boxscore?.teams;
      for (const side of [teams?.away, teams?.home] as Array<YesterdayBoxTeam | undefined>) {
        if (!side) continue;
        const abbr = side.team?.abbreviation?.toUpperCase();
        const ids = (side.battingOrder ?? []).filter((n) => typeof n === "number");
        if (abbr && ids.length > 0) probableHittersByTeamAbbr.set(abbr, ids);
      }
    }
  }

  // Confirmed lineup mlb_ids from today's slate take precedence.
  const confirmedHittersByTeamAbbr = new Map<string, number[]>();
  for (const g of slate) {
    if (g.away.lineupConfirmed) confirmedHittersByTeamAbbr.set(g.away.abbr.toUpperCase(), g.away.lineup.map((l) => l.playerId));
    if (g.home.lineupConfirmed) confirmedHittersByTeamAbbr.set(g.home.abbr.toUpperCase(), g.home.lineup.map((l) => l.playerId));
  }

  const hitterMlbIds = new Set<number>();
  const rosterMlbByAbbr = new Map<string, number[]>();
  for (const abbr of new Set([
    ...probableHittersByTeamAbbr.keys(),
    ...confirmedHittersByTeamAbbr.keys(),
  ])) {
    const ids = confirmedHittersByTeamAbbr.get(abbr) ?? probableHittersByTeamAbbr.get(abbr) ?? [];
    rosterMlbByAbbr.set(abbr, ids);
    for (const id of ids) hitterMlbIds.add(id);
  }
  const allMlbIds = new Set<number>([...hitterMlbIds, ...spMlbIds]);

  const lookup = await getCanonicalPlayerLookup();
  const internalToMlb = new Map<number, number>();
  const mlbToInternal = new Map<number, number>();
  for (const mlbId of allMlbIds) {
    const rec = lookup.byMlbId.get(mlbId);
    if (!rec) continue;
    mlbToInternal.set(mlbId, rec.internalId);
    internalToMlb.set(rec.internalId, mlbId);
  }
  const allInternalIds = [...internalToMlb.keys()];

  const seasonRowCols =
    "player_id, primary_position, team_abbr, pa, ab, h, doubles, triples, hr, rbi, r, sb, bb_bat, avg, obp, slg, ops, games_played, ip, k, w, era, whip, bb_pitch, hr_allowed";
  const { data: seasonRows } = allInternalIds.length === 0
    ? { data: [] }
    : await sb
        .from("player_seasons")
        .select(seasonRowCols)
        .eq("season", season)
        .in("player_id", allInternalIds);
  const { data: profileRows } = allInternalIds.length === 0
    ? { data: [] }
    : await sb
        .from("players")
        .select("id, full_name, boxscore_name, primary_position, bats, throws, name_slug")
        .in("id", allInternalIds);

  const hittersById = new Map<number, HitterSeasonInput>();
  const pitchersById = new Map<number, PitcherSeasonInput>();
  for (const row of (seasonRows ?? []) as Array<{ player_id: number } & Record<string, unknown>>) {
    const mlbId = internalToMlb.get(row.player_id);
    if (!mlbId) continue;
    const remapped = { ...row, player_id: mlbId };
    hittersById.set(mlbId, remapped as unknown as HitterSeasonInput);
    pitchersById.set(mlbId, remapped as unknown as PitcherSeasonInput);
  }
  const profilesById = new Map<number, PlayerProfileInput>();
  for (const row of (profileRows ?? []) as Array<{ id: number } & Record<string, unknown>>) {
    const mlbId = internalToMlb.get(row.id);
    if (!mlbId) continue;
    profilesById.set(mlbId, { ...row, player_id: mlbId } as unknown as PlayerProfileInput);
  }

  const projections = projectFantasySlate({
    date,
    slate,
    hittersById,
    pitchersById,
    profilesById,
    rosterByTeamAbbr: rosterMlbByAbbr,
  });

  return { projections, mlbToInternalId: mlbToInternal };
}

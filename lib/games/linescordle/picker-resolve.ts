// Subject_id → puzzle resolver for picker-issued ids. Split from
// picker.ts to avoid a circular import between content.ts and
// picker.ts.

import "server-only";

import { supabaseAdmin } from "../../supabase";
import { getPlayerById } from "../../players";
import { normalize } from "./feedback";
import type { LinescordlePuzzle } from "./content";
import { parseLineIdFromSubjectRef } from "./picker";

type LineRow = {
  id: number;
  player_id: number;
  player_name: string;
  game_pk: number;
  game_date: string;
  team_abbr: string | null;
  opp_team_abbr: string | null;
  line_type: "batting" | "pitching";
  batting_stats: Record<string, number> | null;
  pitching_stats: Record<string, string | number> | null;
};

export async function resolveLineSubject(subjectId: string): Promise<LinescordlePuzzle | null> {
  const lineId = parseLineIdFromSubjectRef(subjectId);
  if (lineId == null) return null;

  const { data, error } = await supabaseAdmin()
    .from("historical_player_lines")
    .select("id,player_id,player_name,game_pk,game_date,team_abbr,opp_team_abbr,line_type,batting_stats,pitching_stats")
    .eq("id", lineId)
    .maybeSingle<LineRow>();
  if (error || !data) return null;

  const player = await getPlayerById(data.player_id);
  if (!player) return null;
  const displayName = player.full_name ?? data.player_name;
  const answer = normalize(displayName);

  if (data.line_type === "batting" && data.batting_stats) {
    const b = data.batting_stats as Record<string, number>;
    return {
      answer,
      displayName,
      mlbId: player.mlb_id ?? 0,
      sourceGamePk: data.game_pk,
      line: {
        kind: "batting",
        date: data.game_date,
        teamAbbr: data.team_abbr ?? "—",
        oppAbbr: data.opp_team_abbr ?? "—",
        batting: {
          ab:      b.atBats ?? 0,
          r:       b.runs ?? 0,
          h:       b.hits ?? 0,
          rbi:     b.rbi ?? 0,
          bb:      b.baseOnBalls ?? 0,
          so:      b.strikeOuts ?? 0,
          hr:      b.homeRuns ?? 0,
          doubles: b.doubles ?? 0,
          triples: b.triples ?? 0,
          sb:      b.stolenBases ?? 0,
        },
      },
    };
  }
  if (data.line_type === "pitching" && data.pitching_stats) {
    const p = data.pitching_stats as Record<string, string | number>;
    return {
      answer,
      displayName,
      mlbId: player.mlb_id ?? 0,
      sourceGamePk: data.game_pk,
      line: {
        kind: "pitching",
        date: data.game_date,
        teamAbbr: data.team_abbr ?? "—",
        oppAbbr: data.opp_team_abbr ?? "—",
        pitching: {
          ip: String(p.inningsPitched ?? "0.0"),
          h:  Number(p.hits ?? 0),
          r:  Number(p.runs ?? 0),
          er: Number(p.earnedRuns ?? 0),
          bb: Number(p.baseOnBalls ?? 0),
          so: Number(p.strikeOuts ?? 0),
          hr: Number(p.homeRuns ?? 0),
        },
      },
    };
  }
  return null;
}

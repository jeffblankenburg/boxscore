import { notFound } from "next/navigation";
import { requireAdmin } from "../../require-admin";
import { getHistoricalGameWithRaw } from "@/lib/historical/queries";
import { renderGame, type GameDetail } from "@/lib/render";
import {
  parseBoxscore,
  fetchPlayByPlayRaw,
  parseScoringPlays,
  type Boxscore,
  type ScheduleGame,
} from "@/lib/mlb";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historical box score · admin · boxscore", robots: { index: false } };

const GAME_TYPE_LABEL: Record<string, string> = {
  R: "Regular", S: "Spring", E: "Exhibition", A: "All-Star",
  F: "Wild Card", D: "Division Series", L: "LCS", W: "World Series", P: "Postseason",
};

// Synthesizes the ScheduleGame shape that renderGame consumes from the
// pieces we have at hand: the summary row, the stored linescore_raw, and
// the team blocks inside boxscore_raw (which carry the full team name).
function synthesizeScheduleGame(
  summary: {
    away_team_id: number | null;
    away_score: number | null;
    home_team_id: number | null;
    home_score: number | null;
    venue: string | null;
    game_date: string;
    game_type: string | null;
  },
  box: Boxscore,
  linescoreRaw: unknown,
): ScheduleGame {
  type LinescoreEnvelope = {
    innings?: Array<{ num: number; home?: { runs?: number }; away?: { runs?: number } }>;
    currentInning?: number;
    scheduledInnings?: number;
    teams?: {
      home?: { runs?: number; hits?: number; errors?: number };
      away?: { runs?: number; hits?: number; errors?: number };
    };
  };
  const ls = (linescoreRaw ?? {}) as LinescoreEnvelope;

  return {
    gamePk: 0,                                                      // not read by renderGame
    gameDate: summary.game_date,
    gameType: summary.game_type ?? undefined,
    status: { abstractGameState: "Final", detailedState: "Final", codedGameState: "F" },
    teams: {
      away: {
        team: {
          id: box.teams.away.team.id,
          name: box.teams.away.team.name,
          abbreviation: box.teams.away.team.abbreviation,
        },
        score: summary.away_score ?? 0,
      },
      home: {
        team: {
          id: box.teams.home.team.id,
          name: box.teams.home.team.name,
          abbreviation: box.teams.home.team.abbreviation,
        },
        score: summary.home_score ?? 0,
      },
    },
    linescore: {
      currentInning: ls.currentInning,
      scheduledInnings: ls.scheduledInnings,
      innings: (ls.innings ?? []).map((i) => ({
        num: i.num,
        home: { runs: i.home?.runs },
        away: { runs: i.away?.runs },
      })),
      teams: {
        home: {
          runs:   ls.teams?.home?.runs   ?? summary.home_score ?? 0,
          hits:   ls.teams?.home?.hits,
          errors: ls.teams?.home?.errors,
        },
        away: {
          runs:   ls.teams?.away?.runs   ?? summary.away_score ?? 0,
          hits:   ls.teams?.away?.hits,
          errors: ls.teams?.away?.errors,
        },
      },
    },
    venue: summary.venue ? { name: summary.venue } : undefined,
  };
}

export default async function HistoricalGameDetail({
  params,
}: {
  params: Promise<{ gamePk: string }>;
}) {
  await requireAdmin();
  const { gamePk: gpStr } = await params;
  const gamePk = Number(gpStr);
  if (!Number.isFinite(gamePk)) notFound();

  const summary = await getHistoricalGameWithRaw(gamePk);
  if (!summary || !summary.boxscore_raw) notFound();

  const box = parseBoxscore(summary.boxscore_raw);

  // Scoring plays via on-demand PBP fetch. Tolerate failure quietly — the
  // detail page should still render the box even if PBP doesn't load (or
  // is missing for a pre-1950 outlier, though the crawler is gated to
  // 1950+ for ingestion).
  let scoring: Awaited<ReturnType<typeof parseScoringPlays>> = [];
  try {
    scoring = parseScoringPlays(await fetchPlayByPlayRaw(gamePk));
  } catch {
    /* fall through with empty scoring; renderer just omits the block */
  }

  const game = synthesizeScheduleGame(
    {
      away_team_id: summary.away_team_id,
      away_score:   summary.away_score,
      home_team_id: summary.home_team_id,
      home_score:   summary.home_score,
      venue:        summary.venue,
      game_date:    summary.game_date,
      game_type:    summary.game_type,
    },
    box,
    summary.linescore_raw,
  );

  const detail: Required<GameDetail> = { game, box, scoring };
  const liveAbbrev: Record<string, string> = {};
  if (game.teams.away.team.abbreviation) liveAbbrev[game.teams.away.team.name] = game.teams.away.team.abbreviation;
  if (game.teams.home.team.abbreviation) liveAbbrev[game.teams.home.team.name] = game.teams.home.team.abbreviation;

  const html = renderGame(detail, liveAbbrev);

  const notes = summary.excitement_notes ?? {};
  const typeLabel = summary.game_type ? GAME_TYPE_LABEL[summary.game_type] ?? summary.game_type : null;

  return (
    <main className="admin">
      <p className="admin-meta">
        <a href="/admin/historical">← Back to historical index</a>
      </p>
      <h1 style={{ marginBottom: 4 }}>
        {summary.game_date}
        {typeLabel ? <span className="a-muted" style={{ marginLeft: 8, fontWeight: 400 }}>· {typeLabel}</span> : null}
      </h1>
      <p className="admin-meta" style={{ marginTop: 0 }}>
        gamePk {summary.game_pk} · {summary.venue ?? "—"}
      </p>

      <section style={{ margin: "16px 0", padding: 12, border: "1px solid var(--border, #ccc)", borderRadius: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Excitement score: {summary.excitement_score}
        </div>
        {Object.keys(notes).length === 0 ? (
          <div className="admin-meta">No signals fired — vanilla regular-season outcome.</div>
        ) : (
          <ul className="admin-meta" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {Object.entries(notes).map(([k, v]) => (
              <li key={k}><code>{k}</code>: {v > 0 ? "+" : ""}{v}</li>
            ))}
          </ul>
        )}
      </section>

      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}

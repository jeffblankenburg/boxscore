import { cookies } from "next/headers";
import {
  getTodaysPuzzle,
  toPublicPuzzle,
  type LinescordlePuzzle,
} from "@/lib/games/linescordle/content";
import { pickLinescordleForDate } from "@/lib/games/linescordle/picker";
import { buildRevealData } from "@/lib/games/linescordle/reveal";
import { getAttempt } from "@/lib/games/attempts";
import { todayInET } from "@/lib/dates";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { LinescordleGame, type HintValues, type InitialAttempt } from "./LinescordleGame";
import type { RevealPayload } from "./actions";
import "./linescordle.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Linescordle | boxscore games",
  robots: { index: false },     // unindex while in development
};

export default async function LinescordlePage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string }>;
}) {
  const sp = await searchParams;
  // Puzzle date pinned to midnight ET so the rollover happens at
  // 00:00 America/New_York regardless of where the server runs or
  // where the player is. See lib/dates.ts for the helper.
  const playedOnEarly = todayInET();

  // Live picker first; fall back to the hardcoded v0 puzzle when the
  // picker returns null (e.g. early days when feat data is still
  // backfilling, or no candidate above threshold for today). Test
  // keys override both — used only for screenshot verification of
  // multi-length grids.
  let subjectId: string;
  let puzzle: LinescordlePuzzle;
  if (sp.test) {
    const picked = getTodaysPuzzle(sp.test);
    subjectId = picked.subjectId;
    puzzle = picked.puzzle;
  } else {
    const live = await pickLinescordleForDate(playedOnEarly);
    if (live) {
      subjectId = live.subjectId;
      puzzle = live.puzzle;
    } else {
      const fallback = getTodaysPuzzle();
      subjectId = fallback.subjectId;
      puzzle = fallback.puzzle;
    }
  }
  const publicPuzzle = toPublicPuzzle(subjectId, puzzle);

  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  const isAuthed = !!session;

  const playedOn = playedOnEarly;

  let initial: InitialAttempt | null = null;
  let initialHintValues: HintValues = {};
  let initialReveal: RevealPayload | null = null;

  if (session) {
    const row = await getAttempt({
      subscriberId: session.subscriber_id,
      game: "linescordle",
      puzzleDate: playedOn,
    });
    // If the stored attempt is for a DIFFERENT puzzle than today's
    // pick (e.g. picker changed mid-day, or v0 hardcoded answer is
    // being replaced by a live pick), pretend we have no attempt and
    // start fresh. The stored row stays — useful for debugging — but
    // doesn't override today's render.
    const storedMatchesPick = row && row.puzzle_subject_id === subjectId;
    if (row && storedMatchesPick) {
      const hints = (row.hints as InitialAttempt["hints"]) ?? [];
      initial = {
        guesses: (row.guesses as InitialAttempt["guesses"]) ?? [],
        hints,
        solved:  row.solved,
      };
      // Pre-resolve any hints they already took so the UI shows the
      // value immediately instead of a loading flicker after the
      // server action returns.
      if (hints.includes("date"))  initialHintValues.date  = puzzle.line.date;
      if (hints.includes("teams")) initialHintValues.teams = { teamAbbr: puzzle.line.teamAbbr, oppAbbr: puzzle.line.oppAbbr };
      // If they already finished the puzzle, pre-fetch the reveal
      // payload so refresh-on-completed-puzzle renders the full
      // post-game card without a roundtrip.
      if (row.solved === true || row.solved === false) {
        const reveal = await buildRevealData(puzzle);
        const debutYear = reveal.player?.debut_date ? reveal.player.debut_date.slice(0, 4) : null;
        const lastYear = reveal.player?.last_game_date ? reveal.player.last_game_date.slice(0, 4) : null;
        const era = debutYear
          ? lastYear && lastYear !== debutYear ? `${debutYear}–${lastYear}` : debutYear
          : null;
        const handed = reveal.player
          ? puzzle.line.kind === "pitching"
            ? (reveal.player.throws ? `throws ${reveal.player.throws}` : null)
            : (reveal.player.bats ? `bats ${reveal.player.bats}` : null)
          : null;
        initialReveal = {
          displayName: puzzle.displayName,
          role: puzzle.line.kind === "pitching" ? "Pitcher" : "Batter",
          era,
          handed,
          careerHtml: reveal.careerHtml,
          boxScoreHtml: reveal.boxScoreHtml,
        };
      }
    }
  }

  return (
    <LinescordleGame
      puzzle={publicPuzzle}
      playedOn={playedOn}
      isAuthed={isAuthed}
      initial={initial}
      initialHintValues={initialHintValues}
      initialReveal={initialReveal}
    />
  );
}

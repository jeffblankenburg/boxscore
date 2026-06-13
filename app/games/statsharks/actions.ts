"use server";

// Server actions for Stat Sharks (#64). Mirrors the Linescordle
// pattern: stat-bearing data flows through here so the answer never
// reaches the client until the round is scored. The client only ever
// sees player names, years, teams, and their previous picks — never
// the stat values of an in-flight pair.

import { cookies } from "next/headers";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { saveAttempt, getAttempt } from "@/lib/games/attempts";
import { pickStatSharksPair, type StatSharksCard } from "@/lib/games/statsharks/picker";
import { STATS, statForDate, type StatDef, type StatKey } from "@/lib/games/statsharks/stats";
import { todayInET } from "@/lib/dates";

// ─── Shared types ────────────────────────────────────────────────

/** Server-side round record. The full history is what the picker
 * uses to compute `usedPlayerSeasonIds`; the client gets a redacted
 * view. */
export type ServerRound = {
  roundIndex:  number;
  leftId:      number;
  rightId:     number;
  leftStat:    number;
  rightStat:   number;
  correctSide: "left" | "right";
  pickedSide:  "left" | "right" | "timeout" | null;
  wasCorrect:  boolean | null;
};

/** Public-facing pair — no stat values until reveal. */
export type ClientPair = {
  roundIndex: number;
  left:  Omit<StatSharksCard, "statValue">;
  right: Omit<StatSharksCard, "statValue">;
};

/** Reveal payload sent back when a round is scored. Includes the
 * stat values for both sides so the client can flip the cards. */
export type RoundReveal = {
  roundIndex:  number;
  leftStat:    number;
  rightStat:   number;
  correctSide: "left" | "right";
  pickedSide:  "left" | "right" | "timeout";
  wasCorrect:  boolean;
};

export type GameStatus = "playing" | "ended";

/** Top-level state returned to the client. */
export type ClientState = {
  stat:        StatDef;
  status:      GameStatus;
  streak:      number;                  // longest correct streak so far
  rounds:      ClientRoundView[];       // history (correct/incorrect, for share grid)
  currentPair: ClientPair | null;       // null when status=ended
  finalStreak: number | null;           // only set when status=ended
  playedOn:    string;
};

/** History entry the client can render — no stat values, just
 * whether each round was right or wrong. */
export type ClientRoundView = {
  roundIndex: number;
  wasCorrect: boolean;
};

// ─── Internal helpers ────────────────────────────────────────────

function stripPair(round: ServerRound): ClientPair {
  return {
    roundIndex: round.roundIndex,
    left:  { id: round.leftId,  player_id: 0, player_name: "", season: 0, team_abbr: null },
    right: { id: round.rightId, player_id: 0, player_name: "", season: 0, team_abbr: null },
  };
}

function buildClientState(opts: {
  stat:       StatDef;
  rounds:     ServerRound[];
  pendingPair: ServerRound | null;
  pendingCards: { left: StatSharksCard; right: StatSharksCard } | null;
  playedOn:   string;
}): ClientState {
  const completed = opts.rounds.filter((r) => r.wasCorrect !== null);
  // Streak = number of consecutive correct rounds at the end of the
  // history. Stat Sharks ends on the first wrong, so the streak is
  // simply the count of completed-correct rounds.
  const streak = completed.filter((r) => r.wasCorrect).length;
  const ended = opts.pendingPair === null;
  let currentPair: ClientPair | null = null;
  if (opts.pendingPair && opts.pendingCards) {
    currentPair = {
      roundIndex: opts.pendingPair.roundIndex,
      left:  {
        id:          opts.pendingCards.left.id,
        player_id:   opts.pendingCards.left.player_id,
        player_name: opts.pendingCards.left.player_name,
        season:      opts.pendingCards.left.season,
        team_abbr:   opts.pendingCards.left.team_abbr,
      },
      right: {
        id:          opts.pendingCards.right.id,
        player_id:   opts.pendingCards.right.player_id,
        player_name: opts.pendingCards.right.player_name,
        season:      opts.pendingCards.right.season,
        team_abbr:   opts.pendingCards.right.team_abbr,
      },
    };
  }
  return {
    stat:        opts.stat,
    status:      ended ? "ended" : "playing",
    streak,
    rounds:      completed.map((r) => ({ roundIndex: r.roundIndex, wasCorrect: r.wasCorrect! })),
    currentPair,
    finalStreak: ended ? streak : null,
    playedOn:    opts.playedOn,
  };
}

/** Used IDs from ALL rounds (completed AND pending) so the next pick
 * doesn't repeat a player-season. */
function collectUsedIds(rounds: ServerRound[]): Set<number> {
  const used = new Set<number>();
  for (const r of rounds) {
    used.add(r.leftId);
    used.add(r.rightId);
  }
  return used;
}

// We need both the stripped pair (for resume) and the cards (for
// display). The picker returns cards; we strip stat values out.
async function nextRound(stat: StatDef, prior: ServerRound[]): Promise<{
  serverRound: ServerRound;
  cards:       { left: StatSharksCard; right: StatSharksCard };
} | null> {
  const used = collectUsedIds(prior);
  const pair = await pickStatSharksPair({
    statKey:             stat.key,
    round:               prior.length,
    usedPlayerSeasonIds: used,
  });
  if (!pair) return null;
  return {
    serverRound: {
      roundIndex:  prior.length,
      leftId:      pair.left.id,
      rightId:     pair.right.id,
      leftStat:    pair.left.statValue,
      rightStat:   pair.right.statValue,
      correctSide: pair.correct,
      pickedSide:  null,
      wasCorrect:  null,
    },
    cards: { left: pair.left, right: pair.right },
  };
}

// Persisted shape inside puzzle_attempts.guesses. We store the full
// ServerRound[] there; only the server reads or writes it. The client
// never sees this jsonb directly.
type Persisted = { stat: StatKey; rounds: ServerRound[] };

async function loadPersisted(subscriberId: string, playedOn: string): Promise<Persisted | null> {
  const row = await getAttempt({
    subscriberId,
    game:       "statsharks",
    puzzleDate: playedOn,
  });
  if (!row) return null;
  return row.guesses as Persisted;
}

async function savePersisted(opts: {
  subscriberId: string;
  playedOn:     string;
  stat:         StatDef;
  rounds:       ServerRound[];
  ended:        boolean;
}): Promise<void> {
  const persisted: Persisted = { stat: opts.stat.key, rounds: opts.rounds };
  const completed = opts.rounds.filter((r) => r.wasCorrect !== null);
  const streak = completed.filter((r) => r.wasCorrect).length;
  await saveAttempt({
    subscriberId:     opts.subscriberId,
    game:             "statsharks",
    puzzleDate:       opts.playedOn,
    puzzleSubjectId:  opts.stat.key,
    guesses:          persisted as unknown,
    hints:            [],
    solved:           opts.ended ? streak >= 1 : null,
    guessCount:       completed.length,
    hintCount:        0,
  });
}

// ─── Public actions ──────────────────────────────────────────────

/**
 * Returns the current state for today's run. If no row exists yet,
 * generates the first pair, persists, and returns the initial state.
 * Anonymous users get a session-less response (no DB row); the client
 * keeps state in localStorage and re-asks for pairs via getPair().
 */
export async function getOrStartRun(): Promise<ClientState> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  const playedOn = todayInET();
  const stat = statForDate(playedOn);

  if (!session) {
    // Anonymous: server can't store anything. Just hand back a fresh
    // first pair; the client will track state in localStorage and
    // submit picks against scorePair() instead.
    const first = await nextRound(stat, []);
    if (!first) {
      return {
        stat, status: "ended", streak: 0,
        rounds: [], currentPair: null, finalStreak: 0, playedOn,
      };
    }
    return buildClientState({
      stat, rounds: [first.serverRound],
      pendingPair: first.serverRound,
      pendingCards: first.cards,
      playedOn,
    });
  }

  const persisted = await loadPersisted(session.subscriber_id, playedOn);
  if (!persisted) {
    const first = await nextRound(stat, []);
    if (!first) {
      return {
        stat, status: "ended", streak: 0,
        rounds: [], currentPair: null, finalStreak: 0, playedOn,
      };
    }
    await savePersisted({
      subscriberId: session.subscriber_id, playedOn, stat,
      rounds: [first.serverRound], ended: false,
    });
    return buildClientState({
      stat, rounds: [first.serverRound],
      pendingPair: first.serverRound,
      pendingCards: first.cards,
      playedOn,
    });
  }

  // Existing row — figure out the pending pair (if any).
  const rounds = persisted.rounds;
  const pending = rounds.find((r) => r.wasCorrect === null) ?? null;
  if (!pending) {
    return buildClientState({
      stat, rounds, pendingPair: null, pendingCards: null, playedOn,
    });
  }
  // Re-fetch the cards for the pending pair so the client can display
  // them. We never persisted player names; pull them on demand.
  const cards = await fetchCardsForIds(pending.leftId, pending.rightId);
  return buildClientState({
    stat, rounds, pendingPair: pending, pendingCards: cards, playedOn,
  });
}

async function fetchCardsForIds(leftId: number, rightId: number): Promise<{ left: StatSharksCard; right: StatSharksCard }> {
  // Minimal name + season + team lookup. Stat values aren't needed
  // until the round is scored.
  const { supabaseAdmin } = await import("@/lib/supabase");
  const db = supabaseAdmin();
  const { data } = await db
    .from("player_seasons")
    .select("id, player_id, season, team_abbr, players!inner(full_name)")
    .in("id", [leftId, rightId]);
  type Row = { id: number; player_id: number; season: number; team_abbr: string | null; players: { full_name: string } | Array<{ full_name: string }> };
  const byId = new Map<number, StatSharksCard>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const ps = Array.isArray(r.players) ? r.players[0] : r.players;
    byId.set(r.id, {
      id: r.id, player_id: r.player_id, season: r.season, team_abbr: r.team_abbr,
      player_name: ps?.full_name ?? "(unknown)", statValue: 0,
    });
  }
  return {
    left:  byId.get(leftId)!  ?? { id: leftId,  player_id: 0, player_name: "(unknown)", season: 0, team_abbr: null, statValue: 0 },
    right: byId.get(rightId)! ?? { id: rightId, player_id: 0, player_name: "(unknown)", season: 0, team_abbr: null, statValue: 0 },
  };
}

/**
 * Submit the user's pick for the in-flight round. Returns the reveal
 * (stat values + correct side) plus either the next pair, or the
 * final state if the run ends.
 */
export async function submitPick(opts: {
  roundIndex: number;
  pickedSide: "left" | "right" | "timeout";
}): Promise<{
  reveal: RoundReveal;
  next:   ClientState;
}> {
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  const playedOn = todayInET();
  const stat = statForDate(playedOn);

  // Helper that runs the scoring + state-transition given the
  // server-side rounds list. Returns the reveal and either a fresh
  // next pair or null (run ended).
  const stepRound = async (rounds: ServerRound[]): Promise<{
    reveal: RoundReveal;
    nextRounds: ServerRound[];
    nextCards: { left: StatSharksCard; right: StatSharksCard } | null;
  }> => {
    const idx = rounds.findIndex((r) => r.wasCorrect === null);
    if (idx === -1) throw new Error("No in-flight round to submit against.");
    const round = rounds[idx]!;
    if (round.roundIndex !== opts.roundIndex) {
      throw new Error(`Round mismatch: have ${round.roundIndex}, got ${opts.roundIndex}`);
    }
    const wasCorrect = opts.pickedSide !== "timeout" && opts.pickedSide === round.correctSide;
    round.pickedSide = opts.pickedSide;
    round.wasCorrect = wasCorrect;
    const reveal: RoundReveal = {
      roundIndex: round.roundIndex,
      leftStat:   round.leftStat,
      rightStat:  round.rightStat,
      correctSide: round.correctSide,
      pickedSide:  opts.pickedSide,
      wasCorrect,
    };
    if (!wasCorrect) {
      return { reveal, nextRounds: rounds, nextCards: null };
    }
    const next = await nextRound(stat, rounds);
    if (!next) {
      // Pool exhausted — treat as run ended successfully.
      return { reveal, nextRounds: rounds, nextCards: null };
    }
    return { reveal, nextRounds: [...rounds, next.serverRound], nextCards: next.cards };
  };

  if (!session) {
    // Anonymous: we can't pull the round from the DB. The client posts
    // the in-flight round's full server data back to us via the
    // dedicated anonymous flow. We don't implement that here in v1 —
    // anonymous users are routed through a thinner pure-client
    // scoring path. For now, force sign-in for daily mode.
    throw new Error("Sign-in required to play the daily Stat Sharks. Sign in at /settings.");
  }

  const persisted = await loadPersisted(session.subscriber_id, playedOn);
  if (!persisted) throw new Error("No run in progress.");
  const { reveal, nextRounds, nextCards } = await stepRound(persisted.rounds);
  const ended = nextCards === null;
  await savePersisted({
    subscriberId: session.subscriber_id, playedOn, stat,
    rounds: nextRounds, ended,
  });
  const next = buildClientState({
    stat, rounds: nextRounds,
    pendingPair: ended ? null : nextRounds.find((r) => r.wasCorrect === null) ?? null,
    pendingCards: nextCards,
    playedOn,
  });
  return { reveal, next };
}

// stripPair currently unused; suppress lint
void stripPair;

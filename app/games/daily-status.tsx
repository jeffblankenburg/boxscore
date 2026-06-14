"use client";

// Per-game daily-puzzle status displayed under each /games landing
// card. Reads each game's localStorage shape on mount and renders a
// short summary — "Solved in 4 · 1985", "Today: 8/10", "On guess 3",
// etc. Returns null when nothing's been played today. Anonymous users
// see their own local progress; authed users see the same because the
// server-side mirror writes into localStorage on every guess.

import { useEffect, useState } from "react";

type StatusKind = "done-win" | "done-loss" | "in-progress" | null;

type Status = {
  kind: StatusKind;
  text: string;
} | null;

export function DailyStatus({ slug, playedOn }: { slug: string; playedOn: string }) {
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => {
    setStatus(readStatus(slug, playedOn));
  }, [slug, playedOn]);
  if (!status) return null;
  return (
    <p className={`g-card-status-line g-card-status-${status.kind ?? "none"}`}>
      {status.text}
    </p>
  );
}

function readStatus(slug: string, date: string): Status {
  if (typeof window === "undefined") return null;
  try {
    switch (slug) {
      case "statsharks":    return readStatSharks(date);
      case "time-machine":  return readTimeMachine(date);
      case "linescordle":   return readLinescordle(date);
      default:              return null;
    }
  } catch {
    return null;
  }
}

// Stat Sharks — daily is 10 rounds, score = # correct picks
function readStatSharks(date: string): Status {
  const raw = localStorage.getItem(`statsharks:attempt:${date}`);
  if (!raw) return null;
  const a = JSON.parse(raw) as {
    rounds?: Array<{ wasCorrect?: boolean }>;
    ended?:  boolean;
  };
  const rounds  = a.rounds ?? [];
  const correct = rounds.filter((r) => r.wasCorrect).length;
  if (a.ended) {
    const kind: StatusKind = correct === 10 ? "done-win" : "done-loss";
    return { kind, text: `Today: ${correct}/10${correct === 10 ? " ✨" : ""}` };
  }
  if (rounds.length > 0) {
    return { kind: "in-progress", text: `In progress · ${correct}/${rounds.length} so far` };
  }
  return null;
}

// Time Machine — 6 guesses, hint on last guess tells win/loss
function readTimeMachine(date: string): Status {
  const raw = localStorage.getItem(`time-machine:${date}`);
  if (!raw) return null;
  const a = JSON.parse(raw) as {
    guesses?:    Array<{ year?: number; hint?: string }>;
    ended?:      boolean;
    answerYear?: number;
  };
  const guesses = a.guesses ?? [];
  const last    = guesses[guesses.length - 1];
  if (a.ended) {
    if (last?.hint === "correct") {
      return {
        kind: "done-win",
        text: `Solved in ${guesses.length}${a.answerYear ? ` · ${a.answerYear}` : ""}`,
      };
    }
    return {
      kind: "done-loss",
      text: `Out of guesses${a.answerYear ? ` · ${a.answerYear}` : ""}`,
    };
  }
  if (guesses.length > 0) {
    return { kind: "in-progress", text: `On guess ${guesses.length + 1} of 6` };
  }
  return null;
}

// Linescordle — 6 guesses, solved field is the win flag
function readLinescordle(date: string): Status {
  const raw = localStorage.getItem(`linescordle:attempt:${date}`);
  if (!raw) return null;
  const a = JSON.parse(raw) as {
    guesses?: Array<unknown>;
    solved?:  boolean | null;
  };
  const n = (a.guesses ?? []).length;
  if (a.solved === true)  return { kind: "done-win",  text: `Solved in ${n}` };
  if (a.solved === false) return { kind: "done-loss", text: `Out of guesses` };
  if (n > 0)              return { kind: "in-progress", text: `On guess ${n + 1} of 6` };
  return null;
}

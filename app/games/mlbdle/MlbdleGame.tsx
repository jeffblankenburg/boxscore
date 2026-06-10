"use client";

// MLBdle game state machine. Single client component because every
// transition (key press, guess submit, win, lose) is local React state;
// nothing needs server roundtrips until the reveal hits the career
// cache (deferred to v0.1). Keep this file the only stateful piece —
// the tile grid and keyboard are pure presentational.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MlbdlePuzzle } from "@/lib/games/mlbdle/content";
import {
  scoreGuess,
  keyboardState,
  normalize,
  type LetterState,
} from "@/lib/games/mlbdle/feedback";

const MAX_GUESSES = 6;

type Guess = {
  letters: string[];      // length === answer.length
  scores: LetterState[];  // same length
};

type GameStatus = "playing" | "won" | "lost";

export function MlbdleGame({ puzzle }: { puzzle: MlbdlePuzzle }) {
  const answerLen = puzzle.answer.length;

  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [current, setCurrent] = useState<string>("");   // letters typed so far for the in-progress row
  const [status, setStatus] = useState<GameStatus>("playing");
  const [shakeRow, setShakeRow] = useState<number | null>(null);

  const keyState = useMemo(() => keyboardState(guesses), [guesses]);

  const submitGuess = useCallback(() => {
    if (status !== "playing") return;
    if (current.length !== answerLen) {
      // Tell the user visually that the row needs to be filled before
      // submit — quick shake of the current row.
      setShakeRow(guesses.length);
      setTimeout(() => setShakeRow(null), 400);
      return;
    }
    const letters = current.split("");
    const scores = scoreGuess(puzzle.answer, current);
    const nextGuesses = [...guesses, { letters, scores }];
    setGuesses(nextGuesses);
    setCurrent("");
    if (current === puzzle.answer) {
      setStatus("won");
    } else if (nextGuesses.length >= MAX_GUESSES) {
      setStatus("lost");
    }
  }, [current, answerLen, guesses, puzzle.answer, status]);

  const pressKey = useCallback(
    (key: string) => {
      if (status !== "playing") return;
      if (key === "ENTER") {
        submitGuess();
        return;
      }
      if (key === "BACKSPACE") {
        setCurrent((c) => c.slice(0, -1));
        return;
      }
      // Single letter
      if (/^[A-Z]$/.test(key)) {
        setCurrent((c) => (c.length < answerLen ? c + key : c));
      }
    },
    [answerLen, status, submitGuess],
  );

  // Bind physical keyboard for desktop. Tap/click on the on-screen
  // keyboard works for both.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't swallow keystrokes inside form fields (none in v0, but
      // future-proof for share-grid copy buttons etc).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toUpperCase();
      if (k === "ENTER" || k === "BACKSPACE") {
        e.preventDefault();
        pressKey(k);
        return;
      }
      if (k.length === 1 && /^[A-Z]$/.test(k)) {
        pressKey(k);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pressKey]);

  return (
    <div className="mlbdle">
      {/* Layout's sticky brand bar serves as the global chrome; the
          game itself opens directly into the clue card so the playable
          surface is the dominant element of the viewport. */}
      <header className="mlbdle-h">
        <h2>MLBdle</h2>
        <p className="mlbdle-sub">Guess the player from their game line.</p>
      </header>

      <ClueCard puzzle={puzzle} />

      <GuessGrid
        rows={MAX_GUESSES}
        cols={answerLen}
        guesses={guesses}
        current={current}
        shakeRow={shakeRow}
      />

      {status === "playing" ? (
        <Keyboard keyState={keyState} onKey={pressKey} />
      ) : (
        <Reveal puzzle={puzzle} status={status} guessCount={guesses.length} />
      )}
    </div>
  );
}

// ─── Clue card ────────────────────────────────────────────────────

function ClueCard({ puzzle }: { puzzle: MlbdlePuzzle }) {
  const { line } = puzzle;
  return (
    <section className="mlbdle-clue">
      <div className="mlbdle-clue-meta">
        {line.date} · {line.teamAbbr} at {line.oppAbbr}
      </div>
      {line.kind === "pitching" && line.pitching ? (
        <table className="mlbdle-line">
          <thead>
            <tr>
              <th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>SO</th><th>HR</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{line.pitching.ip}</td>
              <td>{line.pitching.h}</td>
              <td>{line.pitching.r}</td>
              <td>{line.pitching.er}</td>
              <td>{line.pitching.bb}</td>
              <td>{line.pitching.so}</td>
              <td>{line.pitching.hr}</td>
            </tr>
          </tbody>
        </table>
      ) : line.kind === "batting" && line.batting ? (
        <table className="mlbdle-line">
          <thead>
            <tr>
              <th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>SO</th><th>HR</th><th>2B</th><th>3B</th><th>SB</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{line.batting.ab}</td>
              <td>{line.batting.r}</td>
              <td>{line.batting.h}</td>
              <td>{line.batting.rbi}</td>
              <td>{line.batting.bb}</td>
              <td>{line.batting.so}</td>
              <td>{line.batting.hr}</td>
              <td>{line.batting.doubles}</td>
              <td>{line.batting.triples}</td>
              <td>{line.batting.sb}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

// ─── Guess grid ───────────────────────────────────────────────────

function GuessGrid({
  rows, cols, guesses, current, shakeRow,
}: {
  rows: number;
  cols: number;
  guesses: Guess[];
  current: string;
  shakeRow: number | null;
}) {
  const rowsArr: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const isCurrent = r === guesses.length;
    const guess = guesses[r];
    const cells: React.ReactNode[] = [];
    for (let c = 0; c < cols; c++) {
      let letter = "";
      let state: LetterState | "empty" | "filled" = "empty";
      if (guess) {
        letter = guess.letters[c] ?? "";
        state = guess.scores[c] ?? "gray";
      } else if (isCurrent && c < current.length) {
        letter = current[c] ?? "";
        state = "filled";
      }
      cells.push(
        <div key={c} className={`mlbdle-tile mlbdle-tile-${state}`}>
          {letter}
        </div>,
      );
    }
    rowsArr.push(
      <div
        key={r}
        className={`mlbdle-row${shakeRow === r ? " mlbdle-row-shake" : ""}`}
        style={{ ["--cols" as string]: cols }}
      >
        {cells}
      </div>,
    );
  }
  return <section className="mlbdle-grid" aria-label="Guesses">{rowsArr}</section>;
}

// ─── Keyboard ─────────────────────────────────────────────────────

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];

function Keyboard({
  keyState, onKey,
}: {
  keyState: Map<string, LetterState>;
  onKey: (key: string) => void;
}) {
  return (
    <section className="mlbdle-kbd" aria-label="On-screen keyboard">
      {KEY_ROWS.map((row, i) => (
        <div key={i} className="mlbdle-kbd-row">
          {row.map((k) => {
            const isWide = k === "ENTER" || k === "BACKSPACE";
            const state = keyState.get(k);
            const cls = [
              "mlbdle-key",
              isWide ? "mlbdle-key-wide" : "",
              state ? `mlbdle-key-${state}` : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={k}
                type="button"
                className={cls}
                onClick={() => onKey(k)}
                aria-label={k === "BACKSPACE" ? "Backspace" : k === "ENTER" ? "Enter" : k}
              >
                {k === "BACKSPACE" ? "⌫" : k}
              </button>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ─── Reveal ───────────────────────────────────────────────────────

function Reveal({
  puzzle, status, guessCount,
}: {
  puzzle: MlbdlePuzzle;
  status: GameStatus;
  guessCount: number;
}) {
  // v0 reveal: show the name and the source-game context. Career
  // year-by-year breakdown lands in v0.1 once the career cache table
  // and renderer are built (per issue #59).
  return (
    <section className={`mlbdle-reveal mlbdle-reveal-${status}`}>
      <div className="mlbdle-reveal-status">
        {status === "won"
          ? `Solved in ${guessCount} / ${MAX_GUESSES}`
          : `Out of guesses`}
      </div>
      <div className="mlbdle-reveal-name">{puzzle.displayName}</div>
      <div className="mlbdle-reveal-meta">
        {puzzle.line.kind === "pitching" ? "Pitcher" : "Batter"} ·
        {" "}{puzzle.line.date} · {puzzle.line.teamAbbr} at {puzzle.line.oppAbbr}
      </div>
      <p className="mlbdle-reveal-soon">
        Career year-by-year breakdown — coming soon.
      </p>
    </section>
  );
}

// Suppress unused-warning on normalize since callers don't currently
// re-normalize in this file.
void normalize;

"use client";

// Linescordle client component. The answer never reaches this file —
// guess scoring, hint reveal, and the post-game reveal all happen via
// server actions in actions.ts. The client knows only the puzzle's
// subject_id, name length, and line stats; the rest comes back from
// the server one piece at a time.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LinescordlePuzzlePublic } from "@/lib/games/linescordle/content";
import { useResetAtMidnightET } from "@/lib/games/use-reset-at-midnight-et";
import {
  keyboardState,
  buildShareText,
  normalize,
  type LetterState,
} from "@/lib/games/linescordle/feedback";
import {
  submitGuess,
  revealHint,
  getReveal,
  persistAttempt,
  syncLocalAttempts,
  searchPlayers,
  type RevealPayload,
} from "./actions";
import {
  getAttemptLocal,
  saveAttemptLocal,
  listAttempts,
  clearAllAttempts,
} from "@/lib/games/linescordle/localStore";

const MAX_GUESSES = 6;
const SHARE_URL = "boxscore.games/linescordle";

// Short human-readable date for the box-score header. "May 18, 1979"
// rather than the full weekday — we're labeling a historical game, not
// dating a digest. Parsed in UTC so the date doesn't shift by timezone.
function formatGameDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

type Guess = {
  letters: string[];
  scores: LetterState[];
};

type GameStatus = "playing" | "won" | "lost";

type Hint = "date" | "teams";

export type HintValues = {
  date?: string;
  teams?: { teamAbbr: string; oppAbbr: string };
};

// Persisted shape we restore from the server when an authenticated
// subscriber loads the page mid-puzzle.
export type InitialAttempt = {
  guesses: Guess[];
  hints: Hint[];
  solved: boolean | null;
};

const HINT_LABEL: Record<Hint, string> = {
  date:  "Show date",
  teams: "Show teams",
};
const ALL_HINTS: Hint[] = ["date", "teams"];

export function LinescordleGame({
  puzzle,
  playedOn,
  isAuthed,
  initial,
  initialHintValues,
  initialReveal,
}: {
  puzzle: LinescordlePuzzlePublic;
  playedOn: string;
  isAuthed: boolean;
  initial: InitialAttempt | null;
  initialHintValues: HintValues;
  initialReveal: RevealPayload | null;
}) {
  const answerLen = puzzle.nameLength;
  useResetAtMidnightET(playedOn);

  const [guesses, setGuesses] = useState<Guess[]>(() => initial?.guesses ?? []);
  const [current, setCurrent] = useState<string>("");
  const [status, setStatus] = useState<GameStatus>(() => {
    if (initial?.solved === true) return "won";
    if (initial?.solved === false) return "lost";
    return "playing";
  });
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  const [hintsRevealed, setHintsRevealed] = useState<Set<Hint>>(
    () => new Set(initial?.hints ?? []),
  );
  const [hintValues, setHintValues] = useState<HintValues>(initialHintValues);
  const [reveal, setReveal] = useState<RevealPayload | null>(initialReveal);
  const [pending, setPending] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // First-visit auto-open of the help modal. localStorage flag stops it
  // from popping up on every return visit.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("linescordle:help-seen") !== "1") {
        setHelpOpen(true);
      }
    } catch { /* private mode */ }
  }, []);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    try { window.localStorage.setItem("linescordle:help-seen", "1"); } catch { /* ignore */ }
  }, []);

  const keyState = useMemo(() => keyboardState(guesses), [guesses]);

  const persist = useCallback(
    (snapshot: { guesses: Guess[]; hints: Hint[]; solved: boolean | null }) => {
      // Authenticated path: server-side save. Anonymous path:
      // localStorage. Same shape so the at-sign-in merge can upsert
      // each local row into puzzle_attempts directly.
      if (isAuthed) {
        void persistAttempt({
          puzzleDate:      playedOn,
          puzzleSubjectId: puzzle.subjectId,
          guesses:         snapshot.guesses,
          hints:           snapshot.hints,
          solved:          snapshot.solved,
        }).catch((e) => console.error("persistAttempt:", e));
      } else {
        saveAttemptLocal(playedOn, {
          puzzleSubjectId: puzzle.subjectId,
          guesses:         snapshot.guesses,
          hints:           snapshot.hints,
          solved:          snapshot.solved,
        });
      }
    },
    [isAuthed, playedOn, puzzle.subjectId],
  );

  // Anonymous restore. Server can't read localStorage, so it always
  // hands us a null initial. On mount we look for a local attempt
  // matching today's puzzle subject — same mismatch rule as the
  // server uses for authenticated users (page.tsx).
  useEffect(() => {
    if (isAuthed) return;
    const local = getAttemptLocal(playedOn);
    if (!local) return;
    if (local.puzzleSubjectId !== puzzle.subjectId) return;
    setGuesses(local.guesses);
    setHintsRevealed(new Set(local.hints));
    if (local.solved === true) setStatus("won");
    else if (local.solved === false) setStatus("lost");
    // Hint values aren't stored locally (the line clue is what's
    // visible); the next time the user opens date/teams they fetch
    // again via revealHint. That's a fine trade since restoring a
    // mid-puzzle game-in-progress is rare relative to fresh games.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Authenticated-sign-in merge. If the user just signed in and has
  // anonymous attempts sitting in localStorage, push them up to
  // puzzle_attempts (only where the server doesn't already have a
  // row — server wins on conflict). Clears local on success so the
  // sync only runs once per device.
  useEffect(() => {
    if (!isAuthed) return;
    const local = listAttempts();
    if (local.length === 0) return;
    const payload = local.map(({ puzzleDate, attempt }) => ({
      puzzleDate,
      puzzleSubjectId: attempt.puzzleSubjectId,
      guesses: attempt.guesses.map((g) => ({
        letters: g.letters,
        scores:  g.scores as unknown as string[],
      })),
      hints: attempt.hints as unknown as string[],
      solved: attempt.solved,
    }));
    syncLocalAttempts(payload)
      .then((res) => {
        if (res.pushed > 0 || res.skipped > 0) clearAllAttempts();
      })
      .catch((e) => console.error("syncLocalAttempts:", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the game ends, fetch the reveal payload (career + box score
  // HTML, player name, position, etc.). If we already have it from
  // the page's initial render (i.e. the prior attempt finished
  // before today), skip.
  useEffect(() => {
    if (status === "playing") return;
    if (reveal) return;
    let cancelled = false;
    getReveal(puzzle.subjectId)
      .then((r) => { if (!cancelled) setReveal(r); })
      .catch((e) => console.error("getReveal:", e));
    return () => { cancelled = true; };
  }, [status, reveal, puzzle.subjectId]);

  const submitGuessLocal = useCallback(async () => {
    if (status !== "playing" || pending) return;
    if (current.length !== answerLen) {
      setShakeRow(guesses.length);
      setTimeout(() => setShakeRow(null), 400);
      return;
    }
    setPending(true);
    try {
      const result = await submitGuess({
        puzzleSubjectId: puzzle.subjectId,
        letters: current,
      });
      const letters = current.split("");
      const newGuess: Guess = { letters, scores: result.scores };
      const nextGuesses = [...guesses, newGuess];
      let nextStatus: GameStatus = status;
      let nextSolved: boolean | null = null;
      if (result.solved) { nextStatus = "won"; nextSolved = true; }
      else if (nextGuesses.length >= MAX_GUESSES) { nextStatus = "lost"; nextSolved = false; }
      setGuesses(nextGuesses);
      setCurrent("");
      setStatus(nextStatus);
      persist({
        guesses: nextGuesses,
        hints: Array.from(hintsRevealed),
        solved: nextSolved,
      });
    } catch (e) {
      console.error("submitGuess:", e);
      setShakeRow(guesses.length);
      setTimeout(() => setShakeRow(null), 400);
    } finally {
      setPending(false);
    }
  }, [current, answerLen, guesses, status, pending, puzzle.subjectId, hintsRevealed, persist]);

  const pressKey = useCallback(
    (key: string) => {
      if (status !== "playing" || pending) return;
      if (key === "ENTER") {
        void submitGuessLocal();
        return;
      }
      if (key === "BACKSPACE") {
        setCurrent((c) => c.slice(0, -1));
        return;
      }
      if (/^[A-Z]$/.test(key)) {
        setCurrent((c) => (c.length < answerLen ? c + key : c));
      }
    },
    [answerLen, status, pending, submitGuessLocal],
  );

  const takeHint = useCallback(async (h: Hint) => {
    if (hintsRevealed.has(h)) return;
    try {
      const result = await revealHint({ puzzleSubjectId: puzzle.subjectId, hint: h });
      const next = new Set(hintsRevealed);
      next.add(h);
      setHintsRevealed(next);
      setHintValues((prev) => {
        if (result.hint === "date") return { ...prev, date: result.value };
        return { ...prev, teams: result.value };
      });
      persist({
        guesses,
        hints: Array.from(next),
        solved: status === "won" ? true : status === "lost" ? false : null,
      });
    } catch (e) {
      console.error("revealHint:", e);
    }
  }, [hintsRevealed, puzzle.subjectId, guesses, status, persist]);

  // Bind physical keyboard for desktop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
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
    <div className="linescordle">
      <header className="linescordle-h">
        <div className="linescordle-h-title">
          <h2>Linescordle</h2>
          <p className="linescordle-sub">Guess the player name from their game line.</p>
        </div>
        {/* Header icons — help (?) and stats. Both anchored top-right of
            the title block so they share the line with the page title
            and stay out of the chrome bar where there's no room. */}
        <div className="linescordle-h-icons">
          <button
            type="button"
            className="linescordle-help-btn"
            onClick={() => setHelpOpen(true)}
            aria-label="How to play"
            title="How to play"
          >
            ?
          </button>
          <a
            className="linescordle-stats-link"
            href="/games/linescordle/stats"
            aria-label="Stats"
            title="Stats"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1"   y="9" width="3" height="6"  rx="0.5" />
              <rect x="6.5" y="5" width="3" height="10" rx="0.5" />
              <rect x="12"  y="1" width="3" height="14" rx="0.5" />
            </svg>
          </a>
        </div>
      </header>

      {helpOpen ? <HelpModal onClose={closeHelp} maxGuesses={MAX_GUESSES} /> : null}

      <ClueArea
        puzzle={puzzle}
        hintsRevealed={hintsRevealed}
        hintValues={hintValues}
        onTakeHint={takeHint}
        gameOver={status !== "playing"}
      />

      <GuessGrid
        rows={MAX_GUESSES}
        cols={answerLen}
        guesses={guesses}
        current={current}
        shakeRow={shakeRow}
      />

      {status === "playing" ? (
        <>
          <Suggestions
            current={current}
            guesses={guesses}
            nameLength={answerLen}
            onPick={setCurrent}
          />
          <Keyboard keyState={keyState} onKey={pressKey} />
        </>
      ) : (
        <Reveal
          puzzle={puzzle}
          status={status}
          guesses={guesses}
          hintsUsed={hintsRevealed.size}
          reveal={reveal}
          playedOn={playedOn}
        />
      )}
    </div>
  );
}

// ─── Clue area ────────────────────────────────────────────────────

function ClueArea({
  puzzle, hintsRevealed, hintValues, onTakeHint, gameOver,
}: {
  puzzle: LinescordlePuzzlePublic;
  hintsRevealed: Set<Hint>;
  hintValues: HintValues;
  onTakeHint: (h: Hint) => void;
  gameOver: boolean;
}) {
  const { line } = puzzle;
  const showDate  = hintsRevealed.has("date");
  const showTeams = hintsRevealed.has("teams");
  const allHintsTaken = hintsRevealed.size === ALL_HINTS.length;

  return (
    <section className="linescordle-clue">
      {/* Always-rendered meta line, even when no hints are taken. The
          reserved space stops the rest of the clue card from jumping
          when the user reveals date/teams mid-puzzle. */}
      <div className="linescordle-clue-meta">
        {showDate ? hintValues.date ?? "…" : null}
        {showDate && showTeams ? " · " : null}
        {showTeams && hintValues.teams
          ? `${hintValues.teams.teamAbbr} at ${hintValues.teams.oppAbbr}`
          : showTeams ? "…" : null}
        {/* Non-breaking space keeps the line at its baseline height
            even when both hints are still hidden. */}
        {!showDate && !showTeams ? " " : null}
      </div>

      {line.kind === "pitching" && line.pitching ? (
        <table className="linescordle-line">
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
      ) : null}
      {line.kind === "batting" && line.batting ? (
        <table className="linescordle-line">
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

      {!gameOver && !allHintsTaken ? (
        <div className="linescordle-hint-row">
          {ALL_HINTS.map((h) => {
            const taken = hintsRevealed.has(h);
            if (taken) return null;
            return (
              <button
                key={h}
                type="button"
                className="linescordle-hint-btn"
                onClick={() => onTakeHint(h)}
              >
                {HINT_LABEL[h]}
              </button>
            );
          })}
        </div>
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
        <div key={c} className={`linescordle-tile linescordle-tile-${state}`}>
          {letter}
        </div>,
      );
    }
    rowsArr.push(
      <div
        key={r}
        className={`linescordle-row${shakeRow === r ? " linescordle-row-shake" : ""}`}
        style={{ ["--cols" as string]: cols }}
      >
        {cells}
      </div>,
    );
  }
  return <section className="linescordle-grid" aria-label="Guesses">{rowsArr}</section>;
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
    <section className="linescordle-kbd" aria-label="On-screen keyboard">
      {KEY_ROWS.map((row, i) => (
        <div key={i} className="linescordle-kbd-row">
          {row.map((k) => {
            const isWide = k === "ENTER" || k === "BACKSPACE";
            const state = keyState.get(k);
            const cls = [
              "linescordle-key",
              isWide ? "linescordle-key-wide" : "",
              state ? `linescordle-key-${state}` : "",
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

// ─── Autocomplete ─────────────────────────────────────────────────

function Suggestions({
  current, guesses, nameLength, onPick,
}: {
  current: string;
  guesses: Guess[];
  nameLength: number;
  onPick: (name: string) => void;
}) {
  // Derive greens + yellows from the guess history. Greens are
  // position-locked; yellows just need to appear somewhere. The
  // computation is cheap; memoized so we don't rebuild on every
  // keystroke into `current`.
  const constraints = useMemo(() => {
    const greens: Array<[number, string]> = [];
    const yellowSet = new Set<string>();
    for (const g of guesses) {
      for (let i = 0; i < g.letters.length; i++) {
        const L = g.letters[i]!;
        const S = g.scores[i]!;
        if (S === "green")  greens.push([i, L]);
        if (S === "yellow") yellowSet.add(L);
      }
    }
    return { greens, yellows: Array.from(yellowSet) };
  }, [guesses]);

  const [results, setResults]   = useState<string[]>([]);
  const [pending, setPending]   = useState(false);

  // Debounced fetch: trail keystrokes by 150ms before hitting the
  // server. Constraints (greens/yellows) trigger a re-fetch
  // immediately on guess commit, since they only change once per
  // submitted row.
  useEffect(() => {
    // Don't bother showing suggestions until the user is at least
    // partly committed: two letters typed, or any constraint from a
    // prior guess. Avoids dumping 30 random names on a blank input.
    if (current.length < 2 && constraints.greens.length === 0 && constraints.yellows.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setPending(true);
    const t = setTimeout(() => {
      searchPlayers({
        query:      current,
        nameLength,
        greens:     constraints.greens,
        yellows:    constraints.yellows,
        exclude:    guesses.map((g) => g.letters.join("")),
      })
        .then((r) => { if (!cancelled) { setResults(r); setPending(false); } })
        .catch((e) => { console.error("searchPlayers:", e); if (!cancelled) setPending(false); });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [current, constraints, nameLength, guesses]);

  if (results.length === 0 && !pending) return null;

  return (
    <div className="linescordle-suggestions" role="listbox" aria-label="Player suggestions">
      {results.map((name, i) => (
        // Index suffix on the key as a safety belt: even if the source
        // index ever returns two entries with the same display string,
        // React still gets unique keys instead of throwing.
        <button
          key={`${name}|${i}`}
          type="button"
          className="linescordle-suggestion"
          onClick={() => onPick(normalize(name))}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

// ─── Help modal ───────────────────────────────────────────────────

function HelpModal({ onClose, maxGuesses }: { onClose: () => void; maxGuesses: number }) {
  // Lock body scroll while open and close on Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="linescordle-modal-backdrop" onClick={onClose}>
      <div className="linescordle-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="How to play">
        <button type="button" className="linescordle-modal-close" onClick={onClose} aria-label="Close">×</button>
        <h3>How to play</h3>
        <ul>
          <li>Guess the MLB player in <b>{maxGuesses} tries</b>.</li>
          <li>Type the player&rsquo;s first and last name with <b>no spaces</b> (e.g. PEDROMARTINEZ).</li>
          <li>Suffixes count: type JR, SR, or II as part of the name (e.g. KENGRIFFEYJR).</li>
          <li>
            <span style={{ display: "inline-block", width: 10, height: 10, background: "#4d8a4d", verticalAlign: "middle", marginRight: 4 }} />
            green = correct letter, correct spot.{" "}
            <span style={{ display: "inline-block", width: 10, height: 10, background: "#c4a23f", verticalAlign: "middle", marginRight: 4, marginLeft: 8 }} />
            yellow = right letter, wrong spot.{" "}
            <span style={{ display: "inline-block", width: 10, height: 10, background: "#7a7a7a", verticalAlign: "middle", marginRight: 4, marginLeft: 8 }} />
            gray = not in the name.
          </li>
        </ul>
      </div>
    </div>
  );
}

// ─── Reveal ───────────────────────────────────────────────────────

function Reveal({
  puzzle, status, guesses, hintsUsed, reveal, playedOn,
}: {
  puzzle: LinescordlePuzzlePublic;
  status: GameStatus;
  guesses: Guess[];
  hintsUsed: number;
  reveal: RevealPayload | null;
  playedOn: string;
}) {
  const guessCount = guesses.length;
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const text = buildShareText({
      puzzleDate: playedOn,
      solved: status === "won",
      guesses: guesses.map((g) => ({ scores: g.scores })),
      maxGuesses: MAX_GUESSES,
      hintsUsed,
      shareUrl: SHARE_URL,
    });
    // Mobile (pointer: coarse) gets the native share sheet so the user
    // can pick iMessage / Twitter / etc directly. Desktop falls back
    // to clipboard, matching the prior behavior. Feature-detect the
    // share API too — if it's missing we always copy.
    const isMobile = typeof window !== "undefined"
      && window.matchMedia?.("(pointer: coarse)").matches;
    if (isMobile && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        // User dismissed the share sheet, or share failed. Fall through
        // to clipboard so the result isn't lost.
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your result:", text);
    }
  };

  const hintLabel = hintsUsed === 0
    ? ""
    : `${hintsUsed} ${hintsUsed === 1 ? "hint" : "hints"} used`;

  // Suppress puzzle reference for now — we only show line.kind below
  // for the loading-state role guess. The reveal payload, once it
  // arrives, replaces both name and the role line.
  const lineKind = puzzle.line.kind;
  const loadingRole = lineKind === "pitching" ? "Pitcher" : "Batter";

  return (
    <section className={`linescordle-reveal linescordle-reveal-${status}`}>
      <div className="linescordle-reveal-status">
        {status === "won"
          ? `Solved in ${guessCount} / ${MAX_GUESSES}`
          : `Out of guesses`}
        {hintLabel ? ` · ${hintLabel}` : ""}
      </div>

      <button
        type="button"
        className="linescordle-share-btn"
        onClick={onShare}
      >
        {copied ? "Copied!" : "Share result"}
      </button>

      {reveal ? (
        <>
          <div className="linescordle-reveal-name">{reveal.displayName}</div>
          <div className="linescordle-reveal-meta">
            {reveal.role}
            {reveal.era ? ` · ${reveal.era}` : ""}
            {reveal.handed ? ` · ${reveal.handed}` : ""}
          </div>
        </>
      ) : (
        <>
          <div className="linescordle-reveal-name" style={{ opacity: 0.4 }}>Loading…</div>
          <div className="linescordle-reveal-meta">{loadingRole}</div>
        </>
      )}

      {reveal ? (
        <>
          <div className="linescordle-reveal-section">
            <h3 className="linescordle-reveal-h">Career</h3>
            <div dangerouslySetInnerHTML={{ __html: reveal.careerHtml }} />
          </div>
          {reveal.boxScoreHtml ? (
            <div className="linescordle-reveal-section">
              <h3 className="linescordle-reveal-h">
                <span>This game</span>
                <span className="linescordle-reveal-h-date">{formatGameDate(puzzle.line.date)}</span>
              </h3>
              <div className="linescordle-reveal-box" dangerouslySetInnerHTML={{ __html: reveal.boxScoreHtml }} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

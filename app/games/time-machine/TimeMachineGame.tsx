"use client";

// Time Machine — client UI. The boxscore is shown above the grid during
// play so the user can study it while guessing; once the run ends, the
// box collapses into a <details> accordion inside the end screen.
//
// Guesses render as a 6×4 Wordle-style grid: each row is four boxes for
// the digits 0-9 with a small ▲/▼/✓ next to it. The active row IS the
// editable inputs, styled to match the static cells — so the four
// inputs read as the next row of boxes. Boxes behave as one text input:
// digit advances, backspace retreats, arrows nav, paste fills, Enter
// submits.
//
// Streaks are localStorage-only — no server-side daily streak tracking
// in v1. lastAppliedOn guards against double-counting when the user
// revisits a finished puzzle later the same day.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useResetAtMidnightET } from "@/lib/games/use-reset-at-midnight-et";
import { prevDay } from "@/lib/dates";
import {
  MAX_GUESSES,
  MIN_YEAR,
  type Guess,
  type PersistedAttempt,
  type PublicGame,
} from "./types";
import { scoreGuess, persistAttempt } from "./actions";

const LS_ATTEMPT_PREFIX = "time-machine:";
const LS_STREAK_KEY     = "time-machine:streak";

// ─── Persisted attempt ───────────────────────────────────────────

function loadLocal(date: string): PersistedAttempt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_ATTEMPT_PREFIX + date);
    return raw ? (JSON.parse(raw) as PersistedAttempt) : null;
  } catch { return null; }
}
function saveLocal(date: string, a: PersistedAttempt): void {
  try { window.localStorage.setItem(LS_ATTEMPT_PREFIX + date, JSON.stringify(a)); }
  catch { /* ignore quota / private mode */ }
}

// ─── Streak ──────────────────────────────────────────────────────

type Streak = {
  current:       number;
  best:          number;
  lastWonOn:     string | null;
  lastAppliedOn: string | null;
};
const DEFAULT_STREAK: Streak = {
  current: 0, best: 0, lastWonOn: null, lastAppliedOn: null,
};

function loadStreak(): Streak {
  if (typeof window === "undefined") return DEFAULT_STREAK;
  try {
    const raw = window.localStorage.getItem(LS_STREAK_KEY);
    return raw ? { ...DEFAULT_STREAK, ...(JSON.parse(raw) as Partial<Streak>) } : DEFAULT_STREAK;
  } catch { return DEFAULT_STREAK; }
}
function saveStreak(s: Streak): void {
  try { window.localStorage.setItem(LS_STREAK_KEY, JSON.stringify(s)); }
  catch { /* ignore */ }
}

/** Apply a game-end to the streak. Idempotent — calling repeatedly with
 * the same playedOn is a no-op past the first call. */
function applyEndToStreak(playedOn: string, won: boolean): Streak {
  const s = loadStreak();
  if (s.lastAppliedOn === playedOn) return s;
  let next: Streak;
  if (won) {
    const yesterday  = prevDay(playedOn);
    const newCurrent = s.lastWonOn === yesterday ? s.current + 1 : 1;
    next = {
      current:       newCurrent,
      best:          Math.max(s.best, newCurrent),
      lastWonOn:     playedOn,
      lastAppliedOn: playedOn,
    };
  } else {
    next = { ...s, current: 0, lastAppliedOn: playedOn };
  }
  saveStreak(next);
  return next;
}

// ─── Main component ──────────────────────────────────────────────

export function TimeMachineGame({
  playedOn, isAuthed, game, initialAttempt,
}: {
  playedOn:       string;
  isAuthed:       boolean;
  game:           PublicGame;
  initialAttempt: PersistedAttempt | null;
}) {
  useResetAtMidnightET(playedOn);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const hydrated = initialAttempt ?? loadLocal(playedOn) ?? null;

  const [guesses,    setGuesses]    = useState<Guess[]>(hydrated?.guesses    ?? []);
  const [ended,      setEnded]      = useState<boolean>(hydrated?.ended      ?? false);
  const [answerYear, setAnswerYear] = useState<number | null>(hydrated?.answerYear ?? null);
  const [digits,     setDigits]     = useState<string[]>(["", "", "", ""]);
  const [busy,       setBusy]       = useState<boolean>(false);
  const [streak,     setStreak]     = useState<Streak>(() => loadStreak());

  const inputRefs = useRef<Array<HTMLInputElement | null>>([null, null, null, null]);

  // Persist + sync to server on every state change.
  useEffect(() => {
    const blob: PersistedAttempt = {
      guesses, ended,
      ...(answerYear != null ? { answerYear } : {}),
    };
    saveLocal(playedOn, blob);
    if (isAuthed) {
      void persistAttempt({ playedOn, guesses, ended })
        .catch((e) => console.error("persistAttempt:", e));
    }
  }, [guesses, ended, answerYear, playedOn, isAuthed]);

  // Apply streak update once when the run ends.
  useEffect(() => {
    if (!ended) return;
    const won = guesses.at(-1)?.hint === "correct";
    setStreak(applyEndToStreak(playedOn, won));
  }, [ended, guesses, playedOn]);

  // Keep the active digit focused.
  useEffect(() => {
    if (ended) return;
    const i = digits.findIndex((d) => d === "");
    inputRefs.current[i >= 0 ? i : 0]?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, guesses.length]);

  const yearString  = digits.join("");
  const yearNum     = Number(yearString);
  const isValidYear = digits.every((d) => /^\d$/.test(d))
                   && yearNum >= MIN_YEAR
                   && yearNum <= currentYear;

  const onSubmit = useCallback(async () => {
    if (busy || ended || !isValidYear) return;
    setBusy(true);
    try {
      const res = await scoreGuess({
        playedOn,
        year:        yearNum,
        guessNumber: guesses.length + 1,
      });
      const nextGuess: Guess = { year: yearNum, hint: res.hint };
      const nextGuesses     = [...guesses, nextGuess];
      const isEnd           = res.hint === "correct" || nextGuesses.length >= MAX_GUESSES;
      setGuesses(nextGuesses);
      setEnded(isEnd);
      setDigits(["", "", "", ""]);
      if (res.answerYear != null) setAnswerYear(res.answerYear);
    } catch (e) {
      console.error("scoreGuess:", e);
    } finally {
      setBusy(false);
    }
  }, [busy, ended, isValidYear, playedOn, yearNum, guesses]);

  const onDigitChange = (i: number, raw: string) => {
    if (ended) return;
    const clean = raw.replace(/\D/g, "");
    if (clean.length === 0) {
      const next = [...digits]; next[i] = ""; setDigits(next);
      return;
    }
    if (clean.length > 1) {
      const next = [...digits];
      let idx = i;
      for (const c of clean) {
        if (idx > 3) break;
        next[idx] = c;
        idx++;
      }
      setDigits(next);
      inputRefs.current[Math.min(idx, 3)]?.focus();
      return;
    }
    const next = [...digits]; next[i] = clean; setDigits(next);
    if (i < 3) inputRefs.current[i + 1]?.focus();
  };

  const onDigitKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ended) return;
    if (e.key === "Backspace") {
      if (digits[i] === "" && i > 0) {
        const next = [...digits]; next[i - 1] = ""; setDigits(next);
        inputRefs.current[i - 1]?.focus();
        e.preventDefault();
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      inputRefs.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && i < 3) {
      inputRefs.current[i + 1]?.focus();
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (isValidYear) void onSubmit();
    }
  };

  const won           = guesses.at(-1)?.hint === "correct";
  const activeRowIdx  = ended ? -1 : guesses.length;

  return (
    <section className="tm">
      {/* Boxscore: visible above the grid during play. After the game
         ends it disappears here and re-appears inside the end-screen
         accordion. */}
      {!ended ? (
        <div
          className="tm-box"
          dangerouslySetInnerHTML={{ __html: game.boxHtml }}
        />
      ) : null}

      {/* 6×4 grid */}
      <ol className="tm-grid" aria-label="Year guesses">
        {Array.from({ length: MAX_GUESSES }).map((_, rowIdx) => {
          if (rowIdx < guesses.length) {
            const g = guesses[rowIdx]!;
            const ds = String(g.year).padStart(4, "0").split("");
            return (
              <li key={rowIdx} className="tm-row">
                <span className="tm-row-spacer" aria-hidden="true" />
                {ds.map((d, i) => (
                  <span key={i} className="tm-cell tm-cell-filled">{d}</span>
                ))}
                <HintIcon hint={g.hint} />
              </li>
            );
          }
          if (rowIdx === activeRowIdx) {
            return (
              <li key={rowIdx} className="tm-row tm-row-active">
                <span className="tm-row-spacer" aria-hidden="true" />
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    className={`tm-cell tm-cell-input${d ? " tm-cell-filled" : ""}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]"
                    maxLength={1}
                    autoComplete="off"
                    value={d}
                    onChange={(e) => onDigitChange(i, e.target.value)}
                    onKeyDown={(e) => onDigitKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                    aria-label={`Year digit ${i + 1}`}
                    disabled={busy}
                  />
                ))}
                <span className="tm-hint" aria-hidden="true" />
              </li>
            );
          }
          return (
            <li key={rowIdx} className="tm-row">
              <span className="tm-row-spacer" aria-hidden="true" />
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="tm-cell tm-cell-empty" />
              ))}
              <span className="tm-hint" aria-hidden="true" />
            </li>
          );
        })}
      </ol>

      {!ended ? (
        <div className="tm-submit-row">
          <button
            type="button"
            className="tm-submit"
            onClick={onSubmit}
            disabled={!isValidYear || busy}
          >
            {busy ? "…" : "Guess"}
          </button>
        </div>
      ) : null}

      {ended ? (
        <EndScreen
          playedOn={playedOn}
          won={won}
          guesses={guesses}
          answerYear={answerYear}
          game={game}
          streak={streak}
        />
      ) : null}
    </section>
  );
}

// ─── Hint icon ───────────────────────────────────────────────────

function HintIcon({ hint }: { hint: Guess["hint"] }) {
  const glyph = hint === "correct" ? "✓" : hint === "higher" ? "▲" : "▼";
  const label = hint === "correct"
    ? "correct"
    : hint === "higher" ? "answer is higher" : "answer is lower";
  return (
    <span className={`tm-hint tm-hint-${hint}`} aria-label={label} title={label}>
      {glyph}
    </span>
  );
}

// ─── End screen ──────────────────────────────────────────────────

function EndScreen({
  playedOn, won, guesses, answerYear, game, streak,
}: {
  playedOn:   string;
  won:        boolean;
  guesses:    Guess[];
  answerYear: number | null;
  game:       PublicGame;
  streak:     Streak;
}) {
  const [copied, setCopied] = useState(false);

  const cellFor = (h: Guess["hint"]): string =>
    h === "correct" ? "🟩" : h === "higher" ? "🟥⬆️" : "🟥⬇️";
  const grid    = guesses.map((g) => cellFor(g.hint)).join("\n");
  const score   = won ? `${guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;

  const shareText = useMemo(() => [
    `Time Machine (${playedOn})`,
    `${score}${won ? " ✨" : ""}`,
    ``,
    grid,
    ``,
    `https://boxscore.email/games/time-machine`,
  ].join("\n"), [playedOn, score, grid, won]);

  const onShare = async () => {
    const isMobile = typeof window !== "undefined"
      && window.matchMedia?.("(pointer: coarse)").matches;
    if (isMobile && typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ text: shareText }); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; }
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareText);
      } else {
        const ta = document.createElement("textarea");
        ta.value = shareText;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your result:", shareText);
    }
  };

  return (
    <section className="tm-end">
      <div className="tm-end-status">
        {won ? "Solved!" : "Out of guesses"}
      </div>
      {answerYear != null ? (
        <div className="tm-end-answer">
          The answer was <b>{answerYear}</b>.
        </div>
      ) : null}
      <div className="tm-end-meta">
        {game.awayName} {game.awayScore} @ {game.homeName} {game.homeScore}
      </div>

      <div className="tm-end-stats">
        <div className="tm-end-stat">
          <div className="tm-end-stat-num">{score}</div>
          <div className="tm-end-stat-label">Today</div>
        </div>
        <div className="tm-end-stat">
          <div className="tm-end-stat-num">{streak.current}</div>
          <div className="tm-end-stat-label">Current streak</div>
        </div>
        <div className="tm-end-stat">
          <div className="tm-end-stat-num">{streak.best}</div>
          <div className="tm-end-stat-label">Best streak</div>
        </div>
      </div>

      <pre className="tm-end-grid">{grid}</pre>

      <button type="button" className="tm-end-share" onClick={onShare}>
        {copied ? "Copied!" : "Share result"}
      </button>

      <details className="tm-end-box-toggle">
        <summary>Show box score</summary>
        <div
          className="tm-box tm-box-revealed"
          dangerouslySetInnerHTML={{ __html: game.boxHtml }}
        />
      </details>

      <p className="tm-end-tomorrow">
        New game tomorrow. Resets at midnight ET.
      </p>
    </section>
  );
}

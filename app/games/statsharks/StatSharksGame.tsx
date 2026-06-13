"use client";

// Stat Sharks game UI. Mirrors Linescordle's client-owned state +
// stateless server actions pattern: the client tracks the full run
// (rounds + current pair), persists to localStorage on every change,
// and additionally syncs to puzzle_attempts when the subscriber is
// signed in. The server scores picks and supplies pairs but holds no
// session state.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPair,
  scorePair,
  persistAttempt,
  type PublicPair,
  type PersistedAttempt,
  type PersistedRound,
} from "./actions";
import { STATS, formatStatValue, type StatDef, type StatKey } from "@/lib/games/statsharks/stats";

const TIMER_SEC = 30;
const REVEAL_MS = 1400;

// ─── Local persistence ───────────────────────────────────────────

type LocalState = {
  date:    string;            // YYYY-MM-DD
  stat:    StatKey;
  rounds:  PersistedRound[];  // completed history
  ended:   boolean;
};

function localKey(date: string): string { return `statsharks:attempt:${date}`; }

function loadLocal(date: string): LocalState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(localKey(date));
    if (!raw) return null;
    return JSON.parse(raw) as LocalState;
  } catch {
    return null;
  }
}

function saveLocal(state: LocalState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localKey(state.date), JSON.stringify(state));
  } catch {
    // QuotaExceeded etc — silently fail; the server copy (for authed)
    // is canonical anyway.
  }
}

// ─── Component ───────────────────────────────────────────────────

export function StatSharksGame({
  statKey, playedOn, isAuthed, initialAttempt, initialPair,
}: {
  statKey:         StatKey;
  playedOn:        string;
  isAuthed:        boolean;
  initialAttempt:  PersistedAttempt | null;
  initialPair:     PublicPair | null;
}) {
  const stat: StatDef = STATS[statKey];

  // Resolve initial state: server attempt (authed) takes precedence
  // over localStorage; if neither, start fresh with the server-supplied
  // first pair.
  const initial = useMemo<{ rounds: PersistedRound[]; ended: boolean; pair: PublicPair | null }>(() => {
    if (initialAttempt) {
      return {
        rounds: initialAttempt.rounds,
        ended:  initialAttempt.ended,
        // If server attempt is not ended, initialPair is the next pair
        pair: initialAttempt.ended ? null : initialPair,
      };
    }
    const local = loadLocal(playedOn);
    if (local && local.stat === statKey) {
      return {
        rounds: local.rounds,
        ended:  local.ended,
        pair:   local.ended ? null : initialPair,
      };
    }
    return { rounds: [], ended: false, pair: initialPair };
  }, [initialAttempt, initialPair, playedOn, statKey]);

  const [rounds, setRounds] = useState<PersistedRound[]>(initial.rounds);
  const [ended, setEnded] = useState<boolean>(initial.ended);
  const [pair, setPair] = useState<PublicPair | null>(initial.pair);
  const [reveal, setReveal] = useState<{
    leftValue: number; rightValue: number;
    correctSide: "left" | "right";
    pickedSide:  "left" | "right" | "timeout";
    wasCorrect:  boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SEC);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync to localStorage + server on any state change.
  useEffect(() => {
    const local: LocalState = { date: playedOn, stat: statKey, rounds, ended };
    saveLocal(local);
    if (isAuthed) {
      void persistAttempt({ playedOn, statKey, rounds, ended })
        .catch((e) => console.error("persistAttempt:", e));
    }
  }, [rounds, ended, isAuthed, playedOn, statKey]);

  // Restart the 30s timer whenever a new pair appears (and not during
  // reveal pause).
  useEffect(() => {
    if (ended || !pair || reveal) return;
    setSecondsLeft(TIMER_SEC);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [pair?.left.id, pair?.right.id, ended, reveal]);

  const usedIds = useMemo<number[]>(() => {
    const out: number[] = [];
    for (const r of rounds) { out.push(r.leftId, r.rightId); }
    if (pair) { out.push(pair.left.id, pair.right.id); }
    return out;
  }, [rounds, pair]);

  const doPick = useCallback(async (side: "left" | "right" | "timeout") => {
    if (pending || reveal || ended || !pair) return;
    setPending(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try {
      const score = await scorePair({
        statKey,
        leftId:     pair.left.id,
        rightId:    pair.right.id,
        pickedSide: side,
      });
      setReveal({ ...score, pickedSide: side });
      const newRound: PersistedRound = {
        leftId:     pair.left.id,
        rightId:    pair.right.id,
        pickedSide: side,
        wasCorrect: score.wasCorrect,
      };
      // After reveal pause: either advance to next pair or end the run.
      setTimeout(async () => {
        setReveal(null);
        const nextRounds = [...rounds, newRound];
        if (!score.wasCorrect) {
          setRounds(nextRounds);
          setEnded(true);
          setPair(null);
          return;
        }
        try {
          const next = await getPair({
            statKey,
            round: nextRounds.length,
            usedPlayerSeasonIds: usedIds,
          });
          setRounds(nextRounds);
          if (!next) {
            setEnded(true);
            setPair(null);
          } else {
            setPair(next);
          }
        } catch (e) {
          console.error("getPair:", e);
          setRounds(nextRounds);
          setEnded(true);
          setPair(null);
        }
      }, REVEAL_MS);
    } catch (e) {
      console.error("scorePair:", e);
    } finally {
      setPending(false);
    }
  }, [pending, reveal, ended, pair, rounds, usedIds, statKey]);

  // Auto-submit timeout on countdown 0.
  useEffect(() => {
    if (secondsLeft !== 0) return;
    if (pending || reveal || !pair || ended) return;
    void doPick("timeout");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (ended) return;
      if (e.key === "ArrowLeft"  || e.key === "1") { e.preventDefault(); void doPick("left"); }
      if (e.key === "ArrowRight" || e.key === "2") { e.preventDefault(); void doPick("right"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doPick, ended]);

  if (ended) {
    return <EndScreen stat={stat} rounds={rounds} playedOn={playedOn} />;
  }

  if (!pair) {
    return <p className="statsharks-empty">No pair available right now — try again tomorrow.</p>;
  }

  const streak = rounds.filter((r) => r.wasCorrect).length;

  return (
    <section className="statsharks-game">
      <TopBar stat={stat} streak={streak} secondsLeft={secondsLeft} />
      <div className="statsharks-prompt">{stat.prompt}</div>
      <div className="statsharks-cards">
        <Card
          side="left"
          card={pair.left}
          reveal={reveal
            ? { value: reveal.leftValue,
                wasCorrectSide: reveal.correctSide === "left" }
            : null}
          stat={stat}
          onPick={() => void doPick("left")}
          disabled={!!reveal || pending}
        />
        <div className="statsharks-vs">vs</div>
        <Card
          side="right"
          card={pair.right}
          reveal={reveal
            ? { value: reveal.rightValue,
                wasCorrectSide: reveal.correctSide === "right" }
            : null}
          stat={stat}
          onPick={() => void doPick("right")}
          disabled={!!reveal || pending}
        />
      </div>
    </section>
  );
}

function TopBar({ stat, streak, secondsLeft }: {
  stat: StatDef; streak: number; secondsLeft: number;
}) {
  const timerLow = secondsLeft <= 5;
  return (
    <div className="statsharks-topbar">
      <div className="statsharks-streak">
        <span className="statsharks-streak-num">{streak}</span>
        <span className="statsharks-streak-label">STREAK</span>
      </div>
      <div className="statsharks-statname">{stat.label}</div>
      <div className={"statsharks-timer" + (timerLow ? " is-low" : "")}>
        <span className="statsharks-timer-num">{secondsLeft}</span>
        <span className="statsharks-timer-label">SEC</span>
      </div>
    </div>
  );
}

function Card({
  side, card, reveal, stat, onPick, disabled,
}: {
  side:  "left" | "right";
  card:  { player_name: string; season: number; team_abbr: string | null };
  reveal: { value: number; wasCorrectSide: boolean } | null;
  stat:  StatDef;
  onPick: () => void;
  disabled: boolean;
}) {
  const flipped = reveal !== null;
  const tone = !reveal ? "neutral"
    : reveal.wasCorrectSide ? "correct"
    : "wrong";
  return (
    <button
      type="button"
      className={`statsharks-card statsharks-card-${side} statsharks-card-${tone}` + (flipped ? " is-flipped" : "")}
      onClick={onPick}
      disabled={disabled}
      aria-label={`Pick ${card.player_name}, ${card.season}`}
    >
      <div className="statsharks-card-name">{card.player_name}</div>
      <div className="statsharks-card-meta">
        {card.season}{card.team_abbr ? ` · ${card.team_abbr}` : ""}
      </div>
      {reveal ? (
        <div className="statsharks-card-value">{formatStatValue(stat, reveal.value)}</div>
      ) : (
        <div className="statsharks-card-value statsharks-card-value-hidden">?</div>
      )}
    </button>
  );
}

function EndScreen({ stat, rounds, playedOn }: {
  stat: StatDef; rounds: PersistedRound[]; playedOn: string;
}) {
  const [copied, setCopied] = useState(false);
  const streak = rounds.filter((r) => r.wasCorrect).length;
  const grid = rounds.map((r) => r.wasCorrect ? "🟢" : "🔴").join("");
  const shareText = useMemo(() => {
    return [
      `Boxscore Stat Sharks — ${playedOn}`,
      `Today: ${stat.label}`,
      ``,
      `Streak: ${streak}`,
      grid,
      ``,
      `boxscore.games/statsharks`,
    ].join("\n");
  }, [stat.label, streak, grid, playedOn]);

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
    <section className="statsharks-end">
      <div className="statsharks-end-status">
        {streak === 0 ? "Tough start." : `Streak: ${streak}`}
      </div>
      <div className="statsharks-end-stat">Today: <b>{stat.label}</b></div>
      <pre className="statsharks-end-grid">{grid}</pre>
      <button
        type="button"
        className="statsharks-share-btn"
        onClick={onShare}
      >
        {copied ? "Copied!" : "Share result"}
      </button>
      <p className="statsharks-end-tomorrow">
        New stat tomorrow. Come back at midnight ET.
      </p>
    </section>
  );
}

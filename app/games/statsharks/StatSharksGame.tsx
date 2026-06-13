"use client";

// Stat Sharks game UI. Two cards, pick the better stat, build a
// streak. v1 daily mode only — anonymous play / free play land in a
// later pass. Mirrors Linescordle's client/server split: scoring +
// next-pair pickup all happen in the server action; the client just
// renders and routes user clicks.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { submitPick, type ClientState, type RoundReveal } from "./actions";
import { formatStatValue, type StatDef } from "@/lib/games/statsharks/stats";

const TIMER_SEC = 30;

// Reveal pause before the next pair shows. Long enough to read the
// numbers but short enough that a confident player on a streak still
// feels momentum.
const REVEAL_MS = 1400;

export function StatSharksGame({ initial }: { initial: ClientState }) {
  const [state, setState] = useState<ClientState>(initial);
  const [pending, setPending] = useState(false);
  const [reveal, setReveal] = useState<RoundReveal | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SEC);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset the timer whenever a new pair appears.
  useEffect(() => {
    if (state.status !== "playing" || !state.currentPair) return;
    if (reveal) return;       // don't run timer during reveal pause
    setSecondsLeft(TIMER_SEC);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [state.currentPair?.roundIndex, state.status, reveal]);

  // Auto-submit timeout when the clock hits 0. Counts as wrong, ends
  // the run.
  useEffect(() => {
    if (secondsLeft !== 0) return;
    if (pending || reveal || !state.currentPair) return;
    void doPick("timeout");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const doPick = useCallback(async (side: "left" | "right" | "timeout") => {
    if (pending || reveal || state.status !== "playing" || !state.currentPair) return;
    setPending(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try {
      const { reveal: r, next } = await submitPick({
        roundIndex: state.currentPair.roundIndex,
        pickedSide: side,
      });
      setReveal(r);
      // Hold the reveal, then move to next state.
      setTimeout(() => {
        setReveal(null);
        setState(next);
      }, REVEAL_MS);
    } catch (e) {
      console.error("submitPick:", e);
    } finally {
      setPending(false);
    }
  }, [pending, reveal, state]);

  // Keyboard: left / right arrows + 1/2 for pair selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (state.status !== "playing") return;
      if (e.key === "ArrowLeft" || e.key === "1") { e.preventDefault(); void doPick("left"); }
      if (e.key === "ArrowRight" || e.key === "2") { e.preventDefault(); void doPick("right"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doPick, state.status]);

  if (state.status === "ended") {
    return <EndScreen state={state} />;
  }

  const pair = state.currentPair;
  if (!pair) {
    return <p className="statsharks-empty">No pair available right now — try again tomorrow.</p>;
  }

  return (
    <section className="statsharks-game">
      <TopBar stat={state.stat} streak={state.streak} secondsLeft={secondsLeft} />

      <div className="statsharks-prompt">{state.stat.prompt}</div>

      <div className="statsharks-cards">
        <Card
          side="left"
          card={pair.left}
          reveal={reveal && reveal.roundIndex === pair.roundIndex
            ? { value: reveal.leftStat,  picked: reveal.pickedSide === "left",
                wasCorrectSide: reveal.correctSide === "left",
                wasCorrectPick: reveal.wasCorrect && reveal.pickedSide === "left" }
            : null}
          stat={state.stat}
          onPick={() => void doPick("left")}
          disabled={!!reveal || pending}
        />
        <div className="statsharks-vs">vs</div>
        <Card
          side="right"
          card={pair.right}
          reveal={reveal && reveal.roundIndex === pair.roundIndex
            ? { value: reveal.rightStat, picked: reveal.pickedSide === "right",
                wasCorrectSide: reveal.correctSide === "right",
                wasCorrectPick: reveal.wasCorrect && reveal.pickedSide === "right" }
            : null}
          stat={state.stat}
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

type CardReveal = {
  value:          number;
  picked:         boolean;
  wasCorrectSide: boolean;
  wasCorrectPick: boolean;
};

function Card({
  side, card, reveal, stat, onPick, disabled,
}: {
  side:  "left" | "right";
  card:  { player_name: string; season: number; team_abbr: string | null };
  reveal: CardReveal | null;
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

function EndScreen({ state }: { state: ClientState }) {
  const [copied, setCopied] = useState(false);

  const shareText = useMemo(() => buildShareText(state), [state]);

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

  const grid = state.rounds.map((r) => r.wasCorrect ? "🟢" : "🔴").join("");

  return (
    <section className="statsharks-end">
      <div className="statsharks-end-status">
        {state.finalStreak === 0 ? "Tough start." : `Streak: ${state.finalStreak}`}
      </div>
      <div className="statsharks-end-stat">Today: <b>{state.stat.label}</b></div>
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

function buildShareText(state: ClientState): string {
  const grid = state.rounds.map((r) => r.wasCorrect ? "🟢" : "🔴").join("");
  const lines = [
    `Boxscore Stat Sharks — ${state.playedOn}`,
    `Today: ${state.stat.label}`,
    ``,
    `Streak: ${state.finalStreak}`,
    grid,
    ``,
    `boxscore.games/statsharks`,
  ];
  return lines.join("\n");
}

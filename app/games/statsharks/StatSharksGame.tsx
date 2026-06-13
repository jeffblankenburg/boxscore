"use client";

// Stat Sharks game UI. Mirrors Linescordle's client-owned state +
// stateless server actions pattern: the client tracks the full run
// (rounds + current pair), persists to localStorage on every change,
// and additionally syncs to puzzle_attempts when the subscriber is
// signed in. The server scores picks and supplies pairs but holds no
// session state.
//
// Two modes: Daily (one play per day, server-synced for authed) and
// Endless (unlimited replays with today's stat, local-only, tracks
// today's best streak).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPair,
  scorePair,
  persistAttempt,
  type PublicPair,
  type PersistedAttempt,
  type PersistedRound,
} from "./actions";
import { STATS, VISIBLE_STATS, formatStatValue, type StatDef, type StatKey } from "@/lib/games/statsharks/stats";

const TIMER_SEC = 30;
const REVEAL_MS = 1400;
const FLIGHT_MS = 700;
// Flying dot launches so it lands exactly when REVEAL_MS expires —
// i.e. right when the cards would be cleared for the next round.
const FLIGHT_DELAY_MS = REVEAL_MS - FLIGHT_MS;

type Mode = "daily" | "endless";

// ─── Local persistence ───────────────────────────────────────────

type LocalDaily = {
  date:    string;
  stat:    StatKey;
  rounds:  PersistedRound[];
  ended:   boolean;
};

const dailyKey   = (date: string) => `statsharks:attempt:${date}`;
const bestKey    = (date: string, stat: StatKey) => `statsharks:best-endless:${date}:${stat}`;
const lifetimeKey = (stat: StatKey) => `statsharks:lifetime-endless:${stat}`;

function loadDailyLocal(date: string): LocalDaily | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(dailyKey(date));
    return raw ? JSON.parse(raw) as LocalDaily : null;
  } catch { return null; }
}

function saveDailyLocal(s: LocalDaily): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(dailyKey(s.date), JSON.stringify(s)); } catch { /* quota */ }
}

function loadBestEndless(date: string, stat: StatKey): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(bestKey(date, stat));
    return raw ? Number(raw) || 0 : 0;
  } catch { return 0; }
}

function saveBestEndless(date: string, stat: StatKey, streak: number): void {
  if (typeof window === "undefined") return;
  try {
    const prev = loadBestEndless(date, stat);
    if (streak > prev) window.localStorage.setItem(bestKey(date, stat), String(streak));
  } catch { /* quota */ }
}

function loadLifetimeEndless(stat: StatKey): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(lifetimeKey(stat));
    return raw ? Number(raw) || 0 : 0;
  } catch { return 0; }
}

function saveLifetimeEndless(stat: StatKey, streak: number): void {
  if (typeof window === "undefined") return;
  try {
    const prev = loadLifetimeEndless(stat);
    if (streak > prev) window.localStorage.setItem(lifetimeKey(stat), String(streak));
  } catch { /* quota */ }
}

// ─── Top-level ───────────────────────────────────────────────────

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
  const [mode, setMode] = useState<Mode>("daily");

  return (
    <>
      <nav className="statsharks-tabs" role="tablist">
        <button
          type="button"
          className={"statsharks-tab" + (mode === "daily" ? " is-active" : "")}
          role="tab"
          aria-selected={mode === "daily"}
          onClick={() => setMode("daily")}
        >
          Daily
        </button>
        <button
          type="button"
          className={"statsharks-tab" + (mode === "endless" ? " is-active" : "")}
          role="tab"
          aria-selected={mode === "endless"}
          onClick={() => setMode("endless")}
        >
          Endless
        </button>
      </nav>
      {mode === "daily" ? (
        <DailyRun
          stat={stat} statKey={statKey} playedOn={playedOn} isAuthed={isAuthed}
          initialAttempt={initialAttempt} initialPair={initialPair}
        />
      ) : (
        <EndlessRun stat={stat} statKey={statKey} playedOn={playedOn} />
      )}
    </>
  );
}

// ─── Daily mode ──────────────────────────────────────────────────

function DailyRun({
  stat, statKey, playedOn, isAuthed, initialAttempt, initialPair,
}: {
  stat: StatDef;
  statKey: StatKey;
  playedOn: string;
  isAuthed: boolean;
  initialAttempt: PersistedAttempt | null;
  initialPair: PublicPair | null;
}) {
  const initial = useMemo<{ rounds: PersistedRound[]; ended: boolean; pair: PublicPair | null }>(() => {
    if (initialAttempt) {
      return {
        rounds: initialAttempt.rounds,
        ended:  initialAttempt.ended,
        pair:   initialAttempt.ended ? null : initialPair,
      };
    }
    const local = loadDailyLocal(playedOn);
    if (local && local.stat === statKey) {
      return {
        rounds: local.rounds,
        ended:  local.ended,
        pair:   local.ended ? null : initialPair,
      };
    }
    return { rounds: [], ended: false, pair: initialPair };
  }, [initialAttempt, initialPair, playedOn, statKey]);

  return (
    <RunView
      stat={stat} statKey={statKey} playedOn={playedOn}
      initialRounds={initial.rounds}
      initialEnded={initial.ended}
      initialPair={initial.pair}
      persist={(rounds, ended) => {
        saveDailyLocal({ date: playedOn, stat: statKey, rounds, ended });
        if (isAuthed) {
          void persistAttempt({ playedOn, statKey, rounds, ended })
            .catch((e) => console.error("persistAttempt:", e));
        }
      }}
      endVariant="daily"
    />
  );
}

// ─── Endless mode ────────────────────────────────────────────────

function EndlessRun({ statKey: todayKey, playedOn }: { stat: StatDef; statKey: StatKey; playedOn: string }) {
  // Endless lets the user pick the stat themselves — `selectedKey`
  // null = show the chooser; non-null = run that stat. The pre-fill
  // defaults to today's daily stat so a one-tap "start endless" works.
  const [selectedKey, setSelectedKey] = useState<StatKey | null>(null);
  const [runId, setRunId] = useState(0);

  if (!selectedKey) {
    return <StatChooser
      defaultKey={todayKey}
      playedOn={playedOn}
      onPick={(k) => { setSelectedKey(k); setRunId(0); }}
    />;
  }

  const stat = STATS[selectedKey];
  return (
    <EndlessRunForStat
      key={`${selectedKey}-${runId}`}
      stat={stat}
      statKey={selectedKey}
      playedOn={playedOn}
      onPlayAgain={() => setRunId((n) => n + 1)}
      onChooseDifferent={() => setSelectedKey(null)}
    />
  );
}

function EndlessRunForStat({
  stat, statKey, playedOn, onPlayAgain, onChooseDifferent,
}: {
  stat: StatDef;
  statKey: StatKey;
  playedOn: string;
  onPlayAgain: () => void;
  onChooseDifferent: () => void;
}) {
  const [bestToday, setBestToday] = useState<number>(() => loadBestEndless(playedOn, statKey));
  const [bestLifetime, setBestLifetime] = useState<number>(() => loadLifetimeEndless(statKey));
  return (
    <RunView
      stat={stat} statKey={statKey} playedOn={playedOn}
      initialRounds={[]}
      initialEnded={false}
      initialPair={null}
      persist={(rounds, ended) => {
        if (ended) {
          const streak = rounds.filter((r) => r.wasCorrect).length;
          saveBestEndless(playedOn, statKey, streak);
          saveLifetimeEndless(statKey, streak);
          setBestToday((prev) => (streak > prev ? streak : prev));
          setBestLifetime((prev) => (streak > prev ? streak : prev));
        }
      }}
      endVariant="endless"
      onPlayAgain={onPlayAgain}
      onChooseDifferent={onChooseDifferent}
      bestEndless={bestToday}
      bestLifetime={bestLifetime}
    />
  );
}

function StatChooser({
  defaultKey, playedOn, onPick,
}: {
  defaultKey: StatKey;
  playedOn: string;
  onPick: (k: StatKey) => void;
}) {
  // Show each stat as a chip with two best-streak numbers inline:
  // "today" (resets at midnight ET) on top, "all-time" lifetime best
  // underneath. Lifetime numbers give the user something to chase
  // across multiple days; today's number tells them how they've done
  // so far. The chooser only surfaces VISIBLE_STATS — the rest stay
  // hidden until we re-enable them centrally.
  const allKeys = VISIBLE_STATS;
  return (
    <section className="statsharks-chooser">
      <h3 className="statsharks-chooser-h">Pick your stat</h3>
      <p className="statsharks-chooser-sub">
        Same Card Sharks rules — build the longest streak. Practice runs don&rsquo;t affect today&rsquo;s daily score.
      </p>
      <div className="statsharks-chooser-grid">
        {allKeys.map((k) => {
          const s = STATS[k];
          const bestToday    = loadBestEndless(playedOn, k);
          const bestLifetime = loadLifetimeEndless(k);
          const isDefault = k === defaultKey;
          return (
            <button
              key={k}
              type="button"
              className={"statsharks-chooser-chip" + (isDefault ? " is-default" : "")}
              onClick={() => onPick(k)}
            >
              <span className="statsharks-chooser-chip-key">{k}</span>
              <span className="statsharks-chooser-chip-label">{s.label}</span>
              <span className="statsharks-chooser-chip-bests">
                {bestToday > 0
                  ? <span className="statsharks-chooser-chip-today">today {bestToday}</span>
                  : <span className="statsharks-chooser-chip-today-empty">today —</span>}
                {bestLifetime > 0
                  ? <span className="statsharks-chooser-chip-lifetime">best {bestLifetime}</span>
                  : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── Shared run view ─────────────────────────────────────────────

function RunView({
  stat, statKey, playedOn,
  initialRounds, initialEnded, initialPair,
  persist, endVariant, onPlayAgain, onChooseDifferent, bestEndless, bestLifetime,
}: {
  stat: StatDef;
  statKey: StatKey;
  playedOn: string;
  initialRounds: PersistedRound[];
  initialEnded:  boolean;
  initialPair:   PublicPair | null;
  persist:       (rounds: PersistedRound[], ended: boolean) => void;
  endVariant:    "daily" | "endless";
  onPlayAgain?:  () => void;
  onChooseDifferent?: () => void;
  bestEndless?:  number;
  bestLifetime?: number;
}) {
  const [rounds, setRounds]   = useState<PersistedRound[]>(initialRounds);
  const [ended, setEnded]     = useState<boolean>(initialEnded);
  const [pair, setPair]       = useState<PublicPair | null>(initialPair);
  // Pre-fetched next pair, so a correct answer can swap instantly
  // without a network roundtrip showing a loading state.
  const [nextPair, setNextPair] = useState<PublicPair | null>(null);
  const [reveal, setReveal]   = useState<{
    leftValue: number; rightValue: number;
    correctSide: "left" | "right";
    pickedSide:  "left" | "right" | "timeout";
    wasCorrect:  boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SEC);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs + state for the "dot flies from card to dots row" animation
  // when a round is scored correct.
  const leftCardRef  = useRef<HTMLButtonElement>(null);
  const rightCardRef = useRef<HTMLButtonElement>(null);
  const dotsRowRef   = useRef<HTMLDivElement>(null);
  const [flyingDot, setFlyingDot] = useState<{
    startX: number; startY: number; dx: number; dy: number; id: number;
  } | null>(null);

  const launchFlyingDot = useCallback((side: "left" | "right", nextSlotIndex: number) => {
    const cardEl = side === "left" ? leftCardRef.current : rightCardRef.current;
    const rowEl  = dotsRowRef.current;
    if (!cardEl || !rowEl) return;
    const cr = cardEl.getBoundingClientRect();
    const dotSize = 12;
    const gap     = 6;
    // Target = the left edge of the dots row + (slot * (dot + gap)) +
    // half the dot, vertically centered on the row.
    const rr = rowEl.getBoundingClientRect();
    const targetX = rr.left + nextSlotIndex * (dotSize + gap) + dotSize / 2;
    const targetY = rr.top + rr.height / 2;
    const startX = cr.left + cr.width / 2;
    const startY = cr.top + cr.height / 2;
    setFlyingDot({
      startX, startY,
      dx: targetX - startX,
      dy: targetY - startY,
      id: Date.now(),
    });
    // No timeout to clear here — clearing is intentionally batched
    // with setRounds at REVEAL_MS so the floating dot vanishes on the
    // exact frame the permanent dot mounts. (Two setTimeouts firing
    // at the same scheduled time become separate React batches, which
    // produces a one-frame flicker.)
  }, []);

  // Persist on any state change (daily only really uses this; endless
  // ignores in-flight saves and only records bests on end).
  useEffect(() => {
    persist(rounds, ended);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, ended]);

  // Endless / cold-start: if no initial pair was supplied, fetch one.
  useEffect(() => {
    if (pair || ended) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await getPair({
          statKey,
          round: 0,
          usedPlayerSeasonIds: [],
        });
        if (!cancelled) {
          if (next) setPair(next);
          else setEnded(true);
        }
      } catch (e) { console.error("getPair:", e); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fetch the NEXT pair as soon as the current one mounts so a
  // correct answer can swap in instantly. Doesn't fire if we already
  // have a pre-fetched pair (e.g. from the round before) or the run
  // is already over.
  useEffect(() => {
    if (!pair || ended || nextPair) return;
    let cancelled = false;
    const usedForNext: number[] = [];
    for (const r of rounds) usedForNext.push(r.leftId, r.rightId);
    usedForNext.push(pair.left.id, pair.right.id);
    void (async () => {
      try {
        const next = await getPair({
          statKey,
          round: rounds.length + 1,
          usedPlayerSeasonIds: usedForNext,
        });
        if (!cancelled && next) setNextPair(next);
      } catch (e) { console.error("prefetch getPair:", e); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair?.left.id, pair?.right.id]);

  // Timer.
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
      const nextSlotIndex = rounds.filter((r) => r.wasCorrect).length;

      // Dot-flight: launch from the picked card toward the next slot
      // in the dots row. Lands at exactly REVEAL_MS, the same moment
      // the permanent dot mounts and the cards swap to the next pair.
      // The flying dot stays at opacity 1 throughout — the unmount
      // and the permanent dot's mount happen on the same frame.
      if (score.wasCorrect && (side === "left" || side === "right")) {
        setTimeout(() => launchFlyingDot(side, nextSlotIndex), FLIGHT_DELAY_MS);
      }

      setTimeout(() => {
        setReveal(null);
        const nextRounds = [...rounds, newRound];
        if (!score.wasCorrect) {
          // Wrong path: mount the wrong-round in history (doesn't grow
          // the dot row since wasCorrect is false), end the run.
          setRounds(nextRounds);
          setFlyingDot(null);
          setEnded(true);
          setPair(null);
          return;
        }
        // Correct path: mount the new permanent dot (via setRounds) AT
        // the same instant we swap to the next pair AND unmount the
        // flying dot. All three setStates batch into one render so
        // the user never sees a frame without the dot.
        setRounds(nextRounds);
        setFlyingDot(null);
        if (nextPair) {
          setPair(nextPair);
          setNextPair(null);
        } else {
          // Fallback path. The pre-fetch effect will re-fire if pair
          // becomes null then non-null, but we need an immediate fetch
          // here so the user doesn't sit on a blank screen.
          const used = usedIds;
          setPair(null);  // shows loader briefly
          void (async () => {
            try {
              const next = await getPair({
                statKey,
                round: nextRounds.length,
                usedPlayerSeasonIds: used,
              });
              if (next) setPair(next);
              else { setEnded(true); setPair(null); }
            } catch (e) {
              console.error("fallback getPair:", e);
              setEnded(true);
              setPair(null);
            }
          })();
        }
      }, REVEAL_MS);
    } catch (e) {
      console.error("scorePair:", e);
    } finally {
      setPending(false);
    }
  }, [pending, reveal, ended, pair, rounds, usedIds, statKey, launchFlyingDot, nextPair]);

  useEffect(() => {
    if (secondsLeft !== 0) return;
    if (pending || reveal || !pair || ended) return;
    void doPick("timeout");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

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
    return (
      <EndScreen
        stat={stat} rounds={rounds} playedOn={playedOn}
        variant={endVariant}
        onPlayAgain={onPlayAgain}
        onChooseDifferent={onChooseDifferent}
        bestEndless={bestEndless}
        bestLifetime={bestLifetime}
      />
    );
  }
  if (!pair) {
    return <p className="statsharks-empty">Loading…</p>;
  }

  const streak = rounds.filter((r) => r.wasCorrect).length;
  return (
    <section className="statsharks-game">
      <TopBar stat={stat} streak={streak} secondsLeft={secondsLeft} />
      <div className="statsharks-dots" ref={dotsRowRef}>
        {Array.from({ length: streak }).map((_, i) => (
          <span key={i} className="statsharks-dot" />
        ))}
      </div>
      <div className="statsharks-prompt">{stat.prompt}</div>
      <div className="statsharks-cards">
        <Card
          side="left"
          card={pair.left}
          cardRef={leftCardRef}
          reveal={reveal
            ? { value: reveal.leftValue, wasCorrectSide: reveal.correctSide === "left" }
            : null}
          stat={stat}
          onPick={() => void doPick("left")}
          disabled={!!reveal || pending}
        />
        <div className="statsharks-vs">vs</div>
        <Card
          side="right"
          card={pair.right}
          cardRef={rightCardRef}
          reveal={reveal
            ? { value: reveal.rightValue, wasCorrectSide: reveal.correctSide === "right" }
            : null}
          stat={stat}
          onPick={() => void doPick("right")}
          disabled={!!reveal || pending}
        />
      </div>
      {flyingDot ? (
        <span
          key={flyingDot.id}
          className="statsharks-dot-flying"
          style={{
            left: flyingDot.startX - 6,
            top:  flyingDot.startY - 6,
            ["--dx" as keyof React.CSSProperties]: `${flyingDot.dx}px`,
            ["--dy" as keyof React.CSSProperties]: `${flyingDot.dy}px`,
          } as React.CSSProperties}
        />
      ) : null}
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

const Card = function Card({
  side, card, reveal, stat, onPick, disabled, cardRef,
}: {
  side:  "left" | "right";
  card:  { player_name: string; season: number; team_abbr: string | null };
  reveal: { value: number; wasCorrectSide: boolean } | null;
  stat:  StatDef;
  onPick: () => void;
  disabled: boolean;
  cardRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const flipped = reveal !== null;
  const tone = !reveal ? "neutral"
    : reveal.wasCorrectSide ? "correct"
    : "wrong";
  return (
    <button
      ref={cardRef}
      type="button"
      className={`statsharks-card statsharks-card-${side} statsharks-card-${tone}` + (flipped ? " is-flipped" : "")}
      onClick={onPick}
      disabled={disabled}
      aria-label={`Pick ${card.player_name}, ${card.season}`}
    >
      <div className="statsharks-card-name">{card.player_name}</div>
      <div className="statsharks-card-year">{card.season}</div>
      <div className="statsharks-card-team">{card.team_abbr ?? "—"}</div>
      {reveal ? (
        <div className="statsharks-card-value">{formatStatValue(stat, reveal.value)}</div>
      ) : (
        <div className="statsharks-card-value statsharks-card-value-hidden">?</div>
      )}
    </button>
  );
};

function EndScreen({
  stat, rounds, playedOn, variant, onPlayAgain, onChooseDifferent, bestEndless, bestLifetime,
}: {
  stat: StatDef;
  rounds: PersistedRound[];
  playedOn: string;
  variant: "daily" | "endless";
  onPlayAgain?: () => void;
  onChooseDifferent?: () => void;
  bestEndless?: number;
  bestLifetime?: number;
}) {
  const [copied, setCopied] = useState(false);
  const streak = rounds.filter((r) => r.wasCorrect).length;
  const grid = rounds.map((r) => r.wasCorrect ? "🟢" : "🔴").join("");
  const shareText = useMemo(() => {
    const headline = variant === "daily"
      ? `Boxscore Stat Sharks — ${playedOn}`
      : `Boxscore Stat Sharks (endless) — ${playedOn}`;
    return [
      headline,
      `Today: ${stat.label}`,
      ``,
      `Streak: ${streak}`,
      grid,
      ``,
      `boxscore.games/statsharks`,
    ].join("\n");
  }, [stat.label, streak, grid, playedOn, variant]);

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
      <div className="statsharks-end-stat">
        {variant === "daily" ? <>Today: <b>{stat.label}</b></> : <b>{stat.label}</b>}
      </div>
      {variant === "endless" ? (
        <div className="statsharks-end-best">
          {bestEndless != null && bestEndless > 0 ? <>Best today: <b>{bestEndless}</b></> : null}
          {bestEndless != null && bestEndless > 0 && bestLifetime != null && bestLifetime > 0 ? " · " : null}
          {bestLifetime != null && bestLifetime > 0 ? <>All-time best: <b>{bestLifetime}</b></> : null}
        </div>
      ) : null}
      <pre className="statsharks-end-grid">{grid}</pre>
      <div className="statsharks-end-actions">
        <button
          type="button"
          className="statsharks-share-btn"
          onClick={onShare}
        >
          {copied ? "Copied!" : "Share result"}
        </button>
        {variant === "endless" && onPlayAgain ? (
          <button
            type="button"
            className="statsharks-play-again-btn"
            onClick={onPlayAgain}
          >
            Play again
          </button>
        ) : null}
        {variant === "endless" && onChooseDifferent ? (
          <button
            type="button"
            className="statsharks-play-again-btn"
            onClick={onChooseDifferent}
          >
            Pick different stat
          </button>
        ) : null}
      </div>
      {variant === "daily" ? (
        <p className="statsharks-end-tomorrow">
          New stat tomorrow. Come back at midnight ET — or try Endless mode above.
        </p>
      ) : null}
    </section>
  );
}

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
  persistEndlessRun,
  getReviewData,
} from "./actions";
import {
  DAILY_ROUND_COUNT,
  type PublicPair,
  type DailyPublicPair,
  type PersistedAttempt,
  type PersistedRound,
  type ReviewRound,
} from "./types";
import { STATS, VISIBLE_STATS, formatStatValue, type StatDef, type StatKey } from "@/lib/games/statsharks/stats";
import { useResetAtMidnightET } from "@/lib/games/use-reset-at-midnight-et";

const TIMER_SEC = 15;
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
  statKey, playedOn, isAuthed, initialAttempt, dailySequence,
}: {
  statKey:         StatKey;
  playedOn:        string;
  isAuthed:        boolean;
  initialAttempt:  PersistedAttempt | null;
  dailySequence:   DailyPublicPair[];
}) {
  const stat: StatDef = STATS[statKey];
  const [mode, setMode] = useState<Mode>("daily");
  useResetAtMidnightET(playedOn);

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
          initialAttempt={initialAttempt}
          dailySequence={dailySequence}
          mode={mode}
        />
      ) : (
        <EndlessRun stat={stat} statKey={statKey} playedOn={playedOn} mode={mode} isAuthed={isAuthed} />
      )}
    </>
  );
}

// ─── Daily mode ──────────────────────────────────────────────────

function DailyRun({
  stat, statKey, playedOn, isAuthed, initialAttempt, dailySequence, mode,
}: {
  stat: StatDef;
  statKey: StatKey;
  playedOn: string;
  isAuthed: boolean;
  initialAttempt: PersistedAttempt | null;
  dailySequence: DailyPublicPair[];
  mode: Mode;
}) {
  const initial = useMemo<{ rounds: PersistedRound[]; ended: boolean }>(() => {
    if (initialAttempt) {
      return { rounds: initialAttempt.rounds, ended: initialAttempt.ended };
    }
    const local = loadDailyLocal(playedOn);
    if (local && local.stat === statKey) {
      return { rounds: local.rounds, ended: local.ended };
    }
    return { rounds: [], ended: false };
  }, [initialAttempt, playedOn, statKey]);

  return (
    <RunView
      stat={stat} statKey={statKey} playedOn={playedOn}
      initialRounds={initial.rounds}
      initialEnded={initial.ended}
      initialPair={null}
      dailySequence={dailySequence}
      persist={(rounds, ended) => {
        saveDailyLocal({ date: playedOn, stat: statKey, rounds, ended });
        if (isAuthed) {
          void persistAttempt({ playedOn, statKey, rounds, ended })
            .catch((e) => console.error("persistAttempt:", e));
        }
      }}
      endVariant="daily"
      mode={mode}
    />
  );
}

// ─── Endless mode ────────────────────────────────────────────────

function EndlessRun({ statKey: todayKey, playedOn, mode, isAuthed }: { stat: StatDef; statKey: StatKey; playedOn: string; mode: Mode; isAuthed: boolean }) {
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
      mode={mode}
      isAuthed={isAuthed}
      onPlayAgain={() => setRunId((n) => n + 1)}
      onChooseDifferent={() => setSelectedKey(null)}
    />
  );
}

function EndlessRunForStat({
  stat, statKey, playedOn, mode, isAuthed, onPlayAgain, onChooseDifferent,
}: {
  stat: StatDef;
  statKey: StatKey;
  playedOn: string;
  mode: Mode;
  isAuthed: boolean;
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
          // Server-side persistence for authed users — fire-and-forget.
          // Display still reads from localStorage so the UI is fast;
          // the DB row exists for future per-stat leaderboards +
          // cross-device sync.
          if (isAuthed) {
            void persistEndlessRun({ statKey, rounds, playedOn })
              .catch((e) => console.error("persistEndlessRun:", e));
          }
        }
      }}
      endVariant="endless"
      mode={mode}
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
  // Each stat is a diamond (rotated black square, same as the topbar's
  // current-stat indicator). All-time best for the stat — if any —
  // appears as a small green dot with the number at the top-right of
  // the diamond, like a trophy chip.
  const allKeys = VISIBLE_STATS;
  // Suppress unused-warning for the playedOn arg; we no longer display
  // today's per-stat best here but the prop signature stays consistent
  // for future per-day surfaces.
  void playedOn;
  return (
    <section className="statsharks-chooser">
      <h3 className="statsharks-chooser-h">Pick your stat</h3>
      <p className="statsharks-chooser-sub">
        Pick the player. Build the longest streak you can.
      </p>
      <div className="statsharks-chooser-grid">
        {allKeys.map((k) => {
          const s = STATS[k];
          const bestLifetime = loadLifetimeEndless(k);
          const isDefault = k === defaultKey;
          return (
            <button
              key={k}
              type="button"
              className={"statsharks-chooser-diamond-wrap" + (isDefault ? " is-default" : "")}
              onClick={() => onPick(k)}
              aria-label={`${s.label}${bestLifetime > 0 ? ` — best streak ${bestLifetime}` : ""}`}
              title={s.label}
            >
              <span className="statsharks-chooser-diamond">
                <span className="statsharks-chooser-diamond-text">{k}</span>
              </span>
              {bestLifetime > 0 ? (
                <span className="statsharks-chooser-diamond-best">{bestLifetime}</span>
              ) : null}
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
  dailySequence,
  persist, endVariant, mode, onPlayAgain, onChooseDifferent, bestEndless, bestLifetime,
}: {
  stat: StatDef;
  statKey: StatKey;
  playedOn: string;
  initialRounds: PersistedRound[];
  initialEnded:  boolean;
  initialPair:   PublicPair | null;
  /** Daily mode supplies a fixed 10-pair sequence; round index =
   * rounds.length. Endless leaves this undefined and uses random
   * picker calls. */
  dailySequence?: DailyPublicPair[];
  persist:       (rounds: PersistedRound[], ended: boolean) => void;
  endVariant:    "daily" | "endless";
  mode:          Mode;
  onPlayAgain?:  () => void;
  onChooseDifferent?: () => void;
  bestEndless?:  number;
  bestLifetime?: number;
}) {
  const isDaily = !!dailySequence;
  const totalRounds = isDaily ? DAILY_ROUND_COUNT : null;
  const [rounds, setRounds]   = useState<PersistedRound[]>(initialRounds);
  const [ended, setEnded]     = useState<boolean>(initialEnded);
  // For Endless mode only — Daily derives its pair from dailySequence
  // by index = rounds.length.
  const [endlessPair, setEndlessPair] = useState<PublicPair | null>(initialPair);
  const [nextEndlessPair, setNextEndlessPair] = useState<PublicPair | null>(null);
  const pair: PublicPair | null = ended
    ? null
    : isDaily
      ? (dailySequence![rounds.length] ?? null)
      : endlessPair;
  const [reveal, setReveal]   = useState<{
    leftValue: number; rightValue: number;
    correctSide: "left" | "right";
    pickedSide:  "left" | "right" | "timeout";
    wasCorrect:  boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(TIMER_SEC);
  // Wall-clock start of the current round's timer. We compute
  // secondsLeft as (TIMER_SEC - elapsed) so a paused tab (mobile
  // backgrounded) doesn't keep the clock alive — when the tab
  // returns we recompute and either show the right number OR fire
  // the timeout if it should already have expired.
  const timerStartedAtRef = useRef<number | null>(null);
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

  // Endless mode only: cold-start fetch + pre-fetch of next pair. Daily
  // mode bypasses both because the entire sequence is already in
  // memory.
  useEffect(() => {
    if (isDaily) return;
    if (endlessPair || ended) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await getPair({
          statKey,
          round: 0,
          usedPlayerSeasonIds: [],
        });
        if (!cancelled) {
          if (next) setEndlessPair(next);
          else setEnded(true);
        }
      } catch (e) { console.error("getPair:", e); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isDaily) return;
    if (!endlessPair || ended || nextEndlessPair) return;
    let cancelled = false;
    const usedForNext: number[] = [];
    for (const r of rounds) usedForNext.push(r.leftId, r.rightId);
    usedForNext.push(endlessPair.left.id, endlessPair.right.id);
    void (async () => {
      try {
        const next = await getPair({
          statKey,
          round: rounds.length + 1,
          usedPlayerSeasonIds: usedForNext,
        });
        if (!cancelled && next) setNextEndlessPair(next);
      } catch (e) { console.error("prefetch getPair:", e); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endlessPair?.left.id, endlessPair?.right.id]);

  // Timer. Wall-clock based so backgrounded mobile tabs can't pause
  // the clock indefinitely — when the tab returns we recompute from
  // Date.now() and the timeout fires immediately if it should have.
  useEffect(() => {
    if (ended || !pair || reveal) {
      timerStartedAtRef.current = null;
      setSecondsLeft(TIMER_SEC);
      return;
    }
    timerStartedAtRef.current = Date.now();
    setSecondsLeft(TIMER_SEC);
    const tick = () => {
      const start = timerStartedAtRef.current;
      if (start === null) return;
      const remaining = Math.max(0, TIMER_SEC - Math.floor((Date.now() - start) / 1000));
      setSecondsLeft(remaining);
    };
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(tick, 250);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      document.removeEventListener("visibilitychange", onVisible);
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
      const elapsedMs = timerStartedAtRef.current
        ? Math.max(0, Date.now() - timerStartedAtRef.current)
        : undefined;
      const newRound: PersistedRound = {
        leftId:     pair.left.id,
        rightId:    pair.right.id,
        pickedSide: side,
        wasCorrect: score.wasCorrect,
        elapsedMs,
      };
      const nextSlotIndex = rounds.filter((r) => r.wasCorrect).length;

      // Dot-flight: launch from the picked card toward the next slot
      // in the dots row. Lands at exactly REVEAL_MS, the same moment
      // the permanent dot mounts and the cards swap to the next pair.
      if (score.wasCorrect && (side === "left" || side === "right")) {
        setTimeout(() => launchFlyingDot(side, nextSlotIndex), FLIGHT_DELAY_MS);
      }

      setTimeout(() => {
        setReveal(null);
        const nextRounds = [...rounds, newRound];

        // Wrong → end the run. The EndScreen renders the last pick so
        // the user can see what they missed without needing to hold
        // the reveal on screen here.
        if (!score.wasCorrect) {
          setRounds(nextRounds);
          setFlyingDot(null);
          setEnded(true);
          setEndlessPair(null);
          return;
        }

        if (isDaily) {
          const reachedCap = nextRounds.length >= DAILY_ROUND_COUNT;
          setRounds(nextRounds);
          setFlyingDot(null);
          if (reachedCap) setEnded(true);
          return;
        }

        setRounds(nextRounds);
        setFlyingDot(null);
        if (nextEndlessPair) {
          setEndlessPair(nextEndlessPair);
          setNextEndlessPair(null);
        } else {
          const used = usedIds;
          setEndlessPair(null);
          void (async () => {
            try {
              const next = await getPair({
                statKey,
                round: nextRounds.length,
                usedPlayerSeasonIds: used,
              });
              if (next) setEndlessPair(next);
              else { setEnded(true); setEndlessPair(null); }
            } catch (e) {
              console.error("fallback getPair:", e);
              setEnded(true);
              setEndlessPair(null);
            }
          })();
        }
      }, REVEAL_MS);
    } catch (e) {
      console.error("scorePair:", e);
    } finally {
      setPending(false);
    }
  }, [pending, reveal, ended, pair, rounds, usedIds, statKey, launchFlyingDot, nextEndlessPair, isDaily]);

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
        stat={stat} statKey={statKey} rounds={rounds} playedOn={playedOn}
        variant={endVariant}
        totalRounds={totalRounds ?? undefined}
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
      {mode === "daily" ? (
        <div className="statsharks-todays">
          Today&rsquo;s category: <b>{stat.label}</b>
        </div>
      ) : null}
      <TopBar stat={stat} streak={streak} secondsLeft={secondsLeft} />
      <div className="statsharks-dots" ref={dotsRowRef}>
        {isDaily
          ? Array.from({ length: DAILY_ROUND_COUNT }).map((_, i) => (
              <span
                key={i}
                className={"statsharks-dot " + (i < streak ? "is-filled" : "is-empty")}
              />
            ))
          : Array.from({ length: streak }).map((_, i) => (
              <span key={i} className="statsharks-dot is-filled" />
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
      <div className="statsharks-stat-diamond" aria-label={stat.label} title={stat.label}>
        <span className="statsharks-stat-diamond-text">{stat.key}</span>
      </div>
      <div className={"statsharks-timer" + (timerLow ? " is-low" : "")}>
        <span className="statsharks-timer-num">{secondsLeft}</span>
        <span className="statsharks-timer-label">SEC</span>
      </div>
    </div>
  );
}

/**
 * Renders text exclusively via CSS pseudo-element content. The DOM
 * has zero text nodes — the visible string lives in `data-text` and
 * `.statsharks-nodetect::after { content: attr(data-text) }` paints it.
 *
 * iOS Safari's data detectors only scan text nodes in the DOM tree;
 * pseudo-element content is invisible to them. Every other path
 * (formatDetection meta, per-character spans, !important CSS,
 * [x-apple-data-detectors] overrides) was bypassed in the wild.
 *
 * `aria-label` on the carrier span gives screen readers the real text.
 */
function NoDetect({ text }: { text: string }) {
  return (
    <span
      className="statsharks-nodetect"
      data-text={text}
      aria-label={text}
    />
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
      <div className="statsharks-card-name">
        <NoDetect text={card.player_name} />
      </div>
      <div className="statsharks-card-meta">
        {card.team_abbr ? (
          <span className="statsharks-card-team">{card.team_abbr}</span>
        ) : null}
        <span className="statsharks-card-year">
          <NoDetect text={String(card.season)} />
        </span>
      </div>
      <div className="statsharks-card-value">
        {reveal ? formatStatValue(stat, reveal.value) : " "}
      </div>
    </button>
  );
};

function EndScreen({
  stat, statKey, rounds, playedOn, variant, totalRounds, onPlayAgain, onChooseDifferent, bestEndless, bestLifetime,
}: {
  stat: StatDef;
  statKey: StatKey;
  rounds: PersistedRound[];
  playedOn: string;
  variant: "daily" | "endless";
  /** Daily mode passes 10; Endless leaves undefined (open-ended). */
  totalRounds?: number;
  onPlayAgain?: () => void;
  onChooseDifferent?: () => void;
  bestEndless?: number;
  bestLifetime?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [reviewOpen, setReviewOpen]   = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewData, setReviewData] = useState<Array<ReviewRound | null> | null>(null);
  const openReview = async () => {
    if (reviewOpen) { setReviewOpen(false); return; }
    setReviewOpen(true);
    await ensureReviewData();
  };
  const ensureReviewData = async () => {
    if (reviewData || reviewLoading) return;
    setReviewLoading(true);
    try {
      const data = await getReviewData({
        statKey,
        rounds: rounds.map((r) => ({ leftId: r.leftId, rightId: r.rightId })),
      });
      setReviewData(data);
    } catch (e) {
      console.error("getReviewData:", e);
      setReviewData([]);
    } finally {
      setReviewLoading(false);
    }
  };

  // Auto-fetch on mount when the last round was a miss — the EndScreen
  // surfaces that round inline so the user can see what they just got
  // wrong without having to tap "Review puzzle".
  const lastRoundIndex = rounds.length - 1;
  const lastRound = lastRoundIndex >= 0 ? rounds[lastRoundIndex] : null;
  const showLastPick = !!lastRound && !lastRound.wasCorrect;
  useEffect(() => {
    if (showLastPick) void ensureReviewData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLastPick]);
  const lastReview = showLastPick && reviewData && lastRoundIndex >= 0
    ? reviewData[lastRoundIndex] ?? null
    : null;
  const streak = rounds.filter((r) => r.wasCorrect).length;
  const isDailyWin = variant === "daily" && totalRounds != null && streak >= totalRounds;
  const grid = rounds.map((r) => r.wasCorrect ? "🟢" : "🔴").join("");
  const shareText = useMemo(() => {
    if (variant === "daily" && totalRounds != null) {
      return [
        `Stat Sharks (${playedOn})`,
        `Statistic: ${stat.label}`,
        ``,
        `${streak}/${totalRounds}${isDailyWin ? " ✨" : ""}`,
        grid,
        ``,
        `boxscore.email/games/statsharks`,
      ].join("\n");
    }
    return [
      `Stat Sharks endless (${playedOn})`,
      `Statistic: ${stat.label}`,
      ``,
      `Streak: ${streak}`,
      grid,
      ``,
      `boxscore.email/games/statsharks`,
    ].join("\n");
  }, [stat.label, streak, grid, playedOn, variant, totalRounds, isDailyWin]);

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
        {variant === "daily" && totalRounds != null
          ? (isDailyWin ? `${streak}/${totalRounds} ✨` : `${streak}/${totalRounds}`)
          : (streak === 0 ? "Tough start." : `Streak: ${streak}`)}
      </div>
      <div className="statsharks-end-stat">
        {variant === "daily" ? (
          <>Today: <b>{stat.label}</b></>
        ) : (
          <span className="statsharks-stat-diamond statsharks-end-diamond" aria-label={stat.label} title={stat.label}>
            <span className="statsharks-stat-diamond-text">{stat.key}</span>
          </span>
        )}
      </div>
      {showLastPick ? (
        <div className="statsharks-end-lastpick">
          <div className="statsharks-end-lastpick-label">Your last pick</div>
          {lastReview ? (
            <ol className="statsharks-review" style={{ margin: 0 }}>
              <li className="statsharks-review-row">
                <span className="statsharks-review-num">{lastRoundIndex + 1}</span>
                <div className="statsharks-review-pair">
                  <ReviewSide
                    card={lastReview.left}
                    stat={stat}
                    isCorrect={lastReview.correctSide === "left"}
                    roundWasLost={!lastRound?.wasCorrect}
                  />
                  <ReviewSide
                    card={lastReview.right}
                    stat={stat}
                    isCorrect={lastReview.correctSide === "right"}
                    roundWasLost={!lastRound?.wasCorrect}
                  />
                </div>
              </li>
            </ol>
          ) : (
            <div className="statsharks-review-loading">Loading…</div>
          )}
        </div>
      ) : null}
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
        {rounds.length > 0 ? (
          <button
            type="button"
            className="statsharks-play-again-btn"
            onClick={openReview}
          >
            {reviewOpen ? "Hide review" : "Review puzzle"}
          </button>
        ) : null}
      </div>
      {reviewOpen ? (
        <ReviewPanel
          stat={stat}
          rounds={rounds}
          data={reviewData}
          loading={reviewLoading}
        />
      ) : null}
      {variant === "daily" ? (
        <p className="statsharks-end-tomorrow">
          New stat tomorrow. Come back at midnight ET, or try Endless mode above.
        </p>
      ) : null}
    </section>
  );
}

/** Per-round review list shown after the user taps "Review puzzle"
 * on the end screen. One row per round: both players with their stat
 * values, a check on the correct side, and (if it differs) an X on
 * the side the user picked. */
function ReviewPanel({
  stat, rounds, data, loading,
}: {
  stat: StatDef;
  rounds: PersistedRound[];
  data: Array<ReviewRound | null> | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return <div className="statsharks-review-loading">Loading review…</div>;
  }
  return (
    <ol className="statsharks-review">
      {data.map((d, i) => {
        const round = rounds[i];
        if (!d || !round) {
          return (
            <li key={i} className="statsharks-review-row">
              <span className="statsharks-review-num">{i + 1}</span>
              <span className="statsharks-review-missing">data unavailable</span>
            </li>
          );
        }
        const roundWasLost = !round.wasCorrect;
        return (
          <li key={i} className="statsharks-review-row">
            <span className="statsharks-review-num">{i + 1}</span>
            <div className="statsharks-review-pair">
              <ReviewSide
                card={d.left}
                stat={stat}
                isCorrect={d.correctSide === "left"}
                roundWasLost={roundWasLost}
              />
              <ReviewSide
                card={d.right}
                stat={stat}
                isCorrect={d.correctSide === "right"}
                roundWasLost={roundWasLost}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ReviewSide({
  card, stat, isCorrect, roundWasLost,
}: {
  card: ReviewRound["left"];
  stat: StatDef;
  /** True when this side was the actual correct answer. */
  isCorrect: boolean;
  /** True when the user lost this round (wrong pick OR timeout). */
  roundWasLost: boolean;
}) {
  // Correct rounds: green ✓ on the correct (= picked) side, opponent
  // neutral. Lost rounds: red ✗ on the wrong side ONLY — no green
  // on the correct side, so a lost row never lights up both halves.
  const showGreen = isCorrect && !roundWasLost;
  const showRed   = !isCorrect && roundWasLost;
  return (
    <div className={
      "statsharks-review-side"
      + (showGreen ? " is-correct-pick" : "")
      + (showRed ? " is-wrong-pick" : "")
    }>
      <div className="statsharks-review-name">
        <NoDetect text={card.player_name} />
        {showGreen ? <span className="statsharks-review-tag" aria-label="correct">✓</span> : null}
        {showRed ? <span className="statsharks-review-tag" aria-label="wrong">✗</span> : null}
      </div>
      <div className="statsharks-review-meta">
        {card.team_abbr ? <span>{card.team_abbr} </span> : null}
        <NoDetect text={String(card.season)} />
        <span className="statsharks-review-value">{formatStatValue(stat, card.value)} {stat.key}</span>
      </div>
    </div>
  );
}

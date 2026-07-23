# Spec: Over/Under (totals) as the card's third market

**Status:** proposed (2026-07-23). **Effort:** small — 1–2 sessions. **Risk:** low.
**Recommended sequencing: build this first** of the three specs — it's the only one
where every ingredient already exists and the backtest can use *real captured odds*
from day one.

## Why this market

- The v7 engine already produces the full run-total distribution and an `over(line)`
  reader (`run-model.ts`, `GameMarkets.over`) — push mass handled. The model side is
  **done**; nothing new is fitted to launch a backtest.
- Verified 2026-07-23: the ESPN core API odds item we already poll every 30 minutes
  carries DraftKings totals — `overUnder` (line), `overOdds` / `underOdds` (prices) —
  plus `open` / `close` / `current` blocks, and supports historical dates. So unlike
  NRFI (thin FanDuel coverage until 2026-07-22), the totals market can be backtested
  against a **full season of real opening lines** immediately.
- Totals is where the killed weather iteration (`fit-weather-nrfi.ts`) predicted the
  temperature effect would actually live: it integrates over nine innings instead of
  one. The weather fixture + park table are already committed and waiting.

## Data plane

1. **Migration 0077** — three nullable columns on `daily_odds` (+ mirrored in the
   `daily_odds_first` view): `total_line numeric`, `over_odds int`, `under_odds int`.
   Also on `daily_picks`: `line numeric` (null for ML/NRFI; totals picks need the
   number they were graded against; player props will reuse it).
2. **Capture** — `odds-espn.ts` parses the three fields it currently drops;
   `odds-cache.ts` writes them. Zero new requests, zero new crons: the existing
   30-minute poll picks them up.
3. **Backfill** — extend `scripts/backfill-espn-odds-season.ts` (already joins ESPN
   games → `daily_raw` schedule for the whole season) to write the totals columns.
   One run gives us full-2026 totals odds history.

## Model + card integration

- **Producer:** v7/v7.1 emit `expectedTotal` + `over(line)` already; the snapshot
  stores P(over) at the captured DK line in `daily_predictions.inputs` provenance.
  If no line is captured yet at snapshot time (5 AM before the 11 AM poll), the
  TOTAL market simply emits no candidate that day — never guess a line.
- **Registry:** new `Market` value `"TOTAL"`, `required: false` (the min-1 guarantee
  stays ML + NRFI; totals only joins the card when it clears its EV floor). Policy
  (recalShift, threshold, defaultOdds ≈ −110) fitted by extending
  `scripts/fit-registry.ts` — the walk-forward + paired-bootstrap machinery is
  already generic over markets.
- **Grading:** comparator computes `away_score + home_score` vs the stored `line`;
  push → `won = null`, stake returned (grade function needs a push branch — ML/NRFI
  can't push, totals can).
- **CLV:** `devigTwoWay(overRaw, underRaw)` works unchanged; ESPN's `close` block
  means totals CLV is measurable from the backfill, not just going forward.

## Gate before the card shows a TOTAL pick

Same two-stage discipline as everything else:
1. Walk-forward OOS: v7 totals log-loss vs the market baseline (de-vigged implied
   probability at the line — the market IS the null model here, and beating the
   de-vigged close is the entire question).
2. Pick-level: threshold sweep on real full-season odds, paired bootstrap vs the
   current ML+NRFI card. Promote `required: false` first; it earns volume, not trust.

## Open decision (Jeff)

None blocking — this can be built without product changes. The only surface change
is that the card may occasionally carry an O/U pick, which the paid-product copy
should mention when the paywall ships.

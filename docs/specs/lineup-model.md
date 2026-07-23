# Spec: lineup-aware offense ratings (BvP-lite)

**Status:** proposed (2026-07-23). **Effort:** Phase A small (1 session, offline);
Phase B medium (new cron + table + product decision). **Risk:** medium — the
snapshot-timing question is a product decision, not just engineering.

## Hypothesis

v7's offense rating is team season runs-per-game — it can't see that tonight's
lineup rests two regulars, platoons against a lefty, or just called up a AAA bat.
A lineup-weighted offense rating (nine shrunk batter ratings, handedness-matched
against the opposing starter) should beat the team-average rating, primarily on ML
— the money market, where v6's crown has been unchallenged by every loop iteration
so far.

## Phase A — signal ceiling, offline, NO new infrastructure

The loop's umpire iteration set the pattern: measure the ceiling with post-hoc data
before building the capture pipeline. We can, because **actual batting orders are
already in our cached boxscores** (`battingOrder` per player in `daily_raw`
payloads, and in `historical_boxscores` for 2024–25).

1. **Batter rating table** — per-player season-to-date run-production rate
   (wOBA-weights over the batting line we cache: 1B/2B/3B/HR/BB/HBP/AB/SF),
   EB-shrunk toward league (`shrinkRate`, K ≈ 150 PA), split vs L/R pitcher where
   the sample allows. Built walk-forward from `daily_raw` (2026) with a 2024–25
   prior from `historical_boxscores`. All in-repo data.
2. **Lineup offense rating** — replace `offenseFromRunsPerGame(teamRpg)` with the
   lineup-PA-weighted mean of the nine batter ratings (leadoff bats ~4.7 times per
   9 innings, ninth ~3.8 — static PA weights). Use the game's ACTUAL lineup
   (post-hoc — this is the ceiling measurement, flagged exactly like the umpire
   probe).
3. **Gate** — walk-forward paired OOS ML log-loss vs v7.1's team-average offense,
   z ≳ 2. Falsification: with betaOff fit at 0.3, offense is heavily shrunk, so
   ALSO report the fit with betaOff re-swept — a better offense signal should want
   a HIGHER weight; if betaOff stays pinned at 0.3, lineup information isn't adding
   anything the composition trusts.

**If Phase A fails, the iteration dies for free** — no cron, no table, no product
change ever built. If it passes, the measured ceiling (Δ log-loss with perfect
lineup knowledge) is the budget that Phase B's imperfect prediction-time lineups
get to spend.

## Phase B — prediction-time lineups (only if Phase A passes)

### Capture

- New append-only table `daily_lineups` (sport, date, game_pk, captured_at,
  away/home lineup JSONB + `lineupConfirmed` flags) — same append-only pattern as
  `daily_odds` (0071/0074), so we keep the full posting timeline and can
  reconstruct "what was knowable at T".
- New cron piggybacking the odds-poll cadence (`*/30 15-23,0-3 UTC`): fetch today's
  schedule with the lineups hydrate (statsapi supports it — `parseSlate` already
  parses `SlateTeam.lineup` / `lineupConfirmed`), append rows on change. MLB
  lineups typically post 2–4 h before first pitch.

### The pick-of-record decision (Jeff — this is the real question)

The card is currently frozen once daily at 14:30 UTC (10:30 AM ET), before any
lineup exists. Lineup-aware picks are impossible under that lock. Options:

| Option | What changes | Tradeoff |
| --- | --- | --- |
| **B1: keep morning lock** | Lineups only feed *next-day* ratings (rest-day detection, roster churn) | Weakest use of the signal; zero product change |
| **B2: split card** | Morning card (ML/NRFI as today) + a "late card" locked ~4 PM ET when most lineups are up | Two pick sets to grade + display; subscribers get lineup-aware picks with time to act; the natural premium-tier shape |
| **B3: per-game lock T-60m** | Each pick freezes an hour before its game | Sharpest information, but picks dribble out all evening — a different product than "your daily card," and the email product can't carry it |

**Recommendation: B2** if Phase A's ceiling is worth ≥ a point of ML hit rate;
otherwise B1. B3 changes what boxscore *is* and shouldn't be driven by one feature.

### Grading

`daily_picks.card_version` already namespaces a second card ("card-v1-late"), and
the comparator grades every version present — the split card needs no comparator
work, only a second `buildDailyCard` invocation from the late cron.

## Explicitly out of scope

True per-matchup BvP (batter X vs pitcher Y career): tiny samples, well-documented
noise. Handedness splits are the defensible version of the same idea.

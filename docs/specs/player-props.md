# Spec: player-prop model family (HR first)

**Status:** roadmap (2026-07-23) — intentionally the LAST of the three specs.
**Effort:** large. **Blockers:** an odds source for props; the lineup pipeline
(props for a benched player are void — the prop card needs Phase B lineups from
`lineup-model.md`).

## Why last

Jeff wants player HR picks eventually, and the grading store is already shaped for
them (`daily_picks` is per-(game, market, **subject**) — a prop is one row with
`subject = <player id>`, `market = 'HR'`, `line` from the totals migration). But
two prerequisites make building it now premature:

1. **Odds.** No captured prop odds → no EV selection, no ROI grading — the same
   hole that made NRFI ROI untrustworthy until 2026-07-22. DK props are behind
   Akamai; ESPN's prop endpoint carries athlete props (Total Strikeouts etc.) per
   its own docs — coverage for HR props unverified; FanDuel's event page (the
   working NRFI source) lists prop markets — also unverified. **First task of this
   spec is a one-session probe of those two sources**, not model work.
2. **Lineups.** HR-prop EV is dominated by "does he play and where does he bat"
   (PA count). Without `lineup-model.md` Phase B, every morning prop pick carries
   scratch risk the model can't price.

## Model sketch (when unblocked)

- Per-batter HR rate: HR/PA, EB-shrunk (K ≈ 300 PA) toward league, from the same
  batting lines as the lineup model's rating table (2024–25 prior + 2026
  walk-forward — all cached data).
- Per-pitcher HR-allowed rate + park HR factor (NOT the run factor — HR park
  factors diverge from run factors; needs its own fit from `historical_boxscores`).
- P(HR tonight) ≈ 1 − (1 − p_PA)^E[PA], with E[PA] from lineup slot. Poisson-thin
  enough that the binomial read is fine at HR rates.
- Market entry via the registry as `market: 'HR'`, `required: false`, EV-ranked
  like everything else — the selector and grading store need zero structural work.

## Gate

Same as every market: walk-forward log-loss vs the de-vigged prop market baseline,
then pick-level paired bootstrap on captured odds. Props markets are soft but
high-vig (−137/+105 typical) — the EV floor in the market policy does the work of
refusing bad-price volume.

## Sequencing with the other specs

`totals-market.md` (1–2 sessions, unblocked) → `lineup-model.md` Phase A (1
session, unblocked) → props odds probe (1 session) → everything else here waits on
those results.

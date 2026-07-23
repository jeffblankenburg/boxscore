-- 0076: daily_picks — the daily card as a first-class snapshot.
--
-- Motivation: the edge-aware daily card (lib/sports/mlb/market-registry.ts
-- + recommendations.ts) is the product the paid tier will sell, so its
-- track record must be FROZEN at publish time — computed once by the
-- snapshot cron, graded by the comparator — never derived at read time
-- where a code change could silently rewrite history. Same contract that
-- model_version enforces for daily_predictions/prediction_results.
--
-- Shape is normalized per (game, market, subject) rather than the
-- game-level ml/nrfi columns of prediction_results, so player-prop markets
-- (HR/hits/K) fit later without schema churn: subject stays 'game' for
-- game-level markets and becomes the player id for props.
--
-- card_version is in the PK so a promoted card change (registry swap,
-- policy refit, selector change) starts a new attributable series, and a
-- challenger card can accrue as a shadow alongside the champion — the
-- same pattern 0075 established for multi-version daily_predictions.

create table daily_picks (
  sport         text not null,
  date          date not null,
  game_pk       bigint not null,
  market        text not null,              -- 'ML' | 'NRFI' (props later)
  subject       text not null default 'game',
  card_version  text not null,
  side          text not null,              -- 'home' | 'NRFI' | 'YRFI'
  probability   numeric not null,           -- recalibrated P(side wins)
  ev            numeric not null,           -- EV/$1 at market-typical odds
  guaranteed    boolean not null default false,
  rank          smallint not null,          -- 1-based position on the card
  model_version text not null,              -- engine that fed this market
  created_at    timestamptz not null default now(),

  -- Grading, written by /api/cron/predictions-comparator after finals.
  -- odds_american is the graded price (closing preferred, opening
  -- fallback) — internal only, never surfaced per-game.
  status        text,
  won           boolean,
  odds_american numeric,
  graded_at     timestamptz,

  primary key (sport, date, game_pk, market, subject, card_version)
);

create index daily_picks_date_idx on daily_picks (sport, date);

notify pgrst, 'reload schema';

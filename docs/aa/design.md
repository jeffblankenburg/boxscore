# American Association boxscore service — design

**Status:** recon complete, adapter spike next. Web/email/crons deferred.
**Visibility:** ships `admin_only` and stays hidden until we explicitly flip it — never public, no RSS, no digests until then.

## Goal

A hidden internal clone of the MLB boxscore surface for **American Association Professional Baseball**,
fed by the iScore Sports API. Prove we can turn iScore's feed into canonical baseball objects and render a
boxscore + linescore + standings, without touching the MLB/statsapi code and without exposing anything publicly.

## Why "recon + adapter spike first"

The vendor docs are wrong in ways that would break a naive integration (see [README.md](./README.md) —
`leagueId` vs `leagueGuid`, auth claims, half the stat endpoints 500). So step one was to replace the docs
with captured ground truth (`scripts/aa-probe-api.ts` → `fixtures/`), and step two is a pure adapter proven
against those fixtures. No DB, no UI, no cron until the adapter is real.

## Key recon findings (feasibility)

1. **Boxscores are feasible anonymously today.** `latest-score/internal` (open, no key) gives linescore,
   team R/H/E/LOB, final score, and current batter/pitcher with game+season splits. `/public/.../lineup`
   gives batting order + positions.
2. **The X-API-Key is not the blocker we thought.** The plain `/latest-score` is 401-gated, but the richer
   `/internal` variant is open. We should still *request* the key from iScore (auth posture may change; and
   the gated endpoints may expose more), but v1 does not depend on it.
3. **The real gaps are the broken stat endpoints** — `standings`, `player-stats`, and all leaderboards 500/400.
   Season aggregate stats and standings are therefore NOT directly available. Two options in "Boxscore strategy".
4. **Play-by-play is available** — the event feed returns ~326 events on a final game (`LINEUP_SET`, at-bats,
   pitches). That's the authoritative raw material for full per-player lines and computed standings.

## Architecture (fits repo conventions)

Mirrors how `lib/sports/football/` was added. **`lib/sports/mlb/` is not touched** (out of scope per CLAUDE.md).

```
lib/sports/aa/
  client.ts     — thin fetch wrapper: base URL, correct param names, optional X-API-Key header.
                  Pure I/O boundary; everything below is pure functions over captured shapes.
  adapter.ts    — iScore vendor shapes → canonical baseball types (source-agnostic, per the
                  canonical-data-model house rule; renderers never see iScore shapes).
  events.ts     — (v2) reducer: event feed → full per-player batting/pitching lines + standings.
  types.ts      — vendor response types, generated/hand-written from fixtures.
scripts/
  aa-probe-api.ts     — recon probe (done). Idempotent; refreshes docs/aa/fixtures/.
  aa-verify-adapter.ts— (next) runs adapter over frozen fixtures, prints a summary. No live calls.
docs/aa/
  design.md, README.md, fixtures/   — this workspace.
```

**Canonical mapping (adapter.ts):**

| iScore source | Canonical output |
| --- | --- |
| `teams.json` + `standings` (computed) | canonical Team + standings row (W/L, RS/RA, GB) |
| `team-players.json` / `player.json` (PII stripped) | canonical Player (bats/throws/number/position) |
| `games.json` (`leagueId` param) | canonical Game (synthesize "Away @ Home"; map `gameStatusId` 1→scheduled, 3→final) |
| `latest-score-internal.json` | canonical Linescore + team R/H/E/LOB + boxscore header |
| `lineup.json` | canonical batting order + positions |
| event feed (v2) | canonical per-player batting/pitching lines |

**Persistence (deferred to Phase C):** reuse `daily_raw` with `sport='aa'` per the "persist every sport
daily" convention — cache the schedule + per-game `latest-score/internal` + event feeds. No new tables to start.

**Gating (deferred to Phase C):** the existing per-sport visibility toggle (`admin_only` ↔ `public`,
DB-backed 30s cache). `/aa/*` routes exist but resolve `admin_only`, so they never render publicly and are
excluded from RSS/digests until we flip the toggle.

## Boxscore strategy — lite vs. full

- **Lite boxscore (Phase B/C, cheap):** `latest-score/internal` + `lineup`. Yields scoreboard, full
  inning-by-inning linescore, team R/H/E/LOB, batting order, and the game's final batter/pitcher splits.
  Enough to stand up a credible hidden archive immediately.
- **Full boxscore (v2, real work):** reduce the ~326-event feed into complete per-batter and per-pitcher
  lines, and roll finals up into standings + season stats. This is a PBP reducer — comparable effort to MLB
  PBP parsing. Note the CLAUDE.md "prefer authoritative sources over PBP" rule is satisfied here: with the
  stat endpoints broken, **the event feed IS the authoritative source**, not an inference.

## Open dependencies / questions for iScore

1. **Fix `player-stats`, leaderboards, standings** (all 500/400). The backend already computes season splits
   (they appear inside `latest-score/internal`), so exposing them would save us building a reducer for season
   aggregates. This is the highest-leverage ask.
2. **Provide the internal `X-API-Key`** — for the gated endpoints and in case anonymous access to `/internal`
   is closed later.
3. **Confirm live `gameStatusId` codes** (only 1=scheduled, 3=final observed) and any postponed/suspended codes.
4. **Rate limits / terms** — is programmatic polling (e.g. every N minutes during games) acceptable?

## Phased plan

- **Phase A — Recon.** ✅ Done. `scripts/aa-probe-api.ts`, `docs/aa/fixtures/`, auth+shape matrix in README.
- **Phase B — Adapter spike.** `lib/sports/aa/{client,adapter,types}.ts` + `scripts/aa-verify-adapter.ts`
  converting frozen fixtures → canonical objects. `npm run typecheck` clean. **No UI/DB/cron.** ← next.
- **Phase C — Hidden web + ingestion** (gated on B): `daily_raw` ingestion, admin-only `/aa` boxscore +
  standings (computed) pages, reusing `renderLeague()` + digest CSS. Screenshot-verified at 400px.
- **Phase D — Full boxscore reducer** (v2): `events.ts`, per-player lines, season stats — or drop it if
  iScore fixes the stat endpoints first.
- **Phase E — Launch decision:** flip the visibility toggle, add `/rss/aa`, wire digests. Not before.

## Explicit non-goals for now

No public exposure, no RSS, no email, no predictions/odds (this is an archive/boxscore surface, not the
predictions engine). No changes to `lib/sports/mlb/`. No new DB tables until Phase C.

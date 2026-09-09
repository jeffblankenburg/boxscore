# American Association — collaborator workspace

A **hidden-from-public** boxscore service for **American Association Professional Baseball**
(independent pro league, northern-midwest US), built on the iScore Sports API. Modeled on the
MLB surface but kept `admin_only` until we choose to launch it.

Design proposal: [design.md](./design.md). Frozen API captures for offline adapter work: [fixtures/](./fixtures/).

Like predictions-v7, adapter work happens against these frozen fixtures, not live calls, until the
`lib/sports/aa` adapter is proven. Refresh with `npx tsx --env-file=.env.local scripts/aa-probe-api.ts`.

## Identifiers

| Thing | Guid |
| --- | --- |
| League — American Association Professional Baseball | `661d9b4b-0e17-412a-bb93-981ca40f021a` |
| Season — AAPB- 2026 (regular) | `aeba1d47-af95-4818-b69a-1943bd18800f` |
| Season — All-Star Game 2026 | `23fc21cb-8096-4558-86fd-7fa2f5555b3d` |
| API base (prod) | `https://api.microservices.iscoresports.com/api` |

14 teams, ~41-player rosters. Teams carry `shortName` (MKE, CHI, CLE…) and a hex `color`.

## The docs lie — corrections (verified 2026-08-31)

The vendor PDF is unreliable. Verified deltas:

| Doc says | Reality |
| --- | --- |
| Games param `leagueGuid` | Real param is **`leagueId`**. `leagueGuid` → HTTP 400 "leagueId or seasonId is required". |
| "Endpoints do not require any Bearer token" | False for `/games/{id}/lineup` (no `/public`) and `/games/{id}/latest-score` → **401**. |
| `latest-score/internal` needs `X-API-Key` | **Open anonymously** right now, and richer than the gated plain variant. |
| Lineup at `/public/games/{id}/lineup` | Correct — but **only** with the `/public` prefix; `/games/{id}/lineup` 401s. |
| `player-stats`, all leaderboards, standings work | Currently **broken**: `player-stats` → 400, leaderboards → 500, standings → 500, `player/games` → 500. |

## Auth + shape matrix

`✓` = usable anonymously today. Full machine-readable matrix: [fixtures/_probe-matrix.json](./fixtures/_probe-matrix.json).

| Endpoint | Status | Fixture | Notes |
| --- | --- | --- | --- |
| `GET /public/leagues` | ✓ 200 | `leagues.json` | 29 leagues; AA + Frontier are the real pro ones, rest are QA/test. |
| `GET /public/leagues/{L}/details` | ✓ 200 | `league-details.json` | |
| `GET /public/leagues/{L}/teams` | ✓ 200 | `teams.json` | 14 teams w/ shortName + color + managerName. |
| `GET /public/leagues/{L}/seasons` | ✓ 200 | `seasons.json` | |
| `GET /public/leagues/{L}/seasons/summary` | ✓ 200 | `seasons-summary.json` | |
| `GET /public/seasons/{S}` | ✓ 200 | `season.json` | conferences/divisions/team mappings + game settings. |
| `GET /public/teams/{T}/players` | ✓ 200 | `team-players.json` | full roster; bats/throws/number/positionGroup. |
| `GET /public/players/{P}` | ✓ 200 | `player.json` | has `phone`/`email` fields (empty for AA pros) + `dateOfBirth`/`city`. `batter.notes` also carries a DOB. Strip phone/email defensively; DOB/city are public pro-athlete bio. |
| `GET /public/games?leagueId={L}` | ✓ 200 | `games.json` | **`Take` caps at 200.** Games generically named "Match" — synthesize "Away @ Home". |
| `GET /public/games/{G}/lineup` | ✓ 200 | `lineup.json` | batting order + positions; embedded player, but `batterStats: null`. |
| `GET /games/{G}/latest-score/internal` | ✓ 200 | `latest-score-internal.json` | **the boxscore payload** — see below. |
| `GET /game-engine/process-event/{G}` | ✓ 200 | `events-final.json` | **326 events** on a final game; empty on scheduled. Full PBP. |
| `GET /games/{G}/lineup` (no `/public`) | ✗ 401 | — | use the `/public` path. |
| `GET /games/{G}/latest-score` | ✗ 401 | — | use `/internal`; it's open and richer. |
| `GET /public/player/games` | ✗ 500 | — | broken. |
| `GET /leagues/{L}/standings` | ✗ 500 | — | broken → compute standings ourselves from finals. |
| `GET /player-stats` | ✗ 400 | — | broken (both TeamId and PlayerId). |
| `GET /leaderboard/{team,player}/{stat}` | ✗ 500 | — | all four stat types, both scopes, broken. |

### `gameStatusId` enum (observed)

`1` = scheduled/upcoming, `3` = final. (Sampled distribution over 200 games: `{1: 41, 3: 159}`.)
Live/in-progress codes not yet observed — confirm mid-game during the season.

### The boxscore payload (`latest-score/internal`)

Point-in-time snapshot, fully populated on finals. Captured from Chicago Dogs 6 @ Cleburne Railroaders 10:

```
teams.{AWAY,HOME}      → id, name, shortName, runs, hits, errors, lob
linescore.{AWAY,HOME}  → runsByInning.I1..I9 (null = not batted), total, finalScore
baseState              → B1, B2, B3 (booleans)
gameStatus             → balls, strikes, outs, currentInning, inningHalf ("TOP"/"BOT")
batter                 → identity + batterStats.currentGame + batterStats.season (avg/obp/ops/slg/hr/rbi)
pitcher                → identity + pitcherStats.currentGame + pitcherStats.season
pitchcount             → per-side pitch totals
```

Gives a scoreboard, full linescore, team R/H/E/LOB, and the **current** batter/pitcher with game+season
splits. It does **not** carry the full per-batter/per-pitcher tables — for those, reduce the event feed.

## Data availability summary

- **Free anonymously today:** schedule, rosters, players, season structure, lineups, linescore + team
  R/H/E, current-batter/pitcher splits, full play-by-play events.
- **Not available from the API** (endpoints broken): league standings, season stat leaderboards,
  per-player season stat lines. Two paths: (a) ask iScore to fix `player-stats`/leaderboards/standings —
  the backend clearly computes season splits (they appear inside `latest-score/internal`); or
  (b) reduce the event feed ourselves. See design.md "Boxscore strategy".

## Sanity anchors

- 14 teams, both 2026 seasons `active: true`.
- A final game's event feed has O(300) events (326 in the captured sample).
- Linescore `total` must equal `finalScore` and equal `teams.*.runs` — cross-check on ingest.
- Player payloads expose `phone`/`email` fields (empty for AA pros, populated for youth leagues on the same
  platform) — the adapter must drop them defensively before persisting. `dateOfBirth`/`city` are public bio.

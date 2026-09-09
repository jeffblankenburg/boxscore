// Recon probe for the iScore Sports API, scoped to American Association Professional Baseball.
//
// WHY: the vendor PDF is unreliable — param names, path prefixes, and the
// "no auth required" claim are all wrong for several endpoints (games wants
// `leagueId` not `leagueGuid`; leaderboards 500; lineup/latest-score 401).
// This script hits every endpoint against the live league/season, records an
// auth + shape matrix, and freezes real response bodies into docs/aa/fixtures/
// so the lib/sports/aa adapter is written against ground truth, not the docs.
//
// Boxscore-critical endpoints need the internal X-API-Key. Set AA_API_KEY to
// probe them for real; without it they're expected to 401 and we record that.
//
// Run: npx tsx --env-file=.env.local scripts/aa-probe-api.ts
// Idempotent: re-run to refresh fixtures. Prints a summary table at the end.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://api.microservices.iscoresports.com/api'
const LEAGUE = '661d9b4b-0e17-412a-bb93-981ca40f021a' // American Association Professional Baseball
const SEASON = 'aeba1d47-af95-4818-b69a-1943bd18800f' // AAPB- 2026 (regular season)
const API_KEY = process.env.AA_API_KEY ?? null

const FIXTURE_DIR = join(process.cwd(), 'docs', 'aa', 'fixtures')

type Probe = {
  label: string
  method: string
  path: string
  status: number
  ok: boolean
  bytes: number
  authTried: boolean
  shape: string // top-level keys or [array-of<...>]
  note: string
}

const results: Probe[] = []

function describeShape(body: unknown): string {
  if (Array.isArray(body)) {
    const first = body[0]
    const inner = first && typeof first === 'object' ? Object.keys(first).join(',') : typeof first
    return `array(${body.length})<${inner}>`
  }
  if (body && typeof body === 'object') return Object.keys(body as object).join(',')
  return typeof body
}

async function probe(
  label: string,
  path: string,
  opts: { withKey?: boolean; save?: string } = {},
): Promise<any> {
  const url = `${BASE}${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  const authTried = Boolean(opts.withKey && API_KEY)
  if (authTried) headers['X-API-Key'] = API_KEY as string

  let status = 0
  let ok = false
  let bytes = 0
  let shape = '-'
  let note = ''
  let parsed: any = null

  try {
    const res = await fetch(url, { headers })
    status = res.status
    ok = res.ok
    const text = await res.text()
    bytes = text.length
    try {
      parsed = JSON.parse(text)
      shape = describeShape(parsed)
      if (parsed && typeof parsed === 'object' && 'errorMessage' in parsed) {
        note = String((parsed as any).errorMessage).slice(0, 60)
      }
    } catch {
      shape = 'non-json'
      note = text.slice(0, 60).replace(/\s+/g, ' ')
    }
    if (opts.save && parsed != null) {
      writeFileSync(join(FIXTURE_DIR, opts.save), JSON.stringify(parsed, null, 2))
    }
  } catch (err) {
    note = `FETCH ERR: ${(err as Error).message}`.slice(0, 60)
  }

  results.push({ label, method: 'GET', path, status, ok, bytes, authTried, shape, note })
  return parsed
}

async function main() {
  console.log(`Probing iScore API for American Association`)
  console.log(`  base:   ${BASE}`)
  console.log(`  league: ${LEAGUE}`)
  console.log(`  season: ${SEASON}`)
  console.log(`  X-API-Key: ${API_KEY ? 'present' : 'ABSENT (gated endpoints expected to 401)'}`)
  console.log('')

  // --- Anonymous discovery layer -------------------------------------------
  const leagues = await probe('leagues (all)', `/public/leagues`, { save: 'leagues.json' })
  await probe('league details', `/public/leagues/${LEAGUE}/details`, { save: 'league-details.json' })
  const teams = await probe('teams', `/public/leagues/${LEAGUE}/teams`, { save: 'teams.json' })
  await probe('seasons', `/public/leagues/${LEAGUE}/seasons`, { save: 'seasons.json' })
  await probe('seasons summary', `/public/leagues/${LEAGUE}/seasons/summary`, { save: 'seasons-summary.json' })
  await probe('season by guid', `/public/seasons/${SEASON}`, { save: 'season.json' })

  // Pick a real team + player + game to drive dependent probes.
  const team = Array.isArray(teams) ? teams[0] : null
  const teamId: string | null = team?.guid ?? null

  let playerId: string | null = null
  if (teamId) {
    const roster = await probe('team players', `/public/teams/${teamId}/players`, { save: 'team-players.json' })
    playerId = Array.isArray(roster) && roster[0]?.guid ? roster[0].guid : null
    if (playerId) {
      await probe('player by guid', `/public/players/${playerId}`, { save: 'player.json' })
      await probe('player games', `/public/player/games?PlayerGuid=${playerId}&SeasonGuid=${SEASON}`, {
        save: 'player-games.json',
      })
    }
  }

  // Games list — NOTE: real param is `leagueId`, not documented `leagueGuid`.
  const games = await probe('games (leagueId)', `/public/games?leagueId=${LEAGUE}&Take=25`, {
    save: 'games.json',
  })
  // Record that the documented param name is wrong.
  await probe('games (leagueGuid — doc name)', `/public/games?leagueGuid=${LEAGUE}&Take=1`)

  // Enumerate the gameStatusId values actually present (docs claim 3=Final).
  if (Array.isArray(games)) {
    const statusCounts: Record<string, number> = {}
    for (const g of games) statusCounts[g.gameStatusId] = (statusCounts[g.gameStatusId] ?? 0) + 1
    console.log('gameStatusId distribution in sample:', JSON.stringify(statusCounts))
  }
  const gameId: string | null = Array.isArray(games) && games[0]?.gameGuid ? games[0].gameGuid : null

  // --- Gated / boxscore layer (needs X-API-Key) ----------------------------
  if (gameId) {
    // Try lineup at both documented and observed paths.
    await probe('lineup (/public)', `/public/games/${gameId}/lineup`, { withKey: true, save: 'lineup.json' })
    await probe('lineup (no /public)', `/games/${gameId}/lineup`, { withKey: true })
    await probe('latest-score (public)', `/games/${gameId}/latest-score`, { withKey: true, save: 'latest-score.json' })
    await probe('latest-score/internal', `/games/${gameId}/latest-score/internal`, {
      withKey: true,
      save: 'latest-score-internal.json',
    })
    await probe('game events', `/game-engine/process-event/${gameId}`, { withKey: true, save: 'events.json' })
  }

  // --- Stats + standings (currently flaky) ---------------------------------
  await probe('standings', `/leagues/${LEAGUE}/standings`, { withKey: true, save: 'standings.json' })
  if (teamId) {
    await probe('player-stats (TeamId)', `/player-stats?TeamId=${teamId}&SeasonId=${SEASON}`, {
      withKey: true,
      save: 'player-stats-team.json',
    })
  }
  if (playerId) {
    await probe('player-stats (PlayerId)', `/player-stats?PlayerId=${playerId}&SeasonId=${SEASON}`, {
      withKey: true,
    })
  }

  // Leaderboards — docs show `/api/leaderboard/...`; probe both prefixes.
  for (const kind of ['batting', 'pitching', 'fielding', 'running']) {
    await probe(
      `leaderboard player/${kind}`,
      `/leaderboard/player/${kind}?SeasonId=${SEASON}&LeagueId=${LEAGUE}&SortBy=avg&Size=3`,
      { withKey: true, save: `leaderboard-player-${kind}.json` },
    )
  }
  for (const kind of ['batting', 'pitching', 'fielding', 'running']) {
    await probe(
      `leaderboard team/${kind}`,
      `/leaderboard/team/${kind}?SeasonId=${SEASON}&LeagueId=${LEAGUE}&SortBy=avg&Size=3`,
      { withKey: true },
    )
  }

  // --- Summary -------------------------------------------------------------
  console.log('\n=== AUTH + SHAPE MATRIX ===')
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
  console.log(
    pad('endpoint', 30) + pad('status', 7) + pad('key?', 6) + pad('bytes', 8) + 'shape / note',
  )
  for (const r of results) {
    const flag = r.ok ? '  ' : '✗ '
    const shapeOrNote = r.note ? `${r.shape}  «${r.note}»` : r.shape
    console.log(
      flag + pad(r.label, 28) + pad(String(r.status), 7) + pad(r.authTried ? 'yes' : 'no', 6) +
        pad(String(r.bytes), 8) + pad(shapeOrNote, 60),
    )
  }

  writeFileSync(join(FIXTURE_DIR, '_probe-matrix.json'), JSON.stringify(results, null, 2))
  const okCount = results.filter((r) => r.ok).length
  console.log(`\n${okCount}/${results.length} endpoints OK. Matrix + bodies → docs/aa/fixtures/`)
  console.log(API_KEY ? '' : 'Set AA_API_KEY to probe the gated boxscore endpoints for real.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

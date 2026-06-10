// Canonical player profile resolver. Reads from the players table (#63).
// Career stats live separately in historical_player_career (#59); this
// module is profile-only.
//
// Identity:
//   - `id` is our internal canonical id (bigserial). Everything internal
//     — FKs from historical_player_lines, MLBdle reveal queries, leader-
//     board joins — references this.
//   - `mlb_id` is the MLB Stats API person id, used only when we need
//     to talk to the MLB API or look up a player from the box-score
//     payload (which carries mlb_id).
//
// Three access patterns:
//   getPlayerById(id)             — cached read by internal id
//   getPlayerByMlbId(mlbId)       — cached read by vendor id
//   ensurePlayerByMlbId(mlbId)    — read-or-fetch by vendor id; upserts
//                                    on cache miss. Use at ingest points
//                                    (boxscore parse, backfill).
//   searchPlayers(query)          — last-name-prefix autocomplete

import { supabaseAdmin } from "./supabase";

export type Player = {
  id: number;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  boxscore_name: string | null;
  name_slug: string | null;
  birth_date: string | null;
  birth_country: string | null;
  birth_state: string | null;
  birth_city: string | null;
  debut_date: string | null;
  last_game_date: string | null;
  active: boolean | null;
  primary_position: string | null;
  primary_number: string | null;
  bats: string | null;
  throws: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  draft_year: number | null;
  hall_of_fame: boolean;
  raw_profile: unknown;
  mlb_id: number | null;
  fetched_at: string | null;
  updated_at: string;
};

const MLB_API = "https://statsapi.mlb.com/api";

export async function getPlayerById(id: number): Promise<Player | null> {
  const { data, error } = await supabaseAdmin()
    .from("players")
    .select("*")
    .eq("id", id)
    .maybeSingle<Player>();
  if (error) throw new Error(`getPlayerById(${id}): ${error.message}`);
  return data;
}

export async function getPlayerByMlbId(mlbId: number): Promise<Player | null> {
  const { data, error } = await supabaseAdmin()
    .from("players")
    .select("*")
    .eq("mlb_id", mlbId)
    .maybeSingle<Player>();
  if (error) throw new Error(`getPlayerByMlbId(${mlbId}): ${error.message}`);
  return data;
}

// Read-or-fetch by MLB id. The box-score payload only carries mlb_id, so
// this is the call site for any ingest path that needs to land a player.
export async function ensurePlayerByMlbId(mlbId: number): Promise<Player | null> {
  const cached = await getPlayerByMlbId(mlbId);
  if (cached) return cached;
  const fetched = await fetchPlayerFromApi(mlbId);
  if (!fetched) return null;
  await upsertPlayerByMlbId(fetched);
  return getPlayerByMlbId(mlbId);
}

// Last-name autocomplete for Guess the Player. Case-insensitive prefix
// match on last_name; tops up with full-name substring matches when the
// prefix yields fewer than `limit` results.
export async function searchPlayers(query: string, limit = 20): Promise<Player[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const db = supabaseAdmin();
  const { data: byLastName, error: lnErr } = await db
    .from("players")
    .select("*")
    .ilike("last_name", `${q}%`)
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })
    .limit(limit);
  if (lnErr) throw new Error(`searchPlayers last_name: ${lnErr.message}`);
  if (byLastName && byLastName.length === limit) return byLastName as Player[];

  const seen = new Set((byLastName ?? []).map((p) => (p as Player).id));
  const remaining = limit - (byLastName?.length ?? 0);
  const { data: byFullName, error: fnErr } = await db
    .from("players")
    .select("*")
    .ilike("full_name", `%${q}%`)
    .order("last_name", { ascending: true })
    .limit(remaining + seen.size);
  if (fnErr) throw new Error(`searchPlayers full_name: ${fnErr.message}`);
  const extra = (byFullName ?? []).filter((p) => !seen.has((p as Player).id));
  return [...(byLastName ?? []), ...extra.slice(0, remaining)] as Player[];
}

// ─── MLB API → canonical row ────────────────────────────────────────

type ApiPerson = {
  id: number;
  fullName: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  boxscoreName?: string;
  nameSlug?: string;
  birthDate?: string;
  birthCountry?: string;
  birthStateProvince?: string;
  birthCity?: string;
  mlbDebutDate?: string;
  active?: boolean;
  primaryPosition?: { abbreviation?: string };
  primaryNumber?: string;
  batSide?: { code?: string };
  pitchHand?: { code?: string };
  height?: string;
  weight?: number;
  draftYear?: number;
};

type ApiEnvelope = { people: ApiPerson[] };

// Parse `6' 7"` → 79. Tolerant: returns null on anything we don't
// recognize so a malformed value doesn't poison the row.
function parseHeightInches(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^\s*(\d+)\s*'\s*(\d+)\s*"?\s*$/);
  if (!m) return null;
  const feet = Number(m[1]);
  const inches = Number(m[2]);
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
  return feet * 12 + inches;
}

// Shape returned by fetchPlayerFromApi — what gets upserted. Doesn't
// include `id` (assigned by bigserial), `hall_of_fame` (separate seed),
// or `last_game_date` (derived from historical_player_lines once #56
// lands). Carries `mlb_id` as the vendor lookup key.
export type FetchedProfile = {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  middle_name: string | null;
  boxscore_name: string | null;
  name_slug: string | null;
  birth_date: string | null;
  birth_country: string | null;
  birth_state: string | null;
  birth_city: string | null;
  debut_date: string | null;
  active: boolean | null;
  primary_position: string | null;
  primary_number: string | null;
  bats: string | null;
  throws: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  draft_year: number | null;
  mlb_id: number;
  raw_profile: ApiPerson;
};

export async function fetchPlayerFromApi(mlbId: number): Promise<FetchedProfile | null> {
  const res = await fetch(`${MLB_API}/v1/people/${mlbId}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`fetchPlayerFromApi(${mlbId}): ${res.status}`);
  }
  const env = (await res.json()) as ApiEnvelope;
  const p = env.people?.[0];
  if (!p) return null;
  return {
    full_name:        p.fullName,
    first_name:       p.firstName ?? null,
    last_name:        p.lastName ?? null,
    middle_name:      p.middleName ?? null,
    boxscore_name:    p.boxscoreName ?? null,
    name_slug:        p.nameSlug ?? null,
    birth_date:       p.birthDate ?? null,
    birth_country:    p.birthCountry ?? null,
    birth_state:      p.birthStateProvince ?? null,
    birth_city:       p.birthCity ?? null,
    debut_date:       p.mlbDebutDate ?? null,
    active:           p.active ?? null,
    primary_position: p.primaryPosition?.abbreviation ?? null,
    primary_number:   p.primaryNumber ?? null,
    bats:             p.batSide?.code ?? null,
    throws:           p.pitchHand?.code ?? null,
    height_inches:    parseHeightInches(p.height),
    weight_lbs:       p.weight ?? null,
    draft_year:       p.draftYear ?? null,
    mlb_id:           p.id,
    raw_profile:      p,
  };
}

// Upsert keyed on mlb_id. Doesn't touch hall_of_fame (managed by a
// separate seeding pass) so backfill reruns can't clobber the HOF flag.
export async function upsertPlayerByMlbId(profile: FetchedProfile): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("players")
    .upsert({
      ...profile,
      fetched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "mlb_id" });
  if (error) throw new Error(`upsertPlayerByMlbId(${profile.mlb_id}): ${error.message}`);
}

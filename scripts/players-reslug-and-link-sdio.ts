// Post-migration 0050 backfill: re-slug every player in the canonical
// players table per the new convention and link each SDIO player to
// their internal canonical row by MLBAMID join.
//
// Two phases, both idempotent and safe to re-run:
//
//   1. SDIO link + insert. Pull /scores/json/Players (~7,162 rows;
//      ~4,098 with MLBAMID populated). For each SDIO row whose MLBAMID
//      matches an existing players.mlb_id, set sdio_player_id. For each
//      SDIO row with MLBAMID but NO existing players row, insert one
//      with the profile fields SDIO supplies.
//
//   2. Re-slug. Recompute name_slug for every players row using the new
//      convention:
//
//        unique name          → `aaron-judge`
//        duplicate name, distinct birth_year → `chris-davis-1976`, `chris-davis-1980`
//        duplicate name + year (rare)        → `john-smith-1954`, `john-smith-1954-2`
//        no birth_year + duplicate           → fall back to counter against the base
//
//      Deterministic seed order is (debut_date ASC NULLS LAST, mlb_id
//      ASC). Re-runs produce identical slugs given the same data set.
//      The legacy slug from migration 0037 is already preserved in
//      name_slug_legacy by the migration; this phase only overwrites
//      the canonical name_slug column.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/players-reslug-and-link-sdio.ts --dry-run
//   npx tsx --env-file=.env.local scripts/players-reslug-and-link-sdio.ts

import { supabaseAdmin } from "../lib/supabase";
import { sdioGet } from "../lib/sports/mlb/sources/sdio-client";

type Args = { dryRun: boolean };

function parseArgs(): Args {
  return { dryRun: process.argv.includes("--dry-run") };
}

type PlayerRow = {
  id: number;
  full_name: string;
  birth_date: string | null;     // "YYYY-MM-DD"
  debut_date: string | null;     // "YYYY-MM-DD"
  mlb_id: number | null;
  sdio_player_id: number | null;
  name_slug: string | null;
};

type SdioPlayer = {
  PlayerID: number;
  MLBAMID: number | null;
  FirstName: string | null;
  LastName: string | null;
  BirthDate: string | null;
  ProDebut: string | null;
  BatHand: string | null;
  ThrowHand: string | null;
  Status: string | null;
};

const PAGE = 1000;
const BATCH_SLUG = 500;

// ─── Slug computation ────────────────────────────────────────────────────

// Lowercase + strip accents + hyphenate. ASCII letters/digits only.
// Punctuation collapses to single hyphens, leading/trailing trimmed.
//   "Heriberto Hernández"  → "heriberto-hernandez"
//   "Vladimir Guerrero Jr." → "vladimir-guerrero-jr"
//   "J.T. Realmuto"        → "j-t-realmuto"
//   "Ke'Bryan Hayes"       → "ke-bryan-hayes"
function slugifyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")    // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")        // any run of non-alphanumeric → single hyphen
    .replace(/^-+|-+$/g, "");           // trim leading/trailing
}

function yearOf(date: string | null): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) && y > 1800 ? y : null;
}

// Deterministic seed order — earlier debut + lower mlb_id wins the
// unsuffixed slug. Re-bootstraps produce the same assignment.
function seedSort(a: PlayerRow, b: PlayerRow): number {
  const ad = a.debut_date ?? "9999-99-99";
  const bd = b.debut_date ?? "9999-99-99";
  if (ad !== bd) return ad < bd ? -1 : 1;
  return (a.mlb_id ?? Number.MAX_SAFE_INTEGER) - (b.mlb_id ?? Number.MAX_SAFE_INTEGER);
}

// For each base slug, decide the final slug per the year-disambiguator
// rule. Returns a Map<player.id, finalSlug>.
function computeSlugs(rows: PlayerRow[]): Map<number, string> {
  const out = new Map<number, string>();

  // Group by base slug
  const byBase = new Map<string, PlayerRow[]>();
  for (const r of rows) {
    const base = slugifyName(r.full_name);
    if (!base) continue;
    (byBase.get(base) ?? byBase.set(base, []).get(base)!).push(r);
  }

  for (const [base, group] of byBase) {
    if (group.length === 1) {
      out.set(group[0]!.id, base);
      continue;
    }
    // Name collision — try year-disambiguator
    group.sort(seedSort);

    // Subgroup by birth_year. Members with no year fall into the "noyear" bucket
    // and get counter-disambiguation against the bare base.
    const byYear = new Map<string, PlayerRow[]>();
    for (const r of group) {
      const y = yearOf(r.birth_date);
      const key = y == null ? "__noyear__" : String(y);
      (byYear.get(key) ?? byYear.set(key, []).get(key)!).push(r);
    }

    for (const [yearKey, members] of byYear) {
      if (yearKey === "__noyear__") {
        // No year available — fall back to bare base + counter.
        // First member: base, second: base-2, third: base-3, etc.
        // But if another year group already claimed bare base, we still need
        // to disambiguate — handled by the outer loop's bare-base check below.
        // Simpler: assign all noyear members against base+counter starting at base.
        for (let i = 0; i < members.length; i++) {
          out.set(members[i]!.id, i === 0 ? base : `${base}-${i + 1}`);
        }
        continue;
      }
      // Has year. Each member gets base-year, with counter for same-year collisions.
      for (let i = 0; i < members.length; i++) {
        const candidate = `${base}-${yearKey}`;
        out.set(members[i]!.id, i === 0 ? candidate : `${candidate}-${i + 1}`);
      }
    }
  }

  return out;
}

// ─── Phase 1: SDIO link + insert ────────────────────────────────────────

async function fetchAllPlayers(): Promise<PlayerRow[]> {
  const sb = supabaseAdmin();
  const rows: PlayerRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("players")
      .select("id, full_name, birth_date, debut_date, mlb_id, sdio_player_id, name_slug")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAllPlayers: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as PlayerRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fetchSdioPlayers(): Promise<SdioPlayer[]> {
  const raw = await sdioGet(`/scores/json/Players`);
  return (raw as SdioPlayer[]) ?? [];
}

async function linkAndInsertSdio(
  existing: PlayerRow[],
  sdio: SdioPlayer[],
  dryRun: boolean,
): Promise<{ linked: number; inserted: number; skipped: number }> {
  const byMlbId = new Map<number, PlayerRow>();
  for (const r of existing) if (r.mlb_id != null) byMlbId.set(r.mlb_id, r);

  let linked = 0, inserted = 0, skipped = 0;
  const linkUpdates: Array<{ id: number; sdio_player_id: number }> = [];
  const inserts: Array<Partial<PlayerRow> & { full_name: string; mlb_id: number; sdio_player_id: number; birth_date: string | null; debut_date: string | null }> = [];

  for (const sp of sdio) {
    if (!sp.MLBAMID) { skipped++; continue; }
    const match = byMlbId.get(sp.MLBAMID);
    if (match) {
      if (match.sdio_player_id !== sp.PlayerID) {
        linkUpdates.push({ id: match.id, sdio_player_id: sp.PlayerID });
        linked++;
      }
      continue;
    }
    // No existing row — SDIO-only player (rare; minor-league callup before our backfill caught them)
    const full = `${sp.FirstName ?? ""} ${sp.LastName ?? ""}`.trim();
    if (!full) { skipped++; continue; }
    inserts.push({
      full_name: full,
      mlb_id: sp.MLBAMID,
      sdio_player_id: sp.PlayerID,
      birth_date: sp.BirthDate?.slice(0, 10) ?? null,
      debut_date: sp.ProDebut?.slice(0, 10) ?? null,
    });
    inserted++;
  }

  if (dryRun) {
    console.log(`[dry-run] would link ${linkUpdates.length} existing rows to SDIO`);
    console.log(`[dry-run] would insert ${inserts.length} new SDIO-only players`);
    return { linked, inserted, skipped };
  }

  const sb = supabaseAdmin();
  // Per-row UPDATE — supabase upsert with a partial column set tries to
  // INSERT on conflict and hits the full_name NOT NULL constraint. We
  // parallelize in chunks to keep wall time reasonable on ~3.4K rows.
  const CHUNK = 50;
  for (let i = 0; i < linkUpdates.length; i += CHUNK) {
    const chunk = linkUpdates.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (u) => {
      const { error } = await sb.from("players").update({ sdio_player_id: u.sdio_player_id }).eq("id", u.id);
      if (error) throw new Error(`link id=${u.id}: ${error.message}`);
    }));
  }
  if (inserts.length > 0) {
    const { error } = await sb.from("players").insert(inserts);
    if (error) throw new Error(`SDIO-only insert: ${error.message}`);
  }
  return { linked, inserted, skipped };
}

// ─── Phase 2: Re-slug ───────────────────────────────────────────────────

async function reslug(dryRun: boolean): Promise<{ changed: number; sample: Array<{ id: number; before: string | null; after: string }> }> {
  const rows = await fetchAllPlayers();
  const slugs = computeSlugs(rows);

  // Sanity check: every computed slug must be unique. If two players
  // collapsed to the same slug, the disambiguation logic has a bug —
  // abort before writing.
  const seen = new Map<string, number>();
  const dupes: Array<{ slug: string; ids: number[] }> = [];
  for (const [id, slug] of slugs) {
    const prior = seen.get(slug);
    if (prior != null) {
      const dupe = dupes.find((d) => d.slug === slug);
      if (dupe) dupe.ids.push(id);
      else dupes.push({ slug, ids: [prior, id] });
    } else {
      seen.set(slug, id);
    }
  }
  if (dupes.length > 0) {
    console.error(`SLUG COLLISIONS DETECTED — aborting before write:`);
    for (const d of dupes.slice(0, 10)) console.error(`  ${d.slug} → ids ${d.ids.join(", ")}`);
    throw new Error(`${dupes.length} duplicate slugs computed`);
  }

  const updates: Array<{ id: number; name_slug: string }> = [];
  const sample: Array<{ id: number; before: string | null; after: string }> = [];
  for (const r of rows) {
    const next = slugs.get(r.id);
    if (next == null) continue;
    if (next === r.name_slug) continue;
    updates.push({ id: r.id, name_slug: next });
    if (sample.length < 25) sample.push({ id: r.id, before: r.name_slug, after: next });
  }
  if (dryRun) {
    return { changed: updates.length, sample };
  }
  const sb = supabaseAdmin();
  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (u) => {
      const { error } = await sb.from("players").update({ name_slug: u.name_slug }).eq("id", u.id);
      if (error) throw new Error(`reslug id=${u.id}: ${error.message}`);
    }));
    if ((i / CHUNK) % 20 === 0) console.log(`  progress: ${(i + chunk.length).toLocaleString()} / ${updates.length.toLocaleString()}`);
  }
  return { changed: updates.length, sample };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const { dryRun } = parseArgs();
  console.log(`Mode: ${dryRun ? "DRY RUN" : "WRITE"}\n`);

  console.log("Phase 1: SDIO link + insert");
  const existing = await fetchAllPlayers();
  console.log(`  loaded ${existing.length.toLocaleString()} existing players`);
  const sdio = await fetchSdioPlayers();
  console.log(`  pulled ${sdio.length.toLocaleString()} SDIO players`);
  const p1 = await linkAndInsertSdio(existing, sdio, dryRun);
  console.log(`  linked: ${p1.linked.toLocaleString()}`);
  console.log(`  inserted (SDIO-only): ${p1.inserted.toLocaleString()}`);
  console.log(`  skipped (no MLBAMID or empty name): ${p1.skipped.toLocaleString()}\n`);

  console.log("Phase 2: Re-slug");
  const p2 = await reslug(dryRun);
  console.log(`  slug changed: ${p2.changed.toLocaleString()}`);
  console.log(`  sample (first 25):`);
  for (const s of p2.sample) {
    console.log(`    id=${s.id}  ${(s.before ?? "<null>").padEnd(36)} → ${s.after}`);
  }
  if (dryRun) console.log("\n(dry run; no writes performed)");
}

main().catch((e) => { console.error(e); process.exit(1); });

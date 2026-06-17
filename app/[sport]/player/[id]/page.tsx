import { notFound } from "next/navigation";
import { isSportVisible } from "@/lib/sports";
import { loadPlayerPageData, renderPlayerContent } from "@/lib/render-player";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { supabaseAdmin } from "@/lib/supabase";

// Player profile at /{sport}/player/{id}. The `id` URL segment accepts
// either:
//   • a canonical slug (`aaron-judge`, `chris-davis-1976`) — the
//     preferred form, emitted by lastNameLinkWeb after migration 0050.
//   • a numeric MLBAMID — preserved for compatibility with any links
//     emitted before the slug rollout (and any external links pointing
//     at the old shape).
//
// We resolve the URL segment to the MLBAMID first, then pass that to
// loadPlayerPageData which keeps using the MLBAMID-keyed cache shape
// from #56/#59. When the canonical email renderer (task #17) ships and
// we delete the DailyData bridge, this resolver can move to keying on
// our internal players.id directly.

export const revalidate = 1800;

async function resolveToMlbId(idSegment: string): Promise<number | null> {
  // Pure-digit segment: trust as MLBAMID and skip the DB lookup.
  if (/^\d+$/.test(idSegment)) {
    const n = parseInt(idSegment, 10);
    return Number.isFinite(n) ? n : null;
  }
  // Slug form: hit the players table.
  const { data, error } = await supabaseAdmin()
    .from("players")
    .select("mlb_id")
    .eq("name_slug", idSegment)
    .maybeSingle();
  if (error || !data?.mlb_id) return null;
  return data.mlb_id as number;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string; id: string }>;
}) {
  const { sport, id } = await params;
  if (sport !== "mlb") return {};
  const personId = await resolveToMlbId(id);
  if (personId == null) return {};
  const data = await loadPlayerPageData(personId);
  if (!data) return {};
  // Year in the title catches "[player] 2026 stats"-style queries, which
  // outweigh the bare-name variant in search volume during the season.
  const year = new Date().getUTCFullYear();
  return {
    title: `${data.person.fullName} — ${year} Game Log and Stats | boxscore`,
    description: `${data.person.fullName} game log, season stats, and recent box scores.`,
    alternates: {
      canonical: `${EMAIL_LINK_BASE}/mlb/player/${id}`,
    },
  };
}

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ sport: string; id: string }>;
}) {
  const { sport, id } = await params;
  if (!(await isSportVisible(sport))) notFound();
  if (sport !== "mlb") notFound();
  const personId = await resolveToMlbId(id);
  if (personId == null) notFound();

  const data = await loadPlayerPageData(personId);
  if (!data) notFound();

  const html = renderPlayerContent(data);
  // Person schema identifies the player as an entity and links them to
  // their team, so search and AI bots can connect "Aaron Judge" the page
  // to "Aaron Judge" the player on the Yankees roster — and cite this
  // page when answering player questions.
  const p = data.person;
  const schema = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${EMAIL_LINK_BASE}/mlb/player/${id}`,
    name: p.fullName,
    url: `${EMAIL_LINK_BASE}/mlb/player/${id}`,
    jobTitle: "Baseball Player",
    ...(p.currentTeam && {
      affiliation: {
        "@type": "SportsTeam",
        name: p.currentTeam.name,
      },
    }),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

import { notFound } from "next/navigation";
import { isSportVisible } from "@/lib/sports";
import { loadPlayerPageData, renderPlayerContent } from "@/lib/render-player";
import { EMAIL_LINK_BASE } from "@/lib/site";

// Player profile at /{sport}/player/{personId}. MLB only for now —
// other sports 404 until they grow a player-page renderer of their own.
// No precomputed cache table: per-player traffic is long-tail, but each
// render fans out 4 MLB API calls so we ISR with a short window. Cached
// pages survive ~30 min; new game data refreshes the next time someone
// visits past the window.

export const revalidate = 1800;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string; id: string }>;
}) {
  const { sport, id } = await params;
  if (sport !== "mlb") return {};
  const personId = parseInt(id, 10);
  if (!Number.isFinite(personId)) return {};
  const data = await loadPlayerPageData(personId);
  if (!data) return {};
  // Year in the title catches "[player] 2026 stats"-style queries, which
  // outweigh the bare-name variant in search volume during the season.
  const year = new Date().getUTCFullYear();
  return {
    title: `${data.person.fullName} — ${year} Game Log and Stats | boxscore`,
    description: `${data.person.fullName} game log, season stats, and recent box scores.`,
    alternates: {
      canonical: `${EMAIL_LINK_BASE}/mlb/player/${personId}`,
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
  const personId = parseInt(id, 10);
  if (!Number.isFinite(personId)) notFound();

  const data = await loadPlayerPageData(personId);
  if (!data) notFound();

  const html = renderPlayerContent(data);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

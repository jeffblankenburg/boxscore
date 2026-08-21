import { todayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { isAdminSession } from "@/lib/admin-auth";
import { getStoredPuzzle, savePuzzle } from "@/lib/games/clubhouse/store";
import { ClubhouseGame } from "./ClubhouseGame";
import "./clubhouse.css";

export const dynamic = "force-dynamic";

const META_DESC = "Group 16 MLB players into the 4 teams they played for. A daily puzzle from boxscore.";
const META_IMG = `${EMAIL_LINK_BASE}/icon.png`;
const META_URL = `${EMAIL_LINK_BASE}/games/clubhouse`;

export const metadata = {
  title: "Clubhouse | boxscore games",
  description: META_DESC,
  openGraph: {
    title: "Clubhouse",
    description: META_DESC,
    url: META_URL,
    siteName: "boxscore games",
    type: "website",
    images: [{ url: META_IMG, alt: "Clubhouse" }],
  },
  twitter: { card: "summary", title: "Clubhouse", description: META_DESC, images: [META_IMG] },
};

export default async function ClubhousePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  // ?date=YYYY-MM-DD lets us preview any day's puzzle (screenshots / QA).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayInET();

  // Read the pre-generated puzzle (a few KB). Fall back to on-demand generation
  // only if the daily cron hasn't produced this date yet — the dynamic import
  // keeps the multi-MB player pool off the normal request path.
  let puzzle = await getStoredPuzzle(date);
  if (!puzzle) {
    const [{ getPuzzleForDate, getAnchorPuzzleForDate }, { getRecentPuzzleTiles, getUsedAnchorIds }] = await Promise.all([
      import("@/lib/games/clubhouse/generate"),
      import("@/lib/games/clubhouse/store"),
    ]);
    // Exclude players (7d) and teams (5d) from the stored days before this date.
    const windowStart = new Date(`${date}T12:00:00Z`); windowStart.setUTCDate(windowStart.getUTCDate() - 7);
    const teamStart = new Date(`${date}T12:00:00Z`); teamStart.setUTCDate(teamStart.getUTCDate() - 5);
    const recent = (await getRecentPuzzleTiles(windowStart.toISOString().slice(0, 10))).filter((r) => r.date < date);
    const exclude = new Set(recent.flatMap((r) => r.ids));
    const excludeTeams = new Set(recent.filter((r) => r.date >= teamStart.toISOString().slice(0, 10)).flatMap((r) => r.teams));
    // Wed/Sat are anchor days (one player quietly eligible for all four teams);
    // fall back to the normal generator off-schedule or if no anchor build fits.
    const isAnchorDay = new Set([3, 6]).has(new Date(`${date}T12:00:00Z`).getUTCDay());
    puzzle =
      (isAnchorDay ? getAnchorPuzzleForDate(date, exclude, excludeTeams, await getUsedAnchorIds()) : null) ??
      getPuzzleForDate(date, exclude, excludeTeams);
    await savePuzzle(date, puzzle).catch(() => {});
  }

  const isAdmin = await isAdminSession();
  return <ClubhouseGame puzzle={puzzle} isAdmin={isAdmin} />;
}

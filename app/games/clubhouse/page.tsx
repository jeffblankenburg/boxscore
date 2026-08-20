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
    const { getPuzzleForDate } = await import("@/lib/games/clubhouse/generate");
    puzzle = getPuzzleForDate(date);
    await savePuzzle(date, puzzle).catch(() => {});
  }

  const isAdmin = await isAdminSession();
  return <ClubhouseGame puzzle={puzzle} isAdmin={isAdmin} />;
}

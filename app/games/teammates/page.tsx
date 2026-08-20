import { todayInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { isAdminSession } from "@/lib/admin-auth";
import { getStoredPuzzle, savePuzzle } from "@/lib/games/teammates/store";
import { TeammatesGame } from "./TeammatesGame";
import "./teammates.css";

export const dynamic = "force-dynamic";

const META_DESC = "Group 16 MLB players into the 4 teams they played for. A daily puzzle from boxscore.";
const META_IMG = `${EMAIL_LINK_BASE}/icon.png`;
const META_URL = `${EMAIL_LINK_BASE}/games/teammates`;

export const metadata = {
  title: "Teammates | boxscore games",
  description: META_DESC,
  openGraph: {
    title: "Teammates",
    description: META_DESC,
    url: META_URL,
    siteName: "boxscore games",
    type: "website",
    images: [{ url: META_IMG, alt: "Teammates" }],
  },
  twitter: { card: "summary", title: "Teammates", description: META_DESC, images: [META_IMG] },
};

export default async function TeammatesPage({
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
    const { getPuzzleForDate } = await import("@/lib/games/teammates/generate");
    puzzle = getPuzzleForDate(date);
    await savePuzzle(date, puzzle).catch(() => {});
  }

  const isAdmin = await isAdminSession();
  return <TeammatesGame puzzle={puzzle} isAdmin={isAdmin} />;
}

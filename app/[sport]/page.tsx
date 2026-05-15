import { notFound } from "next/navigation";
import { getDigest } from "@/lib/digests";
import { prettyDate, yesterdayInET } from "@/lib/dates";

// Bookmarkable league page. URL stays as `/mlb` while rendering the latest
// finalized day's digest. The dated route `/mlb/[date]` continues to serve
// archived dates with stable URLs.
export const dynamic = "force-dynamic";

const VALID_SPORTS = new Set(["mlb"]);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (!VALID_SPORTS.has(sport)) return {};
  const date = yesterdayInET();
  return {
    title: `${sport.toUpperCase()} — ${prettyDate(date)} | boxscore.email`,
    description: `Daily ${sport.toUpperCase()} digest for ${prettyDate(date)}.`,
  };
}

export default async function SportLatest({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (!VALID_SPORTS.has(sport)) notFound();

  const date = yesterdayInET();
  const digest = await getDigest(sport, date);
  if (!digest) notFound();

  return <div dangerouslySetInnerHTML={{ __html: digest.html }} />;
}

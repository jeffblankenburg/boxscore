import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate } from "@/lib/dates";
import { getDigest } from "@/lib/digests";

export const dynamicParams = true;
export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ sport: string; date: string }> }) {
  const { sport, date } = await params;
  if (sport !== "mlb" || !isValidIsoDate(date)) return {};
  return {
    title: `MLB — ${prettyDate(date)} | boxscore.email`,
    description: `Daily MLB digest for ${prettyDate(date)}.`,
  };
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ sport: string; date: string }>;
}) {
  const { sport, date } = await params;
  if (sport !== "mlb") notFound();
  if (!isValidIsoDate(date)) notFound();

  const digest = await getDigest(sport, date);
  if (!digest) notFound();

  return <div dangerouslySetInnerHTML={{ __html: digest.html }} />;
}

import { notFound } from "next/navigation";
import { isValidIsoDate, prettyDate } from "@/lib/dates";
import { getDigest } from "@/lib/digests";
import { getSportById, isSportVisible } from "@/lib/sports";
import { PaperMasthead } from "@/app/PaperMasthead";

export const dynamicParams = true;
export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ sport: string; date: string }> }) {
  const { sport, date } = await params;
  if (!isValidIsoDate(date)) return {};
  const row = await getSportById(sport);
  if (!row || row.visibility !== "public") return {};
  return {
    title: `${row.name} — ${prettyDate(date)} | boxscore`,
    description: `Daily ${row.name} digest for ${prettyDate(date)}.`,
  };
}

export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string; date: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { sport, date } = await params;
  if (!(await isSportVisible(sport))) notFound();
  if (!isValidIsoDate(date)) notFound();

  const digest = await getDigest(sport, date);
  if (!digest) notFound();

  const { paper } = await searchParams;
  const paperMode = paper === "1";

  return (
    <div className={paperMode ? "paper-mode" : undefined}>
      {paperMode && <PaperMasthead date={date} />}
      <div dangerouslySetInnerHTML={{ __html: digest.html }} />
    </div>
  );
}

import { notFound } from "next/navigation";
import { getDigest } from "@/lib/digests";
import { prettyDate, yesterdayInET, nextDay } from "@/lib/dates";
import { getSportById, isSportVisible } from "@/lib/sports";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { PaperMasthead } from "@/app/PaperMasthead";

// Bookmarkable league page. URL stays as `/mlb` while rendering the latest
// finalized day's digest. The dated route `/mlb/[date]` continues to serve
// archived dates with stable URLs.
//
// Sport visibility is read from the sports table; admin_only sports 404
// here regardless of admin status (admins preview via /admin/preview/[sport]).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  const row = await getSportById(sport);
  if (!row || row.visibility !== "public") return {};
  // Title shows the edition date (when the email goes out) rather than the
  // games date — matches the dateline at the top of the page and the way
  // a newspaper labels its day. Canonical points to the dated URL so the
  // bookmarkable /[sport] alias doesn't split ranking signal from the
  // dated /[sport]/[date] page that serves the same content.
  const editionDateIso = nextDay(yesterdayInET());
  const editionDate = prettyDate(editionDateIso);
  return {
    title: `${row.name} Box Scores — ${editionDate} | boxscore`,
    description: `Daily ${row.name} box scores, standings, and stat leaders for ${editionDate}.`,
    alternates: {
      canonical: `${EMAIL_LINK_BASE}/${sport}/${editionDateIso}`,
    },
  };
}

export default async function SportLatest({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { sport } = await params;
  if (!(await isSportVisible(sport))) notFound();

  const date = yesterdayInET();
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

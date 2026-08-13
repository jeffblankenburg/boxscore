import { notFound } from "next/navigation";
import { getLatestDigest } from "@/lib/digests";
import { prettyDate, yesterdayInET, nextDay, daysBetweenISO } from "@/lib/dates";
import { getSportById, isSportVisible, getVisibleSports } from "@/lib/sports";
import { renderMasthead, mastheadNavSports } from "@/lib/masthead";
import { nextScheduledGameDate, seasonStartMonth } from "@/lib/next-game";
import { getSessionSubscriber } from "@/lib/subscriber-session";
import { getLeagueSubscriptions } from "@/lib/email-subscriptions";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { PaperMasthead } from "@/app/PaperMasthead";
import { DateHeaderCalendar } from "@/app/DateHeaderCalendar";

// The latest in-season digest can be weeks old between seasons. Longer than the
// biggest legitimate in-season break — the NFL's ~2 weeks between the
// conference title games and the Super Bowl — means the sport is between
// seasons, so show a countdown to its return instead of a stale edition.
const OFFSEASON_STALE_DAYS = 21;

// Countdown-only offseason state. Exact days when the next opener is on the
// published schedule; otherwise a month-level "returns in <Month>".
function OffseasonNotice({
  name,
  nextIso,
  todayIso,
  fallbackMonth,
  subscribeHref,
}: {
  name: string;
  nextIso: string | null;
  todayIso: string;
  fallbackMonth: string | null;
  // Where "Subscribe Now" points (/subscribe or /settings?sport=…), or null when
  // the viewer already subscribes to this sport — then we show a note instead.
  subscribeHref: string | null;
}) {
  const days = nextIso ? daysBetweenISO(todayIso, nextIso) : null;
  const known = days != null && days > 0;
  return (
    <div
      style={{
        maxWidth: 620,
        margin: "0 auto",
        padding: "3rem 1.5rem 5rem",
        textAlign: "center",
        fontFamily: "'Source Sans 3', system-ui, -apple-system, sans-serif",
        color: "#161410",
      }}
    >
      <div style={{ textTransform: "uppercase", letterSpacing: "0.18em", fontSize: 13, color: "#6b6862" }}>
        {name} — Offseason
      </div>
      {known ? (
        <>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.02, margin: "1.25rem 0 0.25rem" }}>
            {days}
          </div>
          <div style={{ fontSize: 19 }}>{days === 1 ? "day" : "days"} until {name} returns</div>
          <div style={{ fontSize: 15, color: "#6b6862", marginTop: 8 }}>{prettyDate(nextIso!)}</div>
        </>
      ) : (
        <div style={{ fontSize: 24, marginTop: "1.25rem", fontWeight: 600 }}>
          {name} returns in {fallbackMonth ?? "the coming months"}.
        </div>
      )}
      <div style={{ marginTop: "2rem" }}>
        {subscribeHref ? (
          <a
            href={subscribeHref}
            style={{
              display: "inline-block",
              background: "#161410",
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: "0.02em",
              textDecoration: "none",
              padding: "10px 22px",
              borderRadius: 999,
            }}
          >
            Subscribe Now
          </a>
        ) : (
          <div
            style={{
              display: "inline-block",
              background: "#ecebe4",
              color: "#6b6862",
              fontWeight: 500,
              fontSize: 15,
              letterSpacing: "0.02em",
              padding: "10px 22px",
              borderRadius: 999,
            }}
          >
            You’re already subscribed to this newsletter.
          </div>
        )}
      </div>
    </div>
  );
}

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
  // dated /[sport]/[date] page that serves the same content. Read the
  // latest available digest so the title/canonical match what the body
  // will actually render (during the midnight-to-5AM window, "latest" is
  // yesterday's edition, not today's).
  const latest = await getLatestDigest(sport);
  if (!latest) return {};
  const editionDateIso = nextDay(latest.date);
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

  // Ask for the newest in-season digest rather than yesterday-in-ET. Between
  // midnight ET and the ~5 AM ET generate cron, yesterday-in-ET has no row
  // yet — the bookmarkable URL 404'd during that ~5-hour window before this
  // fix. Latest-available preserves the "always shows fresh content" story.
  const digest = await getLatestDigest(sport);
  const today = nextDay(yesterdayInET());

  // Offseason: no in-season digest, or the newest one is older than the longest
  // legitimate in-season break. Show a countdown to the sport's return rather
  // than a 404 or a weeks-stale edition.
  if (!digest || daysBetweenISO(digest.date, today) > OFFSEASON_STALE_DAYS) {
    const row = await getSportById(sport);
    const nextIso = await nextScheduledGameDate(sport);
    // Button target by viewer state:
    //   - not signed in            → /subscribe
    //   - signed in, not on sport  → /settings with this sport's tab open
    //   - signed in, already on it → null (component shows a note, not a button)
    const subscriber = await getSessionSubscriber();
    let subscribeHref: string | null = "/subscribe";
    if (subscriber) {
      const leagueSubs = await getLeagueSubscriptions(subscriber.id);
      subscribeHref = leagueSubs.get(sport) === true ? null : `/settings?sport=${sport}`;
    }
    // Keep the digest masthead (sport nav + dateline) above the countdown. No
    // edition today, so the dateline shows today's date (yesterday + 1).
    const navSports = mastheadNavSports(await getVisibleSports());
    const masthead = renderMasthead({
      date: yesterdayInET(), sport, surface: "web", navSports,
    });
    return (
      <div>
        <div dangerouslySetInnerHTML={{ __html: masthead }} />
        <OffseasonNotice
          name={row?.name ?? sport.toUpperCase()}
          nextIso={nextIso}
          todayIso={today}
          fallbackMonth={seasonStartMonth(sport)}
          subscribeHref={subscribeHref}
        />
      </div>
    );
  }

  const date = digest.date;
  const { paper } = await searchParams;
  const paperMode = paper === "1";
  const editionDate = nextDay(date);

  return (
    <div className={paperMode ? "paper-mode" : undefined}>
      {paperMode && <PaperMasthead date={date} />}
      <div dangerouslySetInnerHTML={{ __html: digest.html }} />
      <DateHeaderCalendar sport={sport} currentDate={editionDate} today={today} />
    </div>
  );
}

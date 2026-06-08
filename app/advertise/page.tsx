import { prettyDate, yesterdayInET } from "@/lib/dates";
import {
  getPublicAdStatsSnapshot,
  readAdStatsSnapshot,
  type PublicAdStats,
} from "@/lib/dashboard";
import {
  CLASSIFIEDS,
  DISPLAY_BOXES,
  FORMAT_META,
  SPONSOR_LINES,
  STANDINGS_STRIPS,
  type AdFormat,
  type AdSample,
} from "@/lib/ads-samples";
import { InquiryForm } from "./InquiryForm";

// Public advertiser-facing page. Stats normally come from the daily
// ad_stats_snapshot table (written by /api/cron/ad-stats-snapshot) — reading
// one row keeps the first render fast as the engagement window grows. If the
// snapshot is missing or older than SNAPSHOT_STALE_AFTER_MS, the page falls
// back to live compute via getPublicAdStatsSnapshot so a broken cron doesn't
// silently show week-old numbers to advertisers. Page revalidates every hour
// on top of that. The page deliberately reads like a section of the newspaper:
// bold sectional masthead, italic lede, stat slab below the fold,
// classified-style rate card, "letters to the editor" inquiry coupon.
// Tone is stats-forward, no marketing voice.

export const revalidate = 3600;

// 48h covers a single missed daily cron plus the next supervisor pass without
// triggering fallback. If the snapshot is older than this, recompute live.
const SNAPSHOT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

async function loadAdStats(): Promise<PublicAdStats> {
  const snapshot = await readAdStatsSnapshot();
  if (snapshot) {
    const ageMs = Date.now() - new Date(snapshot.generatedAt).getTime();
    if (ageMs < SNAPSHOT_STALE_AFTER_MS) return snapshot;
    console.warn(
      `[advertise] snapshot stale (${Math.round(ageMs / 3_600_000)}h old), recomputing live`,
    );
  }
  return getPublicAdStatsSnapshot("mlb", 30);
}

// 2026 industry benchmarks we compare against in the stats slab. Sources:
// Letterhead, Brevo, beehiiv (open + click); Validity, Cleanlist (delivery).
// When boxscore's number is above the threshold, the stat's note shows
// "industry avg X%" so the comparison sells itself; if we ever slip below,
// the note falls back to the original descriptor.
const INDUSTRY = {
  openRateThreshold: 0.43,
  openRateLabel: "43%",
  clickRateThreshold: 0.023,
  clickRateLabel: "2.3%",
  deliveryRateThreshold: 0.89,
  deliveryRateLabel: "89%",
};

export const metadata = {
  title: "Advertise — boxscore",
  description:
    "Sponsorship inventory for boxscore — a daily sports digest delivered every morning. Four ad formats, real engagement numbers, direct booking.",
  alternates: { canonical: "/advertise" },
  // Page is being shared privately with a broker; keep it out of search
  // results until we're ready to publish it. Remove this line to publish.
  robots: { index: false, follow: false },
};

export default async function AdvertisePage() {
  const today = yesterdayInET();
  // Stats are scoped to the MLB LEAGUE digest specifically (the product an
  // advertiser would be sponsoring placements in via this page). Team
  // digests are a separate inventory called out further down. Snapshot read
  // with live-compute fallback — see loadAdStats above.
  const rolling = await loadAdStats();

  // Forward-looking "what an advertiser actually sees per day" — the sum of
  // (1) email opens on the daily league send: subscribers × delivery rate
  //     × open rate. Email convention (FOS, Morning Brew) treats opens as
  //     impressions, not deliveries — reach is bigger, impressions earn CPM.
  // (2) web pageviews per day: total production pageviews over the rolling
  //     window divided by the window length. Sourced from the page_views
  //     table populated by the Vercel Web Analytics Drain.
  // Pageviews are zero until the Drain is configured; the email component
  // works independently.
  const dailyEmailImpressions = rolling.activeSubscribers
    * (rolling.deliveryRate || 1)
    * (rolling.tracked ? rolling.openRate : 1);
  const dailyWebPageviews = rolling.windowDays > 0
    ? rolling.webPageviews / rolling.windowDays
    : 0;
  const avgDailyImpressions = Math.round(dailyEmailImpressions + dailyWebPageviews);

  return (
    <article className="advertise-page">
      <Masthead date={today} />

      <header className="advertise-lede">
        <h1>Place your brand inside the daily box score.</h1>
        <p>
          boxscore is a morning sports digest written like a newspaper —
          standings, leaders, every box score, delivered to subscribers
          who asked for it. Sponsorships sit on the page where the eye
          already is, in formats that read like the rest of the paper.
        </p>
      </header>

      <Section eyebrow="By the numbers" title="An engaged, daily-read audience">
        <p className="advertise-meta">
          MLB league digest, pulled live from the production database. No
          panel data, no estimates. Team digests are a separate inventory
          — see below.
        </p>
        <dl className="advertise-stats">
          <Stat
            value={rolling.activeSubscribers.toLocaleString()}
            label="MLB Subscribers"
          />
          <Stat
            value={avgDailyImpressions.toLocaleString()}
            label="Avg daily impressions"
          />
          <Stat
            value={rolling.tracked ? pct(rolling.openRate) : "—"}
            label="Open rate"
            note={
              !rolling.tracked
                ? "tracking pending"
                : rolling.openRate > INDUSTRY.openRateThreshold
                ? `industry avg ${INDUSTRY.openRateLabel}`
                : `since ${prettyDate(rolling.engagementSince)}`
            }
          />
          {/* Click rate hidden until the in-house link tracker ships
              (issue TBD). Resend click tracking has been disabled to fix
              activation-link breakage, so the prior click rate signal is
              gone and would read "—" until we wire the new tracker. */}
          <Stat
            value={pct(rolling.deliveryRate)}
            label="Delivery rate"
            note={
              rolling.deliveryRate > INDUSTRY.deliveryRateThreshold
                ? `industry avg ${INDUSTRY.deliveryRateLabel}`
                : "successfully reached inbox"
            }
          />
          <Stat
            value={rolling.sends.toLocaleString()}
            label={`Sends in last ${rolling.windowDays} days`}
          />
        </dl>
      </Section>

      <Section eyebrow="Why advertise here" title="What you're buying">
        <div className="advertise-why">
          <Column title="Daily, intentional reads">
            Subscribers asked for this in their inbox and open it before
            their day starts. Not a feed scroll, not a banner served against
            unrelated content — a paper they sat down to read.
          </Column>
          <Column title="Ads that match the page">
            Four formats, all typeset to look like the rest of the newsprint
            (italic sponsor line, classified column, hairline standings
            strip, bordered display box). No banner blindness because none
            of them are banners.
          </Column>
          <Column title="Direct booking, fast turnaround">
            Independent publisher, no ad ops middleman. Inquire today, run
            tomorrow if creative is ready. Long-term commitments get
            priority placement and a discount.
          </Column>
          <Column title="Growing audience">
            From zero to 5,000 subscribers in the first week of launch.
            Multi-sport expansion (NBA, WNBA, NFL) on the roadmap, with
            per-team digests already live for MLB. Early sponsors lock in
            current rates as the list grows.
          </Column>
        </div>
      </Section>

      <Section eyebrow="The inventory" title="Four formats">
        <p className="advertise-meta">
          Ordered least to most visually invasive. Each shown below in the
          same typesetting that subscribers see. Click any digest at{" "}
          <a href={`/mlb/${today}`}>boxscore.email/mlb</a> to see them in
          context.
        </p>
        <div className="advertise-formats">
          <FormatBlock
            format="sponsor-line"
            samples={SPONSOR_LINES.slice(0, 1)}
            slots="1 per send (exclusive)"
            placement="Top, immediately under the dateline"
          />
          <FormatBlock
            format="standings-strip"
            samples={STANDINGS_STRIPS.slice(0, 2)}
            slots="1–2 per send"
            placement="Between leagues or above the box scores"
          />
          <FormatBlock
            format="display-box"
            samples={DISPLAY_BOXES.slice(0, 2)}
            slots="1–2 per send"
            placement="Inside the box-scores grid, next to game tiles"
          />
          <FormatBlock
            format="classified"
            samples={CLASSIFIEDS.slice(0, 3)}
            slots="6–10 per send (sold as a bundle)"
            placement="Above the transactions block at the foot of the page"
          />
        </div>
      </Section>

      <Section eyebrow="Rate card" title="Pricing">
        <p className="advertise-meta">
          Direct-sold. boxscore sends every day during the season — weekly
          is a 7-send commitment, monthly is 28+. Locked rates for the
          duration of the contract. Custom packages quoted on request.
        </p>
        <table className="advertise-rates">
          <thead>
            <tr>
              <th>Format</th>
              <th>Single send</th>
              <th>Weekly (7 sends)</th>
              <th>Monthly (28+ sends)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sponsor line <span className="advertise-rate-note">(top of paper, exclusive)</span></td>
              <td data-label="Single send">$250</td>
              <td data-label="Weekly (7 sends)">$225 each</td>
              <td data-label="Monthly (28+ sends)">$200 each</td>
            </tr>
            <tr>
              <td>Standings strip</td>
              <td data-label="Single send">$175</td>
              <td data-label="Weekly (7 sends)">$155 each</td>
              <td data-label="Monthly (28+ sends)">$135 each</td>
            </tr>
            <tr>
              <td>Display box</td>
              <td data-label="Single send">$200</td>
              <td data-label="Weekly (7 sends)">$180 each</td>
              <td data-label="Monthly (28+ sends)">$160 each</td>
            </tr>
            <tr>
              <td>Classified bundle <span className="advertise-rate-note">(6 lines)</span></td>
              <td data-label="Single send">$100</td>
              <td data-label="Weekly (7 sends)">$85 each</td>
              <td data-label="Monthly (28+ sends)">$70 each</td>
            </tr>
            <tr className="advertise-rate-emphasis">
              <td>Dedicated send <span className="advertise-rate-note">(full edition, one sponsor)</span></td>
              <td data-label="Single send">$750</td>
              <td data-label="Weekly (7 sends)">$675 each</td>
              <td data-label="Monthly (28+ sends)">$600 each</td>
            </tr>
          </tbody>
        </table>
        <p className="advertise-meta advertise-rate-fineprint">
          Rates reflect current MLB league audience size and engagement;
          locked at time of contract for the duration of the commitment.
          Tax + Stripe fees are on the advertiser.
        </p>
      </Section>

      <Section eyebrow="Local? Targeted?" title="Sponsor a team digest">
        <p className="advertise-meta">
          Every MLB club has its own daily digest — the Guardians paper,
          the Yankees paper, the Padres paper — sent only to subscribers
          who opted in for that team. If your business is local (a
          Cleveland restaurant, a Bronx ticket broker, a San Diego brewery),
          team digests target the audience that actually walks past your
          door.
        </p>
        <div className="advertise-team-cards">
          <div className="advertise-team-card">
            <h3>Hyper-local reach</h3>
            <p>
              A sponsor line in the Guardians digest reaches Guardians
              fans, not the entire MLB list. Better fit for local businesses,
              better creative latitude (team-specific tie-ins land harder),
              and a lower price point.
            </p>
          </div>
          <div className="advertise-team-card">
            <h3>Per-team pricing</h3>
            <p>
              Subscriber counts vary by 10× between large and small markets,
              so team-digest rates are quoted individually rather than
              listed. Tell us which team(s) you want and we'll come back
              with a number based on that team's actual audience.
            </p>
          </div>
          <div className="advertise-team-card">
            <h3>Same formats</h3>
            <p>
              Same four ad units (sponsor line, standings strip, display
              box, classified). Same paper-mode aesthetic. Same direct
              booking. Just a smaller, more specific audience.
            </p>
          </div>
        </div>
        <p className="advertise-meta" style={{ marginTop: 14 }}>
          Use the inquiry form below and mention the team(s) you're
          interested in. We'll quote audience size + rates within one
          business day.
        </p>
      </Section>

      <Section eyebrow="House rules" title="What we will and won't run">
        <div className="advertise-rules">
          <div>
            <h3>We're glad to run</h3>
            <ul>
              <li>Sporting goods, apparel, memorabilia, books</li>
              <li>Local businesses (restaurants, bars, services)</li>
              <li>Ticket marketplaces, MLB-affiliated brands</li>
              <li>Consumer apps, fintech, subscription services</li>
              <li>Sports media (podcasts, newsletters, shows)</li>
            </ul>
          </div>
          <div>
            <h3>We won't run</h3>
            <ul>
              <li>Political or issue advocacy</li>
              <li>Hate-driven content of any kind</li>
              <li>Anything that requires deceptive copy or fake urgency</li>
              <li>Crypto / NFT speculation</li>
              <li>Ads inside a box score itself — the data is the product</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section eyebrow="Letters to the editor" title="Get in touch">
        <p className="advertise-meta">
          Tell us what you're after and we'll reply within one business day
          (usually same day). Prefer email? Write to{" "}
          <a href="mailto:hello@boxscore.email">hello@boxscore.email</a>{" "}
          directly.
        </p>
        <InquiryForm />
      </Section>
    </article>
  );
}

function Masthead({ date }: { date: string }) {
  return (
    <div className="advertise-masthead">
      <div className="advertise-masthead-section">Advertise</div>
      <div className="advertise-masthead-edition">
        Media kit · Updated {prettyDate(date)}
      </div>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="advertise-section">
      <div className="advertise-section-head">
        <span className="advertise-section-eyebrow">{eyebrow}</span>
        <h2 className="advertise-section-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Stat({
  value, label, note,
}: { value: string; label: string; note?: string }) {
  return (
    <div className="advertise-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {note && <span className="advertise-stat-note">{note}</span>}
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="advertise-column">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function FormatBlock({
  format, samples, slots, placement,
}: {
  format: AdFormat;
  samples: AdSample[];
  slots: string;
  placement: string;
}) {
  const meta = FORMAT_META[format];
  return (
    <div className="advertise-format">
      <div className="advertise-format-head">
        <h3>{meta.label}</h3>
        <span className="advertise-format-one-liner">{meta.oneLiner}</span>
      </div>
      <p className="advertise-format-pitch">{meta.pitch}</p>
      <dl className="advertise-format-meta">
        <div><dt>Inventory</dt><dd>{slots}</dd></div>
        <div><dt>Placement</dt><dd>{placement}</dd></div>
      </dl>
      <div className="advertise-format-samples">
        {samples.map((s) => (
          <figure key={s.id} className="advertise-format-sample">
            <div
              className="advertise-format-sample-render"
              dangerouslySetInnerHTML={{ __html: s.html }}
            />
            <figcaption>Sample · {s.advertiser}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

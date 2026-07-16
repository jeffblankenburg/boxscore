import { prettyDate, yesterdayInET } from "@/lib/dates";
import { QUARTERLY_STATS } from "@/lib/quarterly-stats";
import {
  CLASSIFIEDS,
  DISPLAY_BOXES,
  FORMAT_META,
  SPONSOR_LINES,
  STANDINGS_STRIPS,
  type AdFormat,
  type AdSample,
} from "@/lib/ads-samples";
import {
  AGE_BANDS,
  COUNTRIES,
  GENDERS,
  INCOME_BANDS,
} from "@/lib/demographics";
import { supabaseAdmin } from "@/lib/supabase";
import { InquiryForm } from "./InquiryForm";
import { CountUp, DemographicBars, Reveal } from "./Animations";

// Public advertiser-facing page. Headline stats come from the shared
// QUARTERLY_STATS module so the PDF one-pager and this page always
// agree — a prospect who reads both sees identical numbers. Stats
// refresh once per quarter (see lib/quarterly-stats.ts for the
// procedure); demographics are still pulled live so the bar chart
// reflects new survey responses as they come in.

export const revalidate = 3600;

// Subscribers who finished the welcome demographics form. Form fields
// are optional, so per-field counts gate on field != null separately.
type DemoRow = {
  country:     string | null;
  region:      string | null;
  age_band:    string | null;
  income_band: string | null;
  gender:      string | null;
};

async function loadDemographics(): Promise<DemoRow[]> {
  const db = supabaseAdmin();
  const out: DemoRow[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("subscribers")
      .select("country, region, age_band, income_band, gender")
      .eq("status", "active")
      .not("demographics_completed_at", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`advertise demographics: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as DemoRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// Per-field % distribution of respondents. The denominator excludes
// nulls and "prefer-not-to-say" so each bar reads as "share of those
// who actually answered". "Other" (the country catch-all) is dropped
// the same way since it's labelled "Other / Prefer not to say".
const DEMO_OPT_OUTS = new Set(["prefer-not-to-say", "Other"]);
type Bucket = { label: string; pct: number };
function bucketPct(
  rows: DemoRow[],
  field: keyof DemoRow,
  options: ReadonlyArray<{ value: string; label: string }>,
): Bucket[] {
  const valid = rows.filter((r) => {
    const v = r[field];
    return v != null && !DEMO_OPT_OUTS.has(v);
  });
  const total = valid.length;
  if (!total) return [];
  const counts = new Map<string, number>();
  for (const r of valid) {
    const v = r[field] as string;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return options
    .filter((o) => !DEMO_OPT_OUTS.has(o.value))
    .map((o) => ({
      label: o.label,
      pct: ((counts.get(o.value) ?? 0) / total) * 100,
    }));
}

// Industry benchmarks shown alongside our numbers so the comparison
// sells itself. Open: Letterhead/Brevo/beehiiv 2026 reports.
const INDUSTRY_OPEN_RATE_LABEL = "43%";

export const metadata = {
  title: "Advertise — boxscore",
  description:
    "Sponsorship inventory for boxscore — a daily sports digest delivered every morning. Four ad formats, real engagement numbers, direct booking.",
  alternates: { canonical: "/advertise" },
};

export default async function AdvertisePage() {
  const today = yesterdayInET();
  const Q = QUARTERLY_STATS;

  // Demographics still pulled live — the survey grows continuously and
  // the bar chart wants the most-recent split. Headline stats stay
  // frozen per quarter via QUARTERLY_STATS so the PDF and page match.
  const demoRows = await loadDemographics();
  const ageDist     = bucketPct(demoRows, "age_band",    AGE_BANDS);
  const incomeDist  = bucketPct(demoRows, "income_band", INCOME_BANDS);
  const genderDist  = bucketPct(demoRows, "gender",      GENDERS);
  const countryDist = bucketPct(demoRows, "country",     COUNTRIES).filter((c) => c.pct > 0);
  const hasDemographics =
    ageDist.length > 0 || incomeDist.length > 0 || genderDist.length > 0 || countryDist.length > 0;

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
        <dl className="advertise-stats">
          <Stat
            value={<CountUp to={Q.totalSubscribers} />}
            label="Subscribers"
          />
          <Stat
            value={<CountUp to={Q.dailyImpressions} />}
            label="Avg daily impressions"
            note="unique league-digest opens + web views, trailing 14-day avg"
          />
          <Stat
            value={<CountUp to={Q.openRate} format="percent" />}
            label="Open rate"
            note={`industry avg ${INDUSTRY_OPEN_RATE_LABEL}`}
          />
          <Stat
            value={<CountUp to={Q.sendsLast30d} />}
            label="Sends · last 30 days"
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

      {hasDemographics && (
        <Section eyebrow="Who reads it" title="The audience, by self-report">
          <p className="advertise-meta">
            Pulled from the welcome form subscribers fill out after they confirm.
            Percentages are share of respondents who answered each question.
            &ldquo;Prefer not to say&rdquo; is excluded from every denominator.
          </p>
          <div className="advertise-demographics">
            {ageDist.length > 0 && (
              <div className="advertise-demographic">
                <h3>Age</h3>
                <DemographicBars rows={ageDist} />
              </div>
            )}
            {incomeDist.length > 0 && (
              <div className="advertise-demographic">
                <h3>Household income</h3>
                <DemographicBars rows={incomeDist} />
              </div>
            )}
            {genderDist.length > 0 && (
              <div className="advertise-demographic">
                <h3>Gender / identity</h3>
                <DemographicBars rows={genderDist} />
              </div>
            )}
            {countryDist.length > 0 && (
              <div className="advertise-demographic">
                <h3>Country</h3>
                <DemographicBars rows={countryDist} />
              </div>
            )}
          </div>
        </Section>
      )}

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
              <th>Weekly (7 sends)</th>
              <th>Monthly (28+ sends)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sponsor line <span className="advertise-rate-note">(top of paper, exclusive)</span></td>
              <td data-label="Weekly (7 sends)">$650</td>
              <td data-label="Monthly (28+ sends)">$2,200</td>
            </tr>
            <tr>
              <td>Display box</td>
              <td data-label="Weekly (7 sends)">$500</td>
              <td data-label="Monthly (28+ sends)">$1,750</td>
            </tr>
            <tr>
              <td>Standings strip</td>
              <td data-label="Weekly (7 sends)">$400</td>
              <td data-label="Monthly (28+ sends)">$1,400</td>
            </tr>
            <tr>
              <td>Classified bundle <span className="advertise-rate-note">(6 lines)</span></td>
              <td data-label="Weekly (7 sends)">$250</td>
              <td data-label="Monthly (28+ sends)">$850</td>
            </tr>
            <tr>
              <td>Dedicated send <span className="advertise-rate-note">(full edition, one sponsor)</span></td>
              <td data-label="Weekly (7 sends)">$1,950</td>
              <td data-label="Monthly (28+ sends)">$6,900</td>
            </tr>
          </tbody>
        </table>
        <p className="advertise-meta advertise-rate-fineprint">
          Rates reflect current MLB league audience size and engagement;
          locked at time of contract for the duration of the commitment.
          Tax + Stripe fees are on the advertiser.
        </p>
      </Section>

      <Section eyebrow="Fanbase-specific" title="Sponsor a team digest">
        <p className="advertise-meta">
          Every MLB club has its own daily digest — the Guardians paper,
          the Yankees paper, the Padres paper — sent only to subscribers
          who opted in for that team. These lists reach that team's fans
          nationwide, not the city. Right fit for advertisers selling to
          a specific fanbase (a team-merch shop that ships everywhere, a
          brand that wants to align with one franchise).
        </p>
        <div className="advertise-team-cards">
          <div className="advertise-team-card">
            <h3>Fanbase-focused reach</h3>
            <p>
              A sponsor line in the Guardians digest reaches Guardians
              fans wherever they live, not the entire MLB list. Better fit
              for fan-affinity brands and team-specific creative, with a
              lower price point.
            </p>
          </div>
          <div className="advertise-team-card">
            <h3>Per-team pricing</h3>
            <p>
              Subscriber counts vary by 10× between large and small
              fanbases, so team-digest rates are quoted individually
              rather than listed. Tell us which team(s) you want and we'll
              come back with a number based on that team's actual audience.
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
              <li>National DTC brands — apparel, gear, memorabilia, books</li>
              <li>Online sports-card and collectibles marketplaces</li>
              <li>Ticket marketplaces and travel packages that ship nationwide</li>
              <li>Consumer apps, fintech, subscription services with a U.S. footprint</li>
              <li>Sports media (podcasts, newsletters, shows) looking for crossover audiences</li>
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
        Media kit · Updated {prettyDate(date)} ·{" "}
        <a href="/advertise/login">Advertiser sign-in</a>
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
      <Reveal>
        <div className="advertise-section-head">
          <span className="advertise-section-eyebrow">{eyebrow}</span>
          <h2 className="advertise-section-title">{title}</h2>
        </div>
      </Reveal>
      <Reveal delay={120}>{children}</Reveal>
    </section>
  );
}

function Stat({
  value, label, note,
}: { value: React.ReactNode; label: string; note?: string }) {
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

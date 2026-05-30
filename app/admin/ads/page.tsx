import { requireAdmin } from "../require-admin";
import { AdminNav } from "../AdminNav";
import { loadDailyData } from "@/lib/daily";
import { renderContent } from "@/lib/render";
import { MLB_PREVIEW_FIXTURES } from "@/lib/mlb-preview-fixtures";
import { prettyDate } from "@/lib/dates";
import {
  getYesterdayAdStats,
  getRollingAdStats,
  type AdStatsBucket,
  type AdStatsDailyPoint,
  type RollingAdStats,
  type YesterdayAdStats,
} from "@/lib/dashboard";
import {
  ALL_AD_SAMPLES,
  CLASSIFIEDS,
  DISPLAY_BOXES,
  FORMAT_META,
  SPONSOR_LINES,
  STANDINGS_STRIPS,
  type AdFormat,
  type AdSample,
} from "@/lib/ads-samples";

// /admin/ads — Advertising exploration.
//
// Design + sales scratch, not a live ad system. The catalog (top) shows each
// format on a newsprint swatch; the preview (bottom) runs the REAL MLB
// renderer against the `regular` preview fixture and splices ads at the
// digest's actual section anchors.

export const dynamic = "force-dynamic";
export const metadata = { title: "Ads · admin · boxscore", robots: { index: false } };

void ALL_AD_SAMPLES; // keep the aggregate export tree-shake-stable

export default async function AdsPage() {
  await requireAdmin();

  // Real MLB digest for the canonical regular-season preview fixture, in
  // the default web view (not paper-mode) — same renderer call subscribers
  // hit at /mlb/[date].
  const gamesDate = MLB_PREVIEW_FIXTURES.regular;
  const [data, yesterday, rolling] = await Promise.all([
    loadDailyData(gamesDate),
    getYesterdayAdStats(),
    getRollingAdStats(30),
  ]);
  const baseHtml = renderContent(data);
  const adInjectedHtml = spliceAdsInto(baseHtml);

  return (
    <main className="admin admin-wide">
      <AdminNav active="ads" />
      <h1>Ads (exploration)</h1>

      <p className="admin-meta">
        Sample advertising inventory designed to live alongside the paper-mode
        digest. None of this is live or sold. Four formats below, ordered least
        → most visually invasive. The preview at the bottom runs the <em>real</em>
        MLB renderer with ads spliced into the actual section anchors.
      </p>

      <section>
        <h2>Audience &amp; engagement</h2>
        <p className="admin-meta">
          What an advertiser would see in a pitch sheet. Sends + opens + clicks
          are real production numbers from this site&apos;s digests. Open rate
          is opens per delivered (Apple Mail Privacy Protection inflates this);
          click rate is opens-or-not, the more honest engagement signal.
        </p>
        <div className="ad-stats-grid">
          <YesterdayCard stats={yesterday} />
          <RollingCard stats={rolling} />
        </div>
        <OpensClicksChart daily={rolling.daily} tracked={rolling.tracked} />
      </section>

      <section>
        <h2>Catalog</h2>
        <div className="ad-catalog">
          <FormatBlock format="sponsor-line" samples={SPONSOR_LINES} />
          <FormatBlock format="classified" samples={CLASSIFIEDS} />
          <FormatBlock format="standings-strip" samples={STANDINGS_STRIPS} />
          <FormatBlock format="display-box" samples={DISPLAY_BOXES} />
        </div>
      </section>

      <section>
        <h2>Preview — ads spliced into the real {gamesDate} digest</h2>
        <p className="admin-meta">
          Live output of <code>renderContent(loadDailyData(&quot;{gamesDate}&quot;))</code>
          {" "}— the MLB regular-season preview fixture — with ads inserted at
          the real section anchors: sponsor line after the masthead,
          standings strip between leagues, display boxes between major
          sections, classifieds above the transactions block. Never inside a
          box score.
        </p>
        <div className="ad-preview-frame">
          <div className="newspaper">
            <div dangerouslySetInnerHTML={{ __html: adInjectedHtml }} />
          </div>
        </div>
      </section>

      <section>
        <h2>Inventory math (sketch)</h2>
        <p className="admin-meta">
          Rough capacity per regular-season MLB digest. Numbers assume current
          layout, no inventory padding. Use as starting point only.
        </p>
        <table className="admin-cron-runs">
          <thead>
            <tr>
              <th>Format</th>
              <th style={{ textAlign: "right" }}>Slots / digest</th>
              <th>Placement rule</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sponsor line</td>
              <td style={{ textAlign: "right" }}>1–2</td>
              <td>One top, one bottom. Single advertiser per send.</td>
            </tr>
            <tr>
              <td>Standings strip</td>
              <td style={{ textAlign: "right" }}>1–2</td>
              <td>Between schedule and box scores. Light enough to repeat.</td>
            </tr>
            <tr>
              <td>Display box</td>
              <td style={{ textAlign: "right" }}>1–2</td>
              <td>Only inside the box-scores column grid, between game tiles. Too visually heavy for between-section placements.</td>
            </tr>
            <tr>
              <td>Classified line</td>
              <td style={{ textAlign: "right" }}>6–10</td>
              <td>Single block above transactions. Sold as a bundle.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}

function FormatBlock({ format, samples }: { format: AdFormat; samples: AdSample[] }) {
  const meta = FORMAT_META[format];
  return (
    <div className="ad-catalog-format">
      <div className="ad-catalog-format-head">
        <h3>{meta.label}</h3>
        <span className="ad-catalog-format-one-liner">{meta.oneLiner}</span>
      </div>
      <p className="ad-catalog-format-pitch">{meta.pitch}</p>
      <div className="ad-catalog-samples">
        {samples.map((s) => (
          <figure key={s.id} className="ad-catalog-sample">
            <div
              className="ad-catalog-sample-render newspaper paper-mode"
              dangerouslySetInnerHTML={{ __html: s.html }}
            />
            <figcaption className="ad-catalog-sample-caption">
              {s.advertiser}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

// Splice ads into the real renderContent() output at known section anchors.
// renderContent's regular-mode template is stable:
//
//   <div class="dateline">…</div>
//   <div class="section"> …AL standings + leaders… </div>
//   <div class="section"> …NL standings + leaders… </div>
//   <renderSchedule>
//   <renderTodaysGames>
//   <div class="boxscores-title">Yesterday's Box Scores</div>
//   <div class="boxscores-container"> …game tiles… </div>
//   <div class="transactions-section">…</div>
//
// Display boxes are too visually heavy for between-section placement; they
// only earn their footprint when sitting *inside* the boxscores column grid
// alongside game tiles (same column width, similar density). The other
// placements use the lighter formats: sponsor line, standings strip,
// classifieds.
function spliceAdsInto(html: string): string {
  const sponsor = SPONSOR_LINES.find((s) => s.id === "sponsor-kalshi") ?? SPONSOR_LINES[0]!;
  const strip = STANDINGS_STRIPS[0]!;
  const displayBox = DISPLAY_BOXES.find((d) => d.id === "display-kalshi") ?? DISPLAY_BOXES[0]!;
  const classifiedsBlock = `<div class="ad-classifieds-block">
    <div class="ad-classifieds-header">Classifieds</div>
    <div class="ad-classifieds-body">
      ${CLASSIFIEDS.slice(0, 6).map((c) => c.html).join("")}
    </div>
  </div>`;

  let out = html;

  // 1. Sponsor line — right after the dateline.
  out = out.replace(
    /(<div class="dateline">[\s\S]*?<\/div>\s*<\/div>)/,
    `$1\n${sponsor.html}`,
  );

  // 2. Standings strip — immediately before the boxscores title.
  out = out.replace(
    /(<div class="boxscores-title">Yesterday's Box Scores<\/div>)/,
    `${strip.html}\n$1`,
  );

  // 3. Display box — inside the boxscores grid, after the second game tile.
  // The grid is a CSS column layout, so the display box flows into a column
  // alongside the .game-container tiles. We find the third occurrence of
  // `<div class="game-container">` (i.e. after 2 games) and inject before it.
  let nthGame = 0;
  out = out.replace(/<div class="game-container">/g, (match) => {
    nthGame++;
    if (nthGame === 3) return `${displayBox.html}\n${match}`;
    return match;
  });

  // 4. Classifieds — directly above the transactions block.
  out = out.replace(
    /(<div class="transactions-section">)/,
    `${classifiedsBlock}\n$1`,
  );

  return out;
}

// ─── Stats cards + chart ─────────────────────────────────────────────────

function YesterdayCard({ stats }: { stats: YesterdayAdStats }) {
  const empty = stats.sends === 0;
  return (
    <div className="ad-stats-card">
      <div className="ad-stats-card-eyebrow">Yesterday</div>
      <div className="ad-stats-card-headline">{prettyDate(stats.date)}</div>
      {empty ? (
        <p className="admin-meta">No sends recorded.</p>
      ) : (
        <>
          <dl className="ad-stats-card-grid">
            <Stat label="Sends" value={stats.sends.toLocaleString()} />
            <Stat label="Delivered" value={stats.delivered.toLocaleString()} />
            <Stat label="Open rate" value={pct(stats.openRate, stats.tracked)} />
            <Stat label="Click rate" value={pct(stats.clickRate, stats.tracked)} />
          </dl>
          {stats.breakdown.length > 1 && (
            <details className="ad-stats-breakdown">
              <summary>Break down by digest type</summary>
              <table className="ad-stats-breakdown-table">
                <thead>
                  <tr>
                    <th>Digest</th>
                    <th style={{ textAlign: "right" }}>Sends</th>
                    <th style={{ textAlign: "right" }}>Delivered</th>
                    <th style={{ textAlign: "right" }}>Open rate</th>
                    <th style={{ textAlign: "right" }}>Click rate</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.breakdown.map((b) => (
                    <BreakdownRow key={`${b.sport}-${b.scope}`} bucket={b} tracked={stats.tracked} />
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function BreakdownRow({ bucket, tracked }: { bucket: AdStatsBucket; tracked: boolean }) {
  const openRate = bucket.delivered === 0 ? 0 : bucket.opened / bucket.delivered;
  const clickRate = bucket.delivered === 0 ? 0 : bucket.clicked / bucket.delivered;
  const label = bucket.scope === "league"
    ? `${bucket.sport.toUpperCase()} — league digest`
    : `${bucket.sport.toUpperCase()} — team digests`;
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: "right" }}>{bucket.sends.toLocaleString()}</td>
      <td style={{ textAlign: "right" }}>{bucket.delivered.toLocaleString()}</td>
      <td style={{ textAlign: "right" }}>{pct(openRate, tracked)}</td>
      <td style={{ textAlign: "right" }}>{pct(clickRate, tracked)}</td>
    </tr>
  );
}

function RollingCard({ stats }: { stats: RollingAdStats }) {
  const sendDays = stats.daily.filter((d) => d.opened > 0 || d.clicked > 0).length;
  const avgDailyImpressions = sendDays === 0
    ? 0
    : Math.round(stats.delivered / Math.max(1, sendDays));
  return (
    <div className="ad-stats-card">
      <div className="ad-stats-card-eyebrow">Rolling {stats.days} days</div>
      <div className="ad-stats-card-headline">
        {stats.activeSubscribers.toLocaleString()} active subscribers
      </div>
      <dl className="ad-stats-card-grid">
        <Stat label="Avg daily impressions" value={avgDailyImpressions.toLocaleString()} />
        <Stat label="Delivery rate" value={pct(stats.deliveryRate, true)} />
        <Stat label="Open rate" value={pct(stats.openRate, stats.tracked)} />
        <Stat label="Click rate" value={pct(stats.clickRate, stats.tracked)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ad-stats-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function pct(n: number, tracked: boolean): string {
  if (!tracked) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// Two-line SVG chart: opens (blue) and clicks (green) per day for the rolling
// window. No axis labels except the endpoints — this is a trend-shape card,
// not a precision dashboard. The numeric totals are already in the cards
// above; the chart's job is to show whether engagement is steady, growing,
// or collapsing.
function OpensClicksChart({
  daily, tracked,
}: { daily: AdStatsDailyPoint[]; tracked: boolean }) {
  if (!tracked) {
    return (
      <p className="admin-meta ad-stats-chart-empty">
        Open tracking hasn&apos;t recorded any events yet — chart will appear
        once Resend starts injecting the pixel.
      </p>
    );
  }
  const opens = daily.map((d) => d.opened);
  const clicks = daily.map((d) => d.clicked);
  const max = Math.max(1, ...opens, ...clicks);
  const W = 900, H = 200;
  const padL = 32, padR = 12, padT = 12, padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xAt = (i: number) =>
    daily.length === 1 ? padL + innerW / 2 : padL + (i / (daily.length - 1)) * innerW;
  const yAt = (v: number) => padT + innerH - (v / max) * innerH;
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");

  const firstDate = daily[0]?.date ?? "";
  const lastDate = daily[daily.length - 1]?.date ?? "";

  return (
    <div className="ad-stats-chart">
      <div className="ad-stats-chart-legend">
        <span className="ad-stats-chart-swatch ad-stats-chart-swatch-opens" /> Opens
        <span className="ad-stats-chart-swatch ad-stats-chart-swatch-clicks" /> Clicks
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily opens and clicks over ${daily.length} days`}>
        {[0, 0.5, 1].map((t, i) => {
          const y = padT + innerH * t;
          const v = max * (1 - t);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="admin-chart-grid" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="admin-chart-axis">
                {Math.round(v).toLocaleString()}
              </text>
            </g>
          );
        })}
        <path d={path(opens)} className="ad-stats-chart-opens" />
        <path d={path(clicks)} className="ad-stats-chart-clicks" />
        <text x={padL} y={H - 6} textAnchor="start" className="admin-chart-axis">{firstDate.slice(5)}</text>
        <text x={W - padR} y={H - 6} textAnchor="end" className="admin-chart-axis">{lastDate.slice(5)}</text>
      </svg>
    </div>
  );
}

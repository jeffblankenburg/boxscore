import { notFound } from "next/navigation";
import { getSlate } from "@/lib/mlb";
import { todayInET, timeInET } from "@/lib/dates";
import { EMAIL_LINK_BASE } from "@/lib/site";
import { loadFantasyForDate } from "@/lib/sports/mlb/fantasy-data";
import {
  HITTER_CATEGORIES,
  type FantasyHitterRow,
  type FantasySpRow,
  type HitterCategory,
} from "@/lib/sports/mlb/fantasy";
import "./fantasy.css";

// Refresh every 5 minutes so lineups posted between cron polls show up
// without a full rebuild. The data layer is light enough (one statsapi
// call + ~3 indexed Supabase queries) that the cost is trivial.
export const revalidate = 300;
export const dynamic = "force-dynamic";

const HITTERS_PER_CATEGORY = 10;
const SPS_TOTAL = 10;

const POSITION_LABELS: Record<HitterCategory, string> = {
  C: "Catcher",
  "1B": "First Base",
  "2B": "Second Base",
  SS: "Shortstop",
  "3B": "Third Base",
  OF: "Outfield",
  DH: "Designated Hitter",
};

type FantasyData = {
  date: string;
  generatedAt: string;
  gameCount: number;
  confirmedCount: number;
  firstPitchEt: string | null;
  byPosition: Record<HitterCategory, FantasyHitterRow[]>;
  startingPitchers: FantasySpRow[];
};

async function loadFantasy(date: string): Promise<FantasyData> {
  // Slate fetched once more here to derive firstPitchEt for the subtitle.
  // The data-loader fetches its own copy; Next/fetch dedup makes this
  // effectively one network call per request.
  let firstPitch: string | null = null;
  try {
    const slate = await getSlate(date);
    firstPitch = slate
      .filter((g) => g.status === "scheduled")
      .map((g) => g.gameDate)
      .sort()[0] ?? null;
  } catch {
    firstPitch = null;
  }

  const { projections } = await loadFantasyForDate(date);

  return {
    date,
    generatedAt: projections.generatedAt,
    gameCount: projections.gameCount,
    confirmedCount: projections.confirmedCount,
    firstPitchEt: firstPitch ? timeInET(firstPitch) : null,
    byPosition: projections.byPosition,
    startingPitchers: projections.startingPitchers.slice(0, SPS_TOTAL),
  };
}

// ─── Formatting helpers (display-only) ───────────────────────────────────

function fmtRate(v: number): string {
  if (!Number.isFinite(v) || v === 0) return ".—";
  const s = v.toFixed(3);
  return v < 1 ? s.replace(/^0/, "") : s;
}
function fmt2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
function fmt1(v: number): string {
  return v.toFixed(1);
}
function fmt0(v: number): string {
  return v.toFixed(0);
}
function teamHref(abbr: string): string {
  return `/mlb/${abbr.toLowerCase()}`;
}
function playerHref(row: { nameSlug: string | null; playerId: number }): string {
  return row.nameSlug ? `/mlb/player/${row.nameSlug}` : `/mlb/player/${row.playerId}`;
}

// ─── Metadata ────────────────────────────────────────────────────────────

const META_TITLE = "Daily Fantasy Projections | boxscore";
const META_DESC =
  "Daily MLB fantasy projections — top hitters by position and starting pitchers for tonight's slate. Updates as lineups post.";
const META_URL = `${EMAIL_LINK_BASE}/mlb/fantasy`;
const META_IMG = `${EMAIL_LINK_BASE}/icon.png`;

export const metadata = {
  title: META_TITLE,
  description: META_DESC,
  alternates: { canonical: "/mlb/fantasy" },
  openGraph: {
    title: META_TITLE,
    description: META_DESC,
    url: META_URL,
    siteName: "boxscore",
    type: "website",
    images: [{ url: META_IMG, alt: "boxscore" }],
  },
  twitter: {
    card: "summary",
    title: META_TITLE,
    description: META_DESC,
    images: [META_IMG],
  },
};

// ─── Page ────────────────────────────────────────────────────────────────

export default async function FantasyPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();
  const today = todayInET();
  const data = await loadFantasy(today);

  return (
    <div className="fa-page">
      <h1 className="fa-title">Daily Fantasy</h1>
      <p className="fa-subtitle">
        {prettySubtitle(data)}
      </p>

      <p className="fa-note">
        Hitter score combines DraftKings-style fantasy points (1B=3, 2B=5, 3B=8, HR=10, R/RBI/BB=2, SB=5) projected from
        season rate stats &times; lineup-slot PA expectation &times; opposing-SP matchup factor.
        SP score combines 2.25/IP + 2/K &minus; 2/ER over a 5.5-IP outing, modulated by opposing lineup OPS.
        Projected rows use the team's most-active hitters until lineups post; confirmed rows lock in once MLB releases the lineup.
        v1 does not include rolling form, park factors, or platoon splits.
      </p>

      {data.gameCount === 0 ? (
        <p className="fa-empty">No games on the slate today.</p>
      ) : (
        <>
          <SpSection rows={data.startingPitchers} />
          {HITTER_CATEGORIES.map((cat) => (
            <HitterSection
              key={cat}
              category={cat}
              rows={data.byPosition[cat].slice(0, HITTERS_PER_CATEGORY)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function prettySubtitle(data: FantasyData): string {
  const parts: string[] = [];
  parts.push(prettyDate(data.date));
  if (data.gameCount > 0) {
    const games = `${data.gameCount} game${data.gameCount === 1 ? "" : "s"}`;
    const conf = data.confirmedCount > 0
      ? `${data.confirmedCount} lineup${data.confirmedCount === 1 ? "" : "s"} confirmed`
      : "no lineups posted yet";
    parts.push(`${games} (${conf})`);
  }
  if (data.firstPitchEt) parts.push(`First pitch: ${data.firstPitchEt}`);
  return parts.join(" · ");
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

// ─── SP table ────────────────────────────────────────────────────────────

function SpSection({ rows }: { rows: FantasySpRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="fa-section">
      <h2 className="fa-section-title">Starting Pitchers</h2>
      <div className="fa-scroll">
        <table className="fa-table">
          <thead>
            <tr>
              <th className="fa-col-rank">#</th>
              <th className="fa-col-name">Pitcher</th>
              <th className="fa-col-matchup">Matchup</th>
              <th>IP</th>
              <th>K</th>
              <th>W</th>
              <th>ERA</th>
              <th>WHIP</th>
              <th>K/9</th>
              <th>Opp OPS</th>
              <th className="fa-col-score">Proj</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.playerId}>
                <td className="fa-col-rank">{i + 1}</td>
                <td className="fa-col-name">
                  <a className="fa-name-link" href={playerHref(r)}>
                    {r.name}
                  </a>
                  {r.throws && <span className="fa-handed"> {r.throws}HP</span>}
                </td>
                <td className="fa-col-matchup">
                  <a className="fa-team-link" href={teamHref(r.teamAbbr)}>{r.teamAbbr}</a>
                  <span className="fa-vs">{r.isHome ? " vs " : " @ "}</span>
                  <a className="fa-team-link" href={teamHref(r.oppAbbr)}>{r.oppAbbr}</a>
                </td>
                <td>{fmt1(r.season.ip)}</td>
                <td>{fmt0(r.season.k)}</td>
                <td>{fmt0(r.season.w)}</td>
                <td>{fmt2(r.season.era)}</td>
                <td>{fmt2(r.season.whip)}</td>
                <td>{fmt1(r.season.k9)}</td>
                <td>{fmtRate(r.oppOffense.avgOps)}</td>
                <td className="fa-col-score">{fmt1(r.projection.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Hitter tables ───────────────────────────────────────────────────────

function HitterSection({ category, rows }: { category: HitterCategory; rows: FantasyHitterRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="fa-section">
      <h2 className="fa-section-title">{POSITION_LABELS[category]}</h2>
      <div className="fa-scroll">
        <table className="fa-table">
          <thead>
            <tr>
              <th className="fa-col-rank">#</th>
              <th className="fa-col-name">Hitter</th>
              <th className="fa-col-matchup">Matchup</th>
              <th className="fa-col-slot">Slot</th>
              <th>AVG</th>
              <th>OPS</th>
              <th>HR</th>
              <th>RBI</th>
              <th>SB</th>
              <th>vs SP</th>
              <th className="fa-col-mf">Mch</th>
              <th className="fa-col-score">Proj</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.playerId} className={r.lineupStatus === "projected" ? "fa-row-projected" : ""}>
                <td className="fa-col-rank">{i + 1}</td>
                <td className="fa-col-name">
                  <a className="fa-name-link" href={playerHref(r)}>
                    {r.name}
                  </a>
                  {r.bats && <span className="fa-handed"> {r.bats}HB</span>}
                </td>
                <td className="fa-col-matchup">
                  <a className="fa-team-link" href={teamHref(r.teamAbbr)}>{r.teamAbbr}</a>
                  <span className="fa-vs">{r.isHome ? " vs " : " @ "}</span>
                  <a className="fa-team-link" href={teamHref(r.oppAbbr)}>{r.oppAbbr}</a>
                </td>
                <td className="fa-col-slot">
                  {r.lineupStatus === "confirmed" && r.battingOrder
                    ? r.battingOrder
                    : <span className="fa-badge-proj" title="Lineup not posted">P</span>}
                </td>
                <td>{fmtRate(r.season.avg)}</td>
                <td>{fmtRate(r.season.ops)}</td>
                <td>{fmt0(r.season.hr)}</td>
                <td>{fmt0(r.season.rbi)}</td>
                <td>{fmt0(r.season.sb)}</td>
                <td className="fa-col-vssp">
                  {r.oppSp
                    ? <>
                        {r.oppSp.name}
                        {r.oppSp.era !== null && <span className="fa-vssp-era"> ({fmt2(r.oppSp.era)})</span>}
                      </>
                    : "TBD"}
                </td>
                <td className="fa-col-mf">{r.projection.matchupFactor.toFixed(2)}</td>
                <td className="fa-col-score">{fmt1(r.projection.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

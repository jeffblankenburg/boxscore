import Link from "next/link";
import { requireAdmin } from "../require-admin";
import { SubmitButton } from "../SubmitButton";
import { renderScoreboardImage } from "../actions";
import { ScoreboardImage, type ScoreTile } from "@/lib/scoreboard-image";
import { scoreTilesForSport, scoreboardGamesDate } from "@/lib/scoreboard-tiles";
import { getScoreboardShareImageUrl } from "@/lib/share-storage";
import { NCAAF_CONFERENCES } from "@/lib/sports/football/conferences";
import { isValidIsoDate, yesterdayInET, nextDay, prettyDate } from "@/lib/dates";

// Admin review surface for the daily scoreboard share images, every sport. Each
// board is the real <ScoreboardImage> rendered inline (same component + data the
// /share/[sport]/[date] capture uses), scaled to fit. NCAAF fans out into a Top
// 25 board + one per conference, and only boards with prior-day games render
// (skip-empty) — mirroring how the posting cron will behave.

export const dynamic = "force-dynamic";
export const metadata = { title: "Share-image preview — admin", robots: { index: false } };

const SPORTS = ["mlb", "nba", "wnba", "nfl", "ncaaf"] as const;

type Board = { label?: string; scores: ScoreTile[] };

async function boardsFor(sport: string, gamesDate: string): Promise<Board[]> {
  if (sport === "ncaaf") {
    const scopes = ["top25", ...NCAAF_CONFERENCES.map((c) => c.slug)];
    const all = await Promise.all(
      scopes.map(async (scope) => ({
        label: scope === "top25" ? "Top 25" : (NCAAF_CONFERENCES.find((c) => c.slug === scope)?.short ?? scope),
        scores: await scoreTilesForSport("ncaaf", gamesDate, { ncaafScope: scope }),
      })),
    );
    // Only boards that actually had games that day (see ncaaf-scoreboard-cadence).
    return all.filter((b) => b.scores.length > 0);
  }
  return [{ scores: await scoreTilesForSport(sport, gamesDate) }];
}

export default async function ShareImagePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; date?: string; ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const sport = (SPORTS as readonly string[]).includes(sp.sport ?? "") ? sp.sport! : "mlb";
  const editionDate = sp.date && isValidIsoDate(sp.date) ? sp.date : nextDay(yesterdayInET());
  const gamesDate = scoreboardGamesDate(editionDate);

  const boards = await boardsFor(sport, gamesDate);
  const existingUrl = sport === "mlb" ? await getScoreboardShareImageUrl(editionDate) : null;

  return (
    <main className="admin admin-wide">
      <h1>Share-image preview</h1>
      <p className="admin-meta">
        The 1200×630 scoreboard image per sport — the <code>og:image</code> for
        <code> /{sport}/[editionDate]</code> link previews and the lead social image.
        Boards show the <strong>games</strong> date ({prettyDate(gamesDate)}); the URL uses the
        edition date. Open the live route:{" "}
        <Link href={`/share/${sport}/${editionDate}`}>/share/{sport}/{editionDate}</Link>.
      </p>

      {sp.ok && <p className="admin-success"><strong>✓</strong> {sp.ok}</p>}
      {sp.error && <p className="admin-error"><strong>Failed:</strong> {sp.error}</p>}

      <style>{`
        .sp-controls { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin: 20px 0 4px; }
        .sp-controls label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-muted); }
        .sp-controls select, .sp-controls input[type="date"] {
          font: inherit; font-size: 14px; padding: 6px 10px;
          border: 1px solid var(--border-light); border-radius: 3px;
        }
        .sp-grid { display: flex; flex-direction: column; gap: 28px; margin-top: 24px; }
        .sp-board-label { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 6px; }
        .sp-stage { width: 600px; max-width: 100%; aspect-ratio: 1200 / 630; border: 1px solid #ccc; overflow: hidden; background: #fff; }
        .sp-stage > .canvas { transform-origin: top left; transform: scale(0.5); width: 1200px; height: 630px; flex-shrink: 0; }
        @media (max-width: 720px) { .sp-stage > .canvas { transform: scale(calc((100vw - 80px) / 1200)); } }
        .share-preview-action { margin-top: 32px; padding: 18px 20px; border: 1px solid var(--border-strong); background: #fff; max-width: 600px; }
        .share-preview-action h2 { margin: 0 0 6px; font-size: 18px; }
        .share-preview-action p { margin: 0 0 12px; font-size: 14px; color: var(--text-muted); }
        .share-preview-action form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .share-preview-captured { margin-top: 24px; max-width: 600px; }
        .share-preview-captured h3 { font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 8px; }
        .share-preview-captured img { display: block; width: 100%; height: auto; border: 1px solid var(--border-light); }
        .share-preview-captured a { font-size: 12px; word-break: break-all; color: var(--text-muted); text-decoration: underline; }
      `}</style>

      {/* Sport + date picker (GET form). */}
      <form className="sp-controls" method="get">
        <label>
          Sport
          <select name="sport" defaultValue={sport}>
            {SPORTS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </label>
        <label>
          Edition date
          <input type="date" name="date" defaultValue={editionDate} />
        </label>
        <SubmitButton idleLabel="Load" pendingLabel="Loading…" />
      </form>

      {boards.length === 0 ? (
        <p className="admin-meta" style={{ marginTop: 24 }}>
          No completed games for {sport.toUpperCase()} on {prettyDate(gamesDate)} — no board to post.
        </p>
      ) : (
        <div className="sp-grid">
          {boards.map((b, i) => (
            <div key={i}>
              {(b.label || sport === "ncaaf") && (
                <p className="sp-board-label">{b.label ?? sport.toUpperCase()} · {b.scores.length} games</p>
              )}
              <div className="sp-stage">
                <div className="canvas">
                  <ScoreboardImage scores={b.scores} date={prettyDate(gamesDate)} sport={sport} label={b.label} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sport === "mlb" && (
        <section className="share-preview-action">
          <h2>Render &amp; upload the live image</h2>
          <p>
            Boots Puppeteer, captures <code>/share/mlb/[editionDate]</code> at 1200×630, and
            uploads to the <code>share-images</code> bucket as{" "}
            <code>&#123;editionDate&#125;_scoreboard.png</code>. (Per-sport capture/upload lands
            with the posting cron.)
          </p>
          <form action={renderScoreboardImage}>
            <label style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Edition date{" "}
              <input type="date" name="editionDate" defaultValue={editionDate} required />
            </label>
            <SubmitButton idleLabel="Render + upload" pendingLabel="Rendering…" />
          </form>
        </section>
      )}

      {existingUrl && (
        <div className="share-preview-captured">
          <h3>Captured image · edition {editionDate}</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={existingUrl} alt={`Captured scoreboard for edition ${editionDate}`} />
          <a href={existingUrl} target="_blank" rel="noopener noreferrer">{existingUrl}</a>
        </div>
      )}
    </main>
  );
}

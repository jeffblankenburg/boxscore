import Link from "next/link";
import { requireAdmin } from "../require-admin";
import { SubmitButton } from "../SubmitButton";
import { renderScoreboardImage } from "../actions";
import { ScoreboardImage, type ScoreTile } from "@/lib/scoreboard-image";
import { getScoreboardShareImageUrl } from "@/lib/share-storage";
import { yesterdayInET, nextDay, prettyDate } from "@/lib/dates";

// Admin-only preview of the 1200×630 share image. The local <ScoreboardImage>
// renders the same component /share/mlb/[date] uses, scaled to 50% so it fits
// on screen. The button below kicks off a real Puppeteer render of that route
// and uploads the resulting PNG to the share-images bucket — same path the
// daily cron will use once we wire step 3.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Share-image preview — admin",
  robots: { index: false },
};

const MOCK_SCORES: ScoreTile[] = [
  { away: "CLE", aR: 3,  home: "NYY", hR: 11 },
  { away: "BOS", aR: 4,  home: "TB",  hR: 5  },
  { away: "LAD", aR: 7,  home: "SF",  hR: 2  },
  { away: "HOU", aR: 8,  home: "SD",  hR: 6  },
  { away: "ATL", aR: 9,  home: "PHI", hR: 4  },
  { away: "TEX", aR: 3,  home: "COL", hR: 5  },
  { away: "DET", aR: 2,  home: "CHC", hR: 4  },
  { away: "MIL", aR: 6,  home: "STL", hR: 5  },
  { away: "MIN", aR: 1,  home: "KC",  hR: 2  },
  { away: "OAK", aR: 4,  home: "SEA", hR: 7  },
  { away: "TOR", aR: 5,  home: "BAL", hR: 3  },
  { away: "WSH", aR: 6,  home: "PIT", hR: 2  },
  { away: "MIA", aR: 3,  home: "NYM", hR: 8  },
  { away: "CIN", aR: 4,  home: "ARI", hR: 6  },
  { away: "LAA", aR: 7,  home: "CWS", hR: 1  },
];

export default async function ShareImagePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const gamesDate = yesterdayInET();
  const editionDate = nextDay(gamesDate);

  // Check if we already have a captured PNG for this edition in storage.
  const existingUrl = await getScoreboardShareImageUrl(editionDate);

  return (
    <main className="admin admin-wide">
      <h1>Share-image preview</h1>
      <p className="admin-meta">
        The 1200×630 image rendered at <code>/share/mlb/[editionDate]</code>{" "}
        and used as the <code>og:image</code> on{" "}
        <code>/mlb/[editionDate]</code> link previews. Image displays the
        games date; the URL uses the edition date. Hit the live route at{" "}
        <Link href={`/share/mlb/${editionDate}`}>/share/mlb/{editionDate}</Link>{" "}
        to render against real game data.
      </p>

      {sp.ok && <p className="admin-success"><strong>✓</strong> {sp.ok}</p>}
      {sp.error && <p className="admin-error"><strong>Failed:</strong> {sp.error}</p>}

      <style>{`
        .share-preview-stage {
          width: 600px; height: 315px;
          border: 1px solid #ccc;
          overflow: hidden;
          background: #fff;
          margin-top: 24px;
        }
        .share-preview-stage > .canvas {
          transform-origin: top left;
          transform: scale(0.5);
          width: 1200px; height: 630px;
          flex-shrink: 0;
        }
        @media (max-width: 720px) {
          .share-preview-stage { width: 100%; height: auto; aspect-ratio: 1200 / 630; }
          .share-preview-stage > .canvas { transform: scale(calc((100vw - 80px) / 1200)); }
        }
        .share-preview-action {
          margin-top: 32px;
          padding: 18px 20px;
          border: 1px solid var(--border-strong);
          background: #fff;
          max-width: 600px;
        }
        .share-preview-action h2 { margin: 0 0 6px; font-size: 18px; }
        .share-preview-action p { margin: 0 0 12px; font-size: 14px; color: var(--text-muted); }
        .share-preview-action form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .share-preview-action input[type="date"] {
          font: inherit; font-size: 14px;
          padding: 6px 10px;
          border: 1px solid var(--border-light);
          border-radius: 3px;
        }
        .share-preview-captured {
          margin-top: 24px;
          max-width: 600px;
        }
        .share-preview-captured h3 { font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 8px; }
        .share-preview-captured img {
          display: block; width: 100%; height: auto;
          border: 1px solid var(--border-light);
        }
        .share-preview-captured a {
          font-size: 12px; word-break: break-all;
          color: var(--text-muted); text-decoration: underline;
        }
      `}</style>

      <h2 style={{ marginTop: 24, marginBottom: 6, fontSize: 16, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Local preview (mock data)</h2>
      <div className="share-preview-stage">
        <div className="canvas">
          <ScoreboardImage scores={MOCK_SCORES} date={prettyDate(gamesDate)} />
        </div>
      </div>

      <section className="share-preview-action">
        <h2>Render &amp; upload the live image</h2>
        <p>
          Boots a Puppeteer instance, navigates to{" "}
          <code>/share/mlb/[editionDate]</code>, captures at 1200×630, uploads to
          the <code>share-images</code> bucket as{" "}
          <code>&#123;editionDate&#125;_scoreboard.png</code>. Takes ~10–20s
          locally, ~5–8s on Vercel (cold).
        </p>
        <form action={renderScoreboardImage}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Edition date{" "}
            <input type="date" name="editionDate" defaultValue={editionDate} required />
          </label>
          <SubmitButton idleLabel="Render + upload" pendingLabel="Rendering…" />
        </form>
      </section>

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

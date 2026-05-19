import { notFound } from "next/navigation";
import { requireAdmin } from "../../require-admin";
import { AdminNav } from "../../AdminNav";
import { SubmitButton } from "../../SubmitButton";
import { triggerCron } from "../../actions";
import { CopyId } from "./CopyId";
import { loadDailyData } from "@/lib/daily";
import type { DigestMode } from "@/lib/digest-mode";
import { MLB_PREVIEW_FIXTURES, MLB_PREVIEW_MODES } from "@/lib/mlb-preview-fixtures";
import {
  BASKETBALL_PREVIEW_MODES,
  basketballFixtureDate,
  type BasketballPreviewMode,
} from "@/lib/basketball-preview-fixtures";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview · admin · boxscore", robots: { index: false } };

const VALID_SPORTS = new Set(["mlb", "nba", "wnba"]);

// Preset preview widths. "full" means no constraint (fills the available column).
const WIDTH_PRESETS: Array<{ key: string; label: string; px: number | null }> = [
  { key: "mobile", label: "Mobile", px: 375 },
  { key: "email", label: "Email", px: 600 },
  { key: "tablet", label: "Tablet", px: 768 },
  { key: "laptop", label: "Laptop", px: 1024 },
  { key: "full", label: "Full", px: null },
];

// Resolve mode + fixture date in one place per sport. MLB uses DigestMode
// (classified by the schedule shape); basketball uses a hand-picked set of
// representative dates. Both expose the same {modes, current, fixtureDate}
// shape so the rest of the page doesn't have to branch.
type ModeContext = {
  modes: readonly string[];
  current: string;
  fixtureDate: string;
};

function modeContextFor(sport: string, modeParam: string | undefined): ModeContext {
  if (sport === "mlb") {
    const valid = new Set<string>(MLB_PREVIEW_MODES);
    const current = (modeParam && valid.has(modeParam) ? modeParam : "regular") as DigestMode;
    return {
      modes: MLB_PREVIEW_MODES,
      current,
      fixtureDate: MLB_PREVIEW_FIXTURES[current],
    };
  }
  const valid = new Set<string>(BASKETBALL_PREVIEW_MODES);
  const current = (modeParam && valid.has(modeParam) ? modeParam : "current") as BasketballPreviewMode;
  return {
    modes: BASKETBALL_PREVIEW_MODES,
    current,
    fixtureDate: basketballFixtureDate(sport as "nba" | "wnba", current),
  };
}

function asWidth(s: string | undefined, surface: "web" | "email"): string {
  const valid = new Set(WIDTH_PRESETS.map((p) => p.key));
  if (s && valid.has(s)) return s;
  // Email defaults to "email" (600); web defaults to full.
  return surface === "email" ? "email" : "full";
}

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ mode?: string; surface?: string; width?: string }>;
}) {
  await requireAdmin();
  const { sport } = await params;
  if (!VALID_SPORTS.has(sport)) notFound();

  const { mode: modeParam, surface: surfaceParam, width: widthParam } = await searchParams;
  const { modes, current: mode, fixtureDate } = modeContextFor(sport, modeParam);
  const surface: "web" | "email" = surfaceParam === "email" ? "email" : "web";
  const width = asWidth(widthParam, surface);
  const widthPx = WIDTH_PRESETS.find((p) => p.key === width)?.px ?? null;

  // MLB's DigestMode is classified from the schedule shape, so we can
  // verify the fixture actually classifies to its labeled mode. Basketball
  // doesn't classify (no DigestMode); skip the check and just show the
  // fixture date for context.
  let mlbActualMode: string | null = null;
  if (sport === "mlb") {
    const data = await loadDailyData(fixtureDate);
    mlbActualMode = data.mode;
  }

  // The actual rendered preview HTML (web doc with site chrome + globals.css
  // inlined, or full email HTML from dailyEmail()) lives at /frame so the
  // iframe can fetch it by URL — same URL works for the "Pop out" link
  // that opens an unconstrained full-window preview in a new tab.
  const frameSrc = `/admin/preview/${sport}/frame?mode=${mode}&surface=${surface}`;

  const link = (overrides: { mode?: string; surface?: "web" | "email"; width?: string }) => {
    const m = overrides.mode ?? mode;
    const s = overrides.surface ?? surface;
    const w = overrides.width ?? width;
    return `/admin/preview/${sport}?mode=${m}&surface=${s}&width=${w}`;
  };

  const containerStyle: React.CSSProperties = widthPx
    ? { maxWidth: `${widthPx}px`, margin: "0 auto" }
    : {};

  const previewId = `${mode}/${surface}/${width}`;

  return (
    <main className="admin admin-preview">
      <AdminNav activeSport={sport} />
      <h1>Preview — {sport.toUpperCase()}</h1>
      <div className="preview-shell">
        <aside className="preview-sidebar">
          <div className="preview-sidebar-label">Variant</div>
          <ul>
            {modes.map((m) => (
              <li key={m}>
                <a
                  href={link({ mode: m })}
                  className={mode === m ? "active" : ""}
                >
                  {m}
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <section className="preview-main">
          <div className="preview-bar">
            <div className="preview-toggle">
              <a
                className={surface === "web" ? "active" : ""}
                href={link({ surface: "web" })}
              >
                Web
              </a>
              <a
                className={surface === "email" ? "active" : ""}
                href={link({ surface: "email" })}
              >
                Email
              </a>
            </div>
            <div className="preview-toggle">
              {WIDTH_PRESETS.map((p) => (
                <a
                  key={p.key}
                  className={width === p.key ? "active" : ""}
                  href={link({ width: p.key })}
                >
                  {p.label}
                </a>
              ))}
            </div>
            <CopyId id={previewId} />
            <form action={triggerCron} className="preview-regen-form">
              <input type="hidden" name="route" value="generate" />
              <input type="hidden" name="sport" value={sport} />
              <input type="hidden" name="date" value={fixtureDate} />
              <input type="hidden" name="returnTo" value={link({})} />
              <SubmitButton idleLabel="Regen" pendingLabel="Regenerating\u2026" />
            </form>
            <a
              className="preview-popout"
              href={frameSrc}
              target="_blank"
              rel="noopener noreferrer"
              title="Open at full window width in a new tab"
            >
              Pop out ↗
            </a>
            <div className="preview-meta">
              <code>{fixtureDate}</code>
              {mlbActualMode != null && (
                <>
                  {" "}→ <code>{mlbActualMode}</code>
                  {mlbActualMode !== mode && (
                    <span className="preview-warn"> ← mismatch</span>
                  )}
                </>
              )}
            </div>
          </div>

          <iframe
            className={surface === "web" ? "preview-web-frame" : "preview-email-frame"}
            style={containerStyle}
            src={frameSrc}
            title={`${surface} preview`}
          />
        </section>
      </div>
    </main>
  );
}

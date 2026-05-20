import { notFound } from "next/navigation";
import { requireAdmin } from "../../require-admin";
import { AdminNav } from "../../AdminNav";
import { SubmitButton } from "../../SubmitButton";
import { triggerCron } from "../../actions";
import { CopyId } from "./CopyId";
import { PreviewTeamTabs } from "./PreviewTeamTabs";
import { loadDailyData } from "@/lib/daily";
import { isValidIsoDate } from "@/lib/dates";
import { MLB_PREVIEW_FIXTURES, MLB_PREVIEW_MODES } from "@/lib/mlb-preview-fixtures";
import {
  BASKETBALL_PREVIEW_MODES,
  basketballFixtureDate,
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

// Mode → fixture date map for the "Jump to mode" quick-select dropdown.
// The date URL param is the source of truth now; the dropdown is a
// shortcut for jumping to a known-good fixture for each classifier mode.
type ModeOptions = {
  modes: readonly string[];
  fixtures: Record<string, string>;
  defaultDate: string;
};

function modeOptionsFor(sport: string): ModeOptions {
  if (sport === "mlb") {
    return {
      modes: MLB_PREVIEW_MODES,
      fixtures: Object.fromEntries(
        MLB_PREVIEW_MODES.map((m) => [m, MLB_PREVIEW_FIXTURES[m]]),
      ),
      defaultDate: MLB_PREVIEW_FIXTURES.regular,
    };
  }
  const sportTyped = sport as "nba" | "wnba";
  return {
    modes: BASKETBALL_PREVIEW_MODES,
    fixtures: Object.fromEntries(
      BASKETBALL_PREVIEW_MODES.map((m) => [m, basketballFixtureDate(sportTyped, m)]),
    ),
    defaultDate: basketballFixtureDate(sportTyped, "current"),
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
  searchParams: Promise<{ date?: string; surface?: string; width?: string }>;
}) {
  await requireAdmin();
  const { sport } = await params;
  if (!VALID_SPORTS.has(sport)) notFound();

  const { date: dateParam, surface: surfaceParam, width: widthParam } = await searchParams;
  const { modes, fixtures, defaultDate } = modeOptionsFor(sport);
  const date = dateParam && isValidIsoDate(dateParam) ? dateParam : defaultDate;
  const surface: "web" | "email" = surfaceParam === "email" ? "email" : "web";
  const width = asWidth(widthParam, surface);
  const widthPx = WIDTH_PRESETS.find((p) => p.key === width)?.px ?? null;

  // Show the classifier's mode for the chosen date so the operator can
  // tell what mode they're actually viewing (preseason vs regular vs
  // all-star, etc.) — useful when typing a freeform date.
  let mlbActualMode: string | null = null;
  if (sport === "mlb") {
    const data = await loadDailyData(date);
    mlbActualMode = data.mode;
  }

  // The actual rendered preview HTML (web doc with site chrome + globals.css
  // inlined, or full email HTML from dailyEmail()) lives at /frame so the
  // iframe can fetch it by URL — same URL works for the "Pop out" link
  // that opens an unconstrained full-window preview in a new tab.
  const frameSrc = `/admin/preview/${sport}/frame?date=${date}&surface=${surface}`;

  const link = (overrides: { date?: string; surface?: "web" | "email"; width?: string }) => {
    const d = overrides.date ?? date;
    const s = overrides.surface ?? surface;
    const w = overrides.width ?? width;
    return `/admin/preview/${sport}?date=${d}&surface=${s}&width=${w}`;
  };

  const containerStyle: React.CSSProperties = widthPx
    ? { maxWidth: `${widthPx}px`, margin: "0 auto" }
    : {};

  const previewId = `${date}/${surface}/${width}`;

  return (
    <main className="admin admin-preview">
      <AdminNav activeSport={sport} active="preview" leagueBasePath="/admin/preview" />
      <PreviewTeamTabs sport={sport} activeTeam="league" />
      <section className="preview-main preview-main-full">
        <div className="preview-bar">
          <form method="get" className="preview-date-form">
            <label className="preview-date-label">
              <span>Date</span>
              <input
                type="date"
                name="date"
                defaultValue={date}
                className="admin-input"
              />
            </label>
            <input type="hidden" name="surface" value={surface} />
            <input type="hidden" name="width" value={width} />
            <button type="submit" className="admin-btn admin-btn-small">
              Go
            </button>
          </form>
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
          <form method="get" className="preview-date-form">
            <label className="preview-date-label">
              <span>Variant</span>
              {/* Quick-jump dropdown: the selected option's VALUE is the
                  fixture date for that mode, so picking a mode + Go
                  navigates to the right date. */}
              <select name="date" defaultValue="" className="admin-input">
                <option value="" disabled>Jump to mode…</option>
                {modes.map((m) => (
                  <option key={m} value={fixtures[m]}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="surface" value={surface} />
            <input type="hidden" name="width" value={width} />
            <button type="submit" className="admin-btn admin-btn-small">
              Go
            </button>
          </form>
          <CopyId id={previewId} />
          <form action={triggerCron} className="preview-regen-form">
            <input type="hidden" name="route" value="generate" />
            <input type="hidden" name="sport" value={sport} />
            <input type="hidden" name="date" value={date} />
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
            <code>{date}</code>
            {mlbActualMode != null && (
              <>
                {" "}→ <code>{mlbActualMode}</code>
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
    </main>
  );
}

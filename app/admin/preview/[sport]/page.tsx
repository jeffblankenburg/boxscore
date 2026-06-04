import { notFound } from "next/navigation";
import { requireAdmin } from "../../require-admin";
import { SubmitButton } from "../../SubmitButton";
import { triggerCron } from "../../actions";
import { CopyId } from "./CopyId";
import { PreviewTeamTabs } from "./PreviewTeamTabs";
import { DateInputWithToday } from "./DateInputWithToday";
import { loadDailyData } from "@/lib/daily";
import { isValidIsoDate, nextDay, prevDay, shortPrettyDate, yesterdayInET } from "@/lib/dates";
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
  const { modes, fixtures } = modeOptionsFor(sport);
  // `date` is the EDITION date (what subscribers see at the top of the
  // email — the day a newspaper would be dated). Backend lookups use
  // games_date = edition - 1 day, since digests are stored under the
  // date the games were played.
  const todayIsoEt = nextDay(yesterdayInET());
  const date = dateParam && isValidIsoDate(dateParam) ? dateParam : todayIsoEt;
  const gamesDate = prevDay(date);
  const surface: "web" | "email" = surfaceParam === "email" ? "email" : "web";
  const width = asWidth(widthParam, surface);
  const widthPx = WIDTH_PRESETS.find((p) => p.key === width)?.px ?? null;

  // Show the classifier's mode for the chosen date so the operator can
  // tell what mode they're actually viewing (preseason vs regular vs
  // all-star, etc.) — useful when typing a freeform date.
  let mlbActualMode: string | null = null;
  if (sport === "mlb") {
    const data = await loadDailyData(gamesDate);
    mlbActualMode = data.mode;
  }

  // The /frame route still expects games_date as its `date` param, so we
  // translate here. Same URL is reused for the "Pop out" link.
  const frameSrc = `/admin/preview/${sport}/frame?date=${gamesDate}&surface=${surface}`;

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
  // What the actual league send will use as the subject for this edition.
  // Mirrors the format in lib/emails/templates.ts:dailyEmail.
  const emailSubject = `${sport.toUpperCase()} - ${shortPrettyDate(date)}`;

  return (
    <main className="admin admin-preview">
      <PreviewTeamTabs sport={sport} activeTeam="league" />
      <section className="preview-main preview-main-full">
        <div className="preview-bar">
          <form method="get" className="preview-date-form">
            <DateInputWithToday defaultValue={date} />
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
              {/* Quick-jump dropdown. Fixtures are stored as games_dates;
                  shift each to its edition_date (= games + 1) so the URL
                  date stays consistent with the page's edition-date model. */}
              <select name="date" defaultValue="" className="admin-input">
                <option value="" disabled>Jump to mode…</option>
                {modes.map((m) => {
                  // fixtures[m] is guaranteed present because modes is the
                  // exact key set used to build fixtures (Object.fromEntries
                  // up in modeOptionsFor). TS just can't see that.
                  const games = fixtures[m]!;
                  return (
                    <option key={m} value={nextDay(games)}>
                      {m}
                    </option>
                  );
                })}
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
            {/* Cron API expects games_date; translate from edition_date. */}
            <input type="hidden" name="date" value={gamesDate} />
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

        {surface === "email" && (
          <div className="preview-subject">
            <span className="preview-subject-label">Subject</span>
            <span className="preview-subject-text">{emailSubject}</span>
          </div>
        )}

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

import Link from "next/link";
import { listHistoricalGames } from "@/lib/historical/queries";
import { isValidIsoDate, prettyDate } from "@/lib/dates";

// Public box-score image maker: pick a date → list that day's games → pick a
// game → get its box score as a downloadable share PNG. Historical archive
// (pre-2026) for now; 2026+ would need a live-game loader.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Box Score Image Maker — boxscore",
  description: "Pick any game from MLB history and get its box score as a shareable image.",
};

// The historical archive ends with the 2025 season.
const ARCHIVE_MAX = "2025-12-31";
// Games render one at a time on demand (headless Chrome, ~a few seconds the
// first time before the CDN cache warms).

export default async function BoxscoresPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; game?: string }>;
}) {
  const { date, game } = await searchParams;
  const validDate = date && isValidIsoDate(date) ? date : null;

  const games = validDate
    ? (await listHistoricalGames({ fromDate: validDate, toDate: validDate, sort: "date_asc", limit: 100 })).rows
    : [];

  const selectedPk = game && /^\d+$/.test(game) ? Number(game) : null;
  const selected = selectedPk ? games.find((g) => g.game_pk === selectedPk) ?? null : null;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 14px 40px" }}>
      <div className="dateline">
        <div className="dateline-row"><span className="dateline-text">Box Score Image Maker</span></div>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 18px" }}>
        Pick a date from MLB history, choose a game, and download its box score as a shareable image.
      </p>

      {/* Date picker — plain GET form, no client JS needed. */}
      <form method="get" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <label htmlFor="date" style={{ fontWeight: 700, fontSize: 14 }}>Date</label>
        <input
          type="date"
          id="date"
          name="date"
          defaultValue={validDate ?? ""}
          max={ARCHIVE_MAX}
          style={{ fontSize: 15, padding: "6px 8px", border: "1px solid var(--border-strong)", borderRadius: 0, fontFamily: "inherit" }}
        />
        <button
          type="submit"
          style={{ fontSize: 14, fontWeight: 700, padding: "7px 16px", border: "1px solid var(--border-strong)", background: "var(--text-primary)", color: "#fff", cursor: "pointer" }}
        >
          Show games
        </button>
      </form>

      {/* Selected game's image. */}
      {selected && (
        <section style={{ margin: "0 0 26px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 4px" }}>
            {selected.away_team_abbr} @ {selected.home_team_abbr}
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 10px" }}>
            {prettyDate(selected.game_date)}
          </div>
          {/* Placeholder shows through until the on-demand PNG paints over it
              (first render takes a few seconds before the CDN cache warms). */}
          <div style={{ position: "relative", minHeight: 360, background: "#efece4", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
              Generating image…
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/boxscores/image/${selected.game_pk}`}
              alt={`${selected.away_team_abbr} at ${selected.home_team_abbr} box score`}
              style={{ position: "relative", width: "100%", height: "auto", display: "block", boxShadow: "0 2px 10px rgba(0,0,0,0.12)" }}
            />
          </div>
          <a
            href={`/boxscores/image/${selected.game_pk}`}
            download={`boxscore-${selected.game_pk}.png`}
            style={{ display: "inline-block", marginTop: 10, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}
          >
            Download PNG →
          </a>
        </section>
      )}

      {/* Game list for the chosen date. */}
      {validDate && (
        games.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            No games found for {prettyDate(validDate)} in the archive (which covers seasons through 2025).
          </p>
        ) : (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "2px solid var(--border-strong)", paddingBottom: 4, marginBottom: 4 }}>
              {games.length} game{games.length === 1 ? "" : "s"} — {prettyDate(validDate)}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {games.map((g) => {
                const isSel = g.game_pk === selectedPk;
                return (
                  <li key={g.game_pk} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <Link
                      href={`/boxscores?date=${validDate}&game=${g.game_pk}`}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        padding: "9px 4px", textDecoration: "none",
                        color: isSel ? "var(--text-primary)" : "inherit",
                        fontWeight: isSel ? 800 : 500,
                      }}
                    >
                      <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 14 }}>
                        {g.away_team_abbr} @ {g.home_team_abbr}
                      </span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, color: "var(--text-secondary)" }}>
                        {g.away_score}–{g.home_score}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { listBoxGamesForDate } from "@/lib/historical/render-game";
import { isValidIsoDate, prettyDate, todayInET } from "@/lib/dates";

// Public box-score image maker: pick a date → list that day's games → pick a
// game → its box score renders as a downloadable / printable share PNG, in
// the same branded format as /redbaron77. Covers 1950–2026 (statsapi list;
// historical store + statsapi render). MLB only for now.

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Box Score Image Maker — boxscore",
  description: "Pick any game from MLB history and get its box score as a shareable, printable image.",
};

export default async function BoxArtPage({
  params,
  searchParams,
}: {
  params: Promise<{ sport: string }>;
  searchParams: Promise<{ date?: string; game?: string }>;
}) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();

  const { date, game } = await searchParams;
  const validDate = date && isValidIsoDate(date) ? date : null;
  const games = validDate ? await listBoxGamesForDate(validDate) : [];

  const selectedPk = game && /^\d+$/.test(game) ? Number(game) : null;
  const selected = selectedPk ? games.find((g) => g.gamePk === selectedPk) ?? null : null;

  // Clean same-origin image URL. The route proxies from blob storage (or
  // generates on first view); the bucket URL is never exposed. date lets the
  // route render 2026 games' card header on a first-time miss.
  const imgSrc = selected ? `/${sport}/art/${selected.gamePk}.png?date=${validDate}` : "";

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
          min="1950-01-01"
          max={todayInET()}
          style={{ fontSize: 15, padding: "6px 8px", border: "1px solid var(--border-strong)", borderRadius: 0, fontFamily: "inherit" }}
        />
        <button
          type="submit"
          style={{ fontSize: 14, fontWeight: 700, padding: "7px 16px", border: "1px solid var(--border-strong)", background: "var(--text-primary)", color: "#fff", cursor: "pointer" }}
        >
          Show games
        </button>
      </form>

      {/* Selected game's image. key on game_pk forces a fresh <img> per pick so
          the loading placeholder returns instead of showing the prior game. */}
      {selected && validDate && (
        <section key={selected.gamePk} style={{ margin: "0 0 26px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 4px" }}>
            {selected.awayAbbr} @ {selected.homeAbbr}
          </h2>
          <div style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 10px" }}>{prettyDate(validDate)}</div>
          <div style={{ position: "relative", minHeight: 360, background: "#efece4", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "absolute", fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>Generating image…</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={selected.gamePk}
              src={imgSrc}
              alt={`${selected.awayAbbr} at ${selected.homeAbbr} box score`}
              style={{ position: "relative", width: "100%", height: "auto", display: "block", boxShadow: "0 2px 10px rgba(0,0,0,0.12)" }}
            />
          </div>
          <a
            href={imgSrc}
            download={`boxscore-${selected.gamePk}.png`}
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
            No completed games found for {prettyDate(validDate)}.
          </p>
        ) : (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", borderBottom: "2px solid var(--border-strong)", paddingBottom: 4, marginBottom: 4 }}>
              {games.length} game{games.length === 1 ? "" : "s"} — {prettyDate(validDate)}
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {games.map((g) => {
                const isSel = g.gamePk === selectedPk;
                return (
                  <li key={g.gamePk} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <Link
                      href={`/${sport}/art?date=${validDate}&game=${g.gamePk}`}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "9px 4px", textDecoration: "none", color: isSel ? "var(--text-primary)" : "inherit", fontWeight: isSel ? 800 : 500 }}
                    >
                      <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 14 }}>{g.awayAbbr} @ {g.homeAbbr}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14, color: "var(--text-secondary)" }}>{g.awayScore}–{g.homeScore}</span>
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

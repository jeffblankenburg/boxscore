"use client";

// Client-side bulk regenerate with visible progress. Iterates the list of
// dates serially, calling regenerateOneDigest() for each — which under the
// hood hits /api/cron/generate?...&skip_teams=1 so a single date is a
// sub-second operation. UI updates between iterations so the operator can
// see "Regenerating 12 of 50… (10 ok, 2 failed)" rather than staring at a
// spinner for 45 seconds wondering if anything's happening.
//
// Why client-side rather than streamed server-side: this is a one-page
// admin tool, not a production cron — keeping the loop in the browser
// avoids needing server-sent events / a job queue / a status table.

import { useState } from "react";
import { regenerateOneDigest } from "../actions";

type Status = "idle" | "running" | "done";

export function RegenerateAllRunner({
  sport,
  dates,
}: {
  sport: string;
  dates: string[];
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [doneCount, setDoneCount] = useState(0);
  const [okCount, setOkCount] = useState(0);
  const [failed, setFailed] = useState<Array<{ date: string; error: string }>>([]);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  // When checked, the per-date call ALSO regenerates team_digests (30 teams
  // per date for MLB). Each iteration takes ~20s instead of <1s; the
  // runner UI shows the date count so the operator knows what they're in
  // for. Unchecked default since template tweaks usually only touch the
  // league HTML.
  const [includeTeams, setIncludeTeams] = useState(false);

  async function start() {
    setStatus("running");
    setDoneCount(0);
    setOkCount(0);
    setFailed([]);
    const includeTeamsAtStart = includeTeams;

    for (const date of dates) {
      setCurrentDate(date);
      const result = await regenerateOneDigest(sport, date, includeTeamsAtStart);
      setDoneCount((d) => d + 1);
      if (result.ok) {
        setOkCount((o) => o + 1);
      } else {
        setFailed((f) => [...f, { date, error: result.error ?? "unknown error" }]);
      }
    }
    setCurrentDate(null);
    setStatus("done");
  }

  if (dates.length === 0) {
    return (
      <div className="admin-trigger-form">
        <span className="admin-trigger-label">
          No cached {sport.toUpperCase()} digests yet — nothing to regenerate.
        </span>
      </div>
    );
  }

  // Rough time estimate: 0.9s/date league-only, ~20s/date with team gen.
  const perDate = includeTeams ? 20 : 0.9;
  const totalSec = Math.round(dates.length * perDate);
  const eta = totalSec >= 60
    ? `~${Math.round(totalSec / 60)} min`
    : `~${totalSec}s`;

  return (
    <div className="admin-trigger-form">
      <span className="admin-trigger-label">
        Regenerate every {sport.toUpperCase()} digest ({dates.length} dates,
        est. {eta})
      </span>
      <label className="admin-trigger-checkbox" style={{ display: "block", marginTop: 4 }}>
        <input
          type="checkbox"
          checked={includeTeams}
          disabled={status === "running"}
          onChange={(e) => setIncludeTeams(e.target.checked)}
        />
        {" "}also regenerate team digests (30 teams per date, ~20s/date)
      </label>
      <button
        type="button"
        className="admin-btn"
        onClick={start}
        disabled={status === "running"}
      >
        {status === "running"
          ? `Regenerating ${doneCount} of ${dates.length}…`
          : status === "done"
          ? "Regenerate again"
          : "Regenerate all"}
      </button>

      {status === "running" && (
        <p className="admin-meta">
          {currentDate ? <>Working on <code>{currentDate}</code> · </> : null}
          {okCount} ok · {failed.length} failed
        </p>
      )}

      {status === "done" && (
        <div className="admin-meta">
          <p>
            Done. {okCount} of {dates.length} succeeded
            {failed.length > 0 ? `, ${failed.length} failed.` : "."}
          </p>
          {failed.length > 0 && (
            <ul style={{ marginTop: 4, paddingLeft: 18 }}>
              {failed.slice(0, 10).map((f) => (
                <li key={f.date}>
                  <code>{f.date}</code>: {f.error}
                </li>
              ))}
              {failed.length > 10 && <li>…and {failed.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

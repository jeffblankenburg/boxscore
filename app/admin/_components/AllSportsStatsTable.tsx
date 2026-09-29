"use client";

import { Fragment, useState } from "react";
import { loadTeamBreakdown } from "./team-breakdown-action";
import type { SportSendStat, SendStatTotals, TeamSendStat } from "@/lib/dashboard";

// Client half of the all-sports table. The server component computes the
// per-sport rows + totals (from daily_send_stats) and hands them here; this
// adds the expand-to-teams interaction, lazy-loading each sport's per-team
// breakdown from `sends` only when its row is opened.

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

type TeamState = TeamSendStat[] | "loading" | undefined;

export function AllSportsStatsTable({
  rows,
  totals,
  days,
}: {
  rows: SportSendStat[];
  totals: SendStatTotals;
  days: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [teams, setTeams] = useState<Record<string, TeamState>>({});

  async function toggle(sport: string) {
    const next = !open[sport];
    setOpen((o) => ({ ...o, [sport]: next }));
    if (next && teams[sport] === undefined) {
      setTeams((t) => ({ ...t, [sport]: "loading" }));
      try {
        const data = await loadTeamBreakdown(sport, days);
        setTeams((t) => ({ ...t, [sport]: data }));
      } catch {
        setTeams((t) => ({ ...t, [sport]: [] }));
      }
    }
  }

  return (
    <table className="a-table">
      <colgroup>
        <col />
        <col style={{ width: "16%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "11%" }} />
      </colgroup>
      <thead>
        <tr>
          <th>Sport</th>
          <th className="a-num">Sends</th>
          <th className="a-num">Delivered</th>
          <th className="a-num">Open</th>
          <th className="a-num">Bounce</th>
          <th className="a-num">Failed</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const expandable = r.teamSends > 0;
          const isOpen = !!open[r.sport];
          const td = teams[r.sport];
          return (
            <Fragment key={r.sport}>
              <tr>
                <td>
                  {expandable ? (
                    <button
                      type="button"
                      className="a-expand"
                      onClick={() => toggle(r.sport)}
                      aria-expanded={isOpen}
                    >
                      <span className="a-expand-caret">{isOpen ? "▾" : "▸"}</span>
                      <strong>{r.sportName}</strong>
                    </button>
                  ) : (
                    <strong style={{ marginLeft: 18 }}>{r.sportName}</strong>
                  )}
                </td>
                <td className="a-num">
                  {r.sends.toLocaleString()}
                  {r.teamSends > 0 && (
                    <div className="a-muted" style={{ fontSize: 11 }}>
                      {r.leagueSends.toLocaleString()} lg · {r.teamSends.toLocaleString()} tm
                    </div>
                  )}
                </td>
                <td className="a-num">{pct(r.deliveredRate)}</td>
                <td className="a-num">{r.delivered ? pct(r.openRate) : <span className="a-muted">—</span>}</td>
                <td className="a-num">{r.bounced ? pct(r.bounceRate) : <span className="a-muted">—</span>}</td>
                <td className="a-num">
                  {r.failed ? <span className="a-down">{r.failed.toLocaleString()}</span> : <span className="a-muted">0</span>}
                </td>
              </tr>

              {isOpen && td === "loading" && (
                <tr className="a-subrow">
                  <td colSpan={6} className="a-muted" style={{ paddingLeft: 34 }}>Loading teams…</td>
                </tr>
              )}
              {isOpen && Array.isArray(td) && td.length === 0 && (
                <tr className="a-subrow">
                  <td colSpan={6} className="a-muted" style={{ paddingLeft: 34 }}>No team sends in this window.</td>
                </tr>
              )}
              {isOpen && Array.isArray(td) && td.map((t) => (
                <tr key={t.teamId} className="a-subrow">
                  <td style={{ paddingLeft: 34 }}>{t.teamName}</td>
                  <td className="a-num">{t.sends.toLocaleString()}</td>
                  <td className="a-num a-muted">—</td>
                  <td className="a-num a-muted">—</td>
                  <td className="a-num a-muted">—</td>
                  <td className="a-num">
                    {t.failed ? <span className="a-down">{t.failed.toLocaleString()}</span> : <span className="a-muted">0</span>}
                  </td>
                </tr>
              ))}
            </Fragment>
          );
        })}

        <tr>
          <td><strong style={{ marginLeft: 18 }}>All sports</strong></td>
          <td className="a-num"><strong>{totals.sends.toLocaleString()}</strong></td>
          <td className="a-num"><strong>{pct(totals.deliveredRate)}</strong></td>
          <td className="a-num"><strong>{pct(totals.openRate)}</strong></td>
          <td className="a-num"><strong>{pct(totals.bounceRate)}</strong></td>
          <td className="a-num">
            {totals.failed
              ? <strong className="a-down">{totals.failed.toLocaleString()}</strong>
              : <span className="a-muted">0</span>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

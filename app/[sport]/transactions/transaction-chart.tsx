"use client";

import { useState, useRef } from "react";

export type ChartPoint = { date: string; total: number };

const PADDING = { top: 12, right: 16, bottom: 22, left: 32 };
const VIEW_W = 1200;
const VIEW_H = 180;
const INNER_W = VIEW_W - PADDING.left - PADDING.right;
const INNER_H = VIEW_H - PADDING.top - PADDING.bottom;

function prettyDate(iso: string): string {
  const parts = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return dt.toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function TransactionChart({
  points,
}: {
  points: ChartPoint[];
  team?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="tx-chart-empty">No data for the season yet.</div>;
  }

  const maxTotal = Math.max(1, ...points.map((p) => p.total));
  const xStep = INNER_W / Math.max(1, points.length - 1);

  const coords = points.map((p, i) => ({
    p,
    x: PADDING.left + i * xStep,
    y: PADDING.top + INNER_H * (1 - p.total / maxTotal),
  }));

  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");

  // Y ticks: 0, mid, max
  const yTicks = [0, Math.round(maxTotal / 2), maxTotal];

  // Month-boundary X ticks
  const monthTicks: { x: number; label: string }[] = [];
  let lastMonth = "";
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point) continue;
    const m = point.date.slice(5, 7);
    if (m !== lastMonth) {
      const dt = new Date(point.date + "T00:00:00Z");
      monthTicks.push({
        x: PADDING.left + i * xStep,
        label: dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      });
      lastMonth = m;
    }
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xRatio = xPx / rect.width;
    const xSvg = xRatio * VIEW_W;
    const i = Math.round((xSvg - PADDING.left) / xStep);
    setHoverIdx(Math.max(0, Math.min(coords.length - 1, i)));
  }

  function pickAt(idx: number) {
    const target = coords[idx];
    if (!target) return;
    const row = document.getElementById(`d-${target.p.date}`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("tx-row-flash");
      window.setTimeout(() => row.classList.remove("tx-row-flash"), 1600);
    }
  }

  const hover = hoverIdx !== null ? coords[hoverIdx] : null;

  return (
    <div className="tx-chart-wrap">
      <svg
        ref={svgRef}
        className="tx-chart"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => hoverIdx !== null && pickAt(hoverIdx)}
        role="img"
        aria-label="Daily transaction totals for the season"
      >
        {yTicks.map((label) => {
          const y = PADDING.top + INNER_H * (1 - label / maxTotal);
          return (
            <g key={label}>
              <line
                x1={PADDING.left}
                x2={VIEW_W - PADDING.right}
                y1={y}
                y2={y}
                stroke="#eee"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="#666"
              >
                {label}
              </text>
            </g>
          );
        })}

        {monthTicks.map((t) => (
          <g key={t.x}>
            <line
              x1={t.x}
              x2={t.x}
              y1={PADDING.top}
              y2={VIEW_H - PADDING.bottom}
              stroke="#f0ebde"
              strokeWidth={1}
            />
            <text
              x={t.x + 2}
              y={VIEW_H - 6}
              fontSize="11"
              fill="#666"
            >
              {t.label}
            </text>
          </g>
        ))}

        <path d={pathD} fill="none" stroke="#000" strokeWidth={1.5} />

        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PADDING.top}
              y2={VIEW_H - PADDING.bottom}
              stroke="#000"
              strokeDasharray="2 2"
              strokeWidth={1}
            />
            <circle cx={hover.x} cy={hover.y} r={4} fill="#000" />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className="tx-chart-tooltip"
          style={{ left: `${(hover.x / VIEW_W) * 100}%` }}
        >
          <span className="tx-chart-tooltip-date">{prettyDate(hover.p.date)}</span>
          <span className="tx-chart-tooltip-total">
            {hover.p.total} {hover.p.total === 1 ? "move" : "moves"}
          </span>
        </div>
      )}
    </div>
  );
}

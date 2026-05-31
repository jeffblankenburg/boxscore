// Inline SVG chart primitives. Pure server components — no client JS, no libraries.
// All dimensions are explicit; CSS handles only color theming via currentColor.

import {
  bucketLabel,
  type Window,
  type SubscriberSeries,
  type SendSeries,
  type CronHeatMap,
  type CronRoute,
  CRON_ROUTES,
  type WatchwallRow,
  type CronGridBySport,
} from "@/lib/dashboard";
import { ALL_CRON_ROUTES } from "@/lib/sport-features";

// ---- Subscriber growth: line + green/red bars overlay -----------------

export function SubscriberGrowthChart({
  series, window: w,
}: { series: SubscriberSeries; window: Window }) {
  const W = 900;
  const H = 240;
  const padL = 44, padR = 16, padT = 12, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const n = series.buckets.length;
  if (n === 0) return <p className="admin-meta">No data.</p>;

  const maxBar = Math.max(1, ...series.newSubs, ...series.unsubs);
  const minActive = Math.min(...series.active);
  const maxActive = Math.max(...series.active);
  // Pad the active range so a flat line doesn't sit on the axis.
  const yLo = Math.max(0, minActive - Math.max(2, Math.round((maxActive - minActive) * 0.1)));
  const yHi = Math.max(yLo + 1, maxActive + Math.max(2, Math.round((maxActive - minActive) * 0.1)));

  const bandW = innerW / n;
  const xCenter = (i: number) => padL + bandW * (i + 0.5);
  const yLine = (v: number) => padT + innerH - ((v - yLo) / (yHi - yLo)) * innerH;
  // Bars use the bottom 40% of the chart so they don't visually fight the line.
  const barTop = padT + innerH * 0.6;
  const barH = (v: number) => (v / maxBar) * (innerH * 0.4);

  const linePath = series.active
    .map((v, i) => `${i === 0 ? "M" : "L"} ${xCenter(i).toFixed(1)} ${yLine(v).toFixed(1)}`)
    .join(" ");

  // X-axis labels: at most 8 evenly spaced
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Subscriber growth">
        {/* Y gridlines + labels (4 ticks) */}
        {[0, 0.33, 0.66, 1].map((t, i) => {
          const v = Math.round(yLo + (yHi - yLo) * (1 - t));
          const y = padT + innerH * t;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="admin-chart-grid" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="admin-chart-axis">{v}</text>
            </g>
          );
        })}

        {/* Bars: unsubs (red, behind) and new (green, in front) */}
        {series.unsubs.map((v, i) => v > 0 && (
          <rect
            key={`u${i}`}
            x={xCenter(i) - bandW * 0.35}
            width={bandW * 0.7}
            y={barTop + (innerH * 0.4) - barH(v)}
            height={barH(v)}
            className="admin-chart-bar-unsub"
          />
        ))}
        {series.newSubs.map((v, i) => v > 0 && (
          <rect
            key={`n${i}`}
            x={xCenter(i) - bandW * 0.25}
            width={bandW * 0.5}
            y={barTop + (innerH * 0.4) - barH(v)}
            height={barH(v)}
            className="admin-chart-bar-new"
          />
        ))}

        {/* Active line */}
        <path d={linePath} className="admin-chart-line" />
        {series.active.map((v, i) => (
          <circle key={`p${i}`} cx={xCenter(i)} cy={yLine(v)} r={2} className="admin-chart-line-dot" />
        ))}

        {/* X-axis labels */}
        {series.buckets.map((d, i) => (i % labelStep === 0 || i === n - 1) && (
          <text
            key={`x${i}`}
            x={xCenter(i)}
            y={H - 8}
            textAnchor="middle"
            className="admin-chart-axis"
          >{bucketLabel(d, w)}</text>
        ))}
      </svg>
      <p className="admin-chart-legend">
        <span className="admin-chart-swatch admin-chart-swatch-line" /> active subscribers
        <span className="admin-chart-swatch admin-chart-swatch-new" /> new
        <span className="admin-chart-swatch admin-chart-swatch-unsub" /> unsubscribed
      </p>
    </div>
  );
}

// ---- Send-health stacked bars ----------------------------------------

export function SendHealthChart({
  series, window: w,
}: { series: SendSeries; window: Window }) {
  const W = 900;
  const H = 180;
  const padL = 44, padR = 16, padT = 12, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.buckets.length;
  if (n === 0) return <p className="admin-meta">No data.</p>;

  const totals = series.ok.map((v, i) => v + series.failed[i]!);
  const max = Math.max(1, ...totals);

  const bandW = innerW / n;
  const barW = Math.min(bandW * 0.8, 40);
  const xCenter = (i: number) => padL + bandW * (i + 0.5);
  const labelStep = Math.max(1, Math.ceil(n / 10));

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Send health">
        {[0, 0.5, 1].map((t, i) => {
          const v = Math.round(max * (1 - t));
          const y = padT + innerH * t;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} className="admin-chart-grid" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="admin-chart-axis">{v}</text>
            </g>
          );
        })}
        {series.ok.map((ok, i) => {
          const failed = series.failed[i]!;
          const total = ok + failed;
          if (total === 0) return null;
          const totalH = (total / max) * innerH;
          const okH = (ok / max) * innerH;
          const failedH = totalH - okH;
          const x = xCenter(i) - barW / 2;
          const okY = padT + innerH - okH;
          const failedY = okY - failedH;
          return (
            <g key={i}>
              {failed > 0 && (
                <rect x={x} y={failedY} width={barW} height={failedH} className="admin-chart-bar-fail" />
              )}
              <rect x={x} y={okY} width={barW} height={okH} className="admin-chart-bar-ok" />
            </g>
          );
        })}
        {series.buckets.map((d, i) => (i % labelStep === 0 || i === n - 1) && (
          <text key={`x${i}`} x={xCenter(i)} y={H - 8} textAnchor="middle" className="admin-chart-axis">
            {bucketLabel(d, w)}
          </text>
        ))}
      </svg>
      <p className="admin-chart-legend">
        <span className="admin-chart-swatch admin-chart-swatch-ok" /> sent
        <span className="admin-chart-swatch admin-chart-swatch-fail" /> failed
      </p>
    </div>
  );
}

// ---- Cron heat-map ---------------------------------------------------

export function CronHeatMapView({ data }: { data: CronHeatMap }) {
  // Fixed canvas so the heat-map's footprint stays constant across windows;
  // cells stretch to fill the available width.
  const W = 900;
  const labelW = 130;
  const padTop = 36;
  const padRight = 8;
  const cellH = 30;
  const days = Math.max(1, data.days.length);
  const gap = days > 30 ? 1 : 2;
  const cellsAreaW = W - labelW - padRight;
  const cellW = (cellsAreaW - gap * (days - 1)) / days;
  const H = padTop + CRON_ROUTES.length * (cellH + gap);

  const labelStep = Math.max(1, Math.ceil(days / 14));

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cron heat-map">
        {data.days.map((d, i) => (i % labelStep === 0 || i === data.days.length - 1) && (
          <text
            key={d}
            x={labelW + i * (cellW + gap) + cellW / 2}
            y={padTop - 12}
            textAnchor="middle"
            className="admin-chart-axis"
          >{d.slice(5)}</text>
        ))}
        {CRON_ROUTES.map((route, r) => (
          <g key={route}>
            <text
              x={labelW - 10}
              y={padTop + r * (cellH + gap) + cellH / 2 + 4}
              textAnchor="end"
              className="admin-heat-label"
            >{route}</text>
            {data.cells[route as CronRoute].map((status, c) => (
              <rect
                key={c}
                x={labelW + c * (cellW + gap)}
                y={padTop + r * (cellH + gap)}
                width={cellW}
                height={cellH}
                className={`admin-heat-cell admin-heat-${status}`}
              >
                <title>{`${route} · ${data.days[c]} · ${status}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <p className="admin-chart-legend">
        <span className="admin-chart-swatch admin-heat-pass" /> pass
        <span className="admin-chart-swatch admin-heat-fail" /> fail
        <span className="admin-chart-swatch admin-heat-none" /> didn&apos;t run
      </p>
    </div>
  );
}

// ---- Compact sparkline (email size trend) ----------------------------

export function Sparkline({
  values, labels, threshold, formatValue,
  width = 900, height = 160,
}: {
  values: number[];
  labels?: string[];
  threshold?: number;
  formatValue?: (v: number) => string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return <p className="admin-meta">No data.</p>;
  const padL = 48, padR = 12, padT = 12, padB = labels ? 26 : 8;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(threshold ?? 0, ...values, 1);
  const min = 0;

  const xAt = (i: number) =>
    values.length === 1 ? padL + innerW / 2 : padL + (i / (values.length - 1)) * innerW;
  const yAt = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;

  const path = values.map((v, i) =>
    `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");

  const ticks = [0, 0.5, 1];
  const labelStep = labels ? Math.max(1, Math.ceil(labels.length / 10)) : 1;
  const lastValue = values[values.length - 1]!;

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Email size trend">
        {/* Y gridlines + labels */}
        {ticks.map((t, i) => {
          const v = max * (1 - t);
          const y = padT + innerH * t;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} className="admin-chart-grid" />
              <text x={padL - 6} y={y + 4} textAnchor="end" className="admin-chart-axis">
                {formatValue ? formatValue(v) : Math.round(v).toString()}
              </text>
            </g>
          );
        })}

        {/* Threshold line */}
        {threshold !== undefined && threshold > 0 && threshold <= max && (
          <line
            x1={padL} x2={width - padR}
            y1={yAt(threshold)} y2={yAt(threshold)}
            className="admin-sparkline-threshold"
          />
        )}

        {/* Trend line + end dot */}
        <path d={path} className="admin-sparkline-path" />
        <circle
          cx={xAt(values.length - 1)}
          cy={yAt(lastValue)}
          r={3}
          className="admin-sparkline-dot"
        />

        {/* X-axis date labels */}
        {labels && labels.map((d, i) => (i % labelStep === 0 || i === labels.length - 1) && (
          <text
            key={`x${i}`}
            x={xAt(i)}
            y={height - 8}
            textAnchor="middle"
            className="admin-chart-axis"
          >{d.slice(5)}</text>
        ))}
      </svg>
    </div>
  );
}

// ---- Watchwall: sport × route current health ----------------------------

const WALL_STATUS_LABEL: Record<string, string> = {
  pass: "\u2713",     // ✓
  fail: "\u2717",     // ✗
  running: "\u2026",  // …
  missing: "\u2014",  // —
  na: "",
};

// The legend doubles as a glossary for the two failure modes the dashboard
// needs to distinguish: a route that ran and errored ("failed") vs a route
// the platform never invoked at all ("missed"). They look visually similar
// at a glance — different colors, different glyphs — but readers who don't
// know the convention can't tell from the cell alone what each one means.
function WatchwallLegend() {
  return (
    <div className="watchwall-legend">
      <span className="watchwall-legend-item"><span className="watchwall-legend-swatch watchwall-pass">✓</span> passed</span>
      <span className="watchwall-legend-item"><span className="watchwall-legend-swatch watchwall-fail">✗</span> failed (ran, errored)</span>
      <span className="watchwall-legend-item"><span className="watchwall-legend-swatch watchwall-running">…</span> running</span>
      <span className="watchwall-legend-item"><span className="watchwall-legend-swatch watchwall-missing">—</span> missed (scheduled, never ran)</span>
    </div>
  );
}

export function Watchwall({ rows }: { rows: WatchwallRow[] }) {
  if (rows.length === 0) {
    return <p className="admin-meta">No sports configured.</p>;
  }
  // Column order is canonical ALL_CRON_ROUTES so every row aligns even when
  // sports expect different subsets. Sports that don't expect a route get a
  // blank "n/a" cell so the eye doesn't read it as a failure.
  return (
    <>
    <table className="watchwall">
      <thead>
        <tr>
          <th className="watchwall-corner">League</th>
          {ALL_CRON_ROUTES.map((route) => (
            <th key={route} className="watchwall-head">{route}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const cellByRoute = new Map(row.cells.map((c) => [c.route, c]));
          return (
            <tr key={row.sport}>
              <th className="watchwall-sport">{row.sportName}</th>
              {ALL_CRON_ROUTES.map((route) => {
                const cell = cellByRoute.get(route);
                if (!cell) {
                  return (
                    <td key={route} className="watchwall-cell watchwall-na" aria-label="not expected" />
                  );
                }
                const time = cell.startedAt
                  ? new Date(cell.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                  : "not run";
                // "missing" semantically means "scheduled but the function was
                // never invoked" — Vercel cron miss, not a route error. Spell
                // that out in the tooltip so the operator doesn't read it as
                // "the system forgot to expect this route."
                const tooltipStatus = cell.status === "missing"
                  ? "missed (scheduled, never ran)" : cell.status;
                const title = cell.error ?? `${tooltipStatus} · ${time}`;
                return (
                  <td
                    key={route}
                    className={`watchwall-cell watchwall-${cell.status}`}
                    title={title}
                  >
                    <span className="watchwall-mark">{WALL_STATUS_LABEL[cell.status]}</span>
                    <span className="watchwall-time">{time}</span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    <WatchwallLegend />
    </>
  );
}

// ---- Cron contribution grid: sport × day --------------------------------

function shortDayLabel(iso: string): string {
  // YYYY-MM-DD → "M/D" in ET. The grid is dense so labels stay terse.
  const [y, m, d] = iso.split("-");
  void y;
  return `${Number(m)}/${Number(d)}`;
}

export function CronGridBySportView({ grid }: { grid: CronGridBySport }) {
  if (grid.rows.length === 0) {
    return <p className="admin-meta">No sports configured.</p>;
  }
  const dayCount = grid.days.length;
  // Show every 3rd day label so the axis doesn't get cluttered at 14 days.
  const labelEvery = dayCount <= 14 ? 2 : Math.ceil(dayCount / 8);

  return (
    <div className="cron-grid-wrap">
      <div className="cron-grid">
        <div className="cron-grid-axis" aria-hidden="true">
          <span className="cron-grid-axis-pad" />
          {grid.days.map((day, i) => (
            <span key={day} className="cron-grid-axis-label">
              {i % labelEvery === 0 ? shortDayLabel(day) : ""}
            </span>
          ))}
        </div>
        {grid.rows.map((row) => (
          <div key={row.sport} className="cron-grid-row">
            <span className="cron-grid-label">{row.sportName}</span>
            {row.cells.map((status, i) => (
              <span
                key={i}
                className={`cron-grid-cell cron-grid-${status}`}
                title={`${grid.days[i]}: ${status}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="cron-grid-legend">
        <span className="cron-grid-cell cron-grid-pass" /> ok
        <span className="cron-grid-cell cron-grid-partial" /> partial
        <span className="cron-grid-cell cron-grid-fail" /> failed
        <span className="cron-grid-cell cron-grid-missing" /> none
      </div>
    </div>
  );
}

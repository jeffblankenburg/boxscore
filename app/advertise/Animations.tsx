"use client";

import { useEffect, useRef, useState } from "react";

// IntersectionObserver-driven scroll reveal. Fades and lifts children
// into place on first viewport entry, then disconnects. Respects
// prefers-reduced-motion (renders fully visible from the start).
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setVisible(true);
          obs.disconnect();
          break;
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const cls = ["advertise-reveal", visible ? "is-visible" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={cls} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// Counts a number from 0 up to `to` on first viewport entry using
// ease-out cubic. Reduced-motion users see the final value immediately.
// Format is a preset rather than a render fn because React server
// components can't pass arbitrary functions to client component props.
export function CountUp({
  to,
  format = "int",
  decimals = 1,
  duration = 900,
}: {
  to: number;
  format?: "int" | "percent";
  decimals?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          obs.disconnect();
          const start = performance.now();
          const tick = (t: number) => {
            const k = Math.min(1, (t - start) / duration);
            const eased = 1 - Math.pow(1 - k, 3);
            setValue(to * eased);
            if (k < 1) requestAnimationFrame(tick);
            else setValue(to);
          };
          requestAnimationFrame(tick);
          break;
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to, duration]);

  const display = format === "percent"
    ? `${value.toFixed(decimals)}%`
    : Math.round(value).toLocaleString();
  return <span ref={ref}>{display}</span>;
}

// One observer per bar group: bars draw left-to-right and percentages
// tick up together as the panel enters view. Sharing a single progress
// scalar across rows is cheaper than one observer per row and lets the
// whole group land at the same beat.
export function DemographicBars({
  rows,
  duration = 1100,
}: {
  rows: { label: string; pct: number }[];
  duration?: number;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setProgress(1);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          obs.disconnect();
          const start = performance.now();
          const tick = (t: number) => {
            const k = Math.min(1, (t - start) / duration);
            const eased = 1 - Math.pow(1 - k, 3);
            setProgress(eased);
            if (k < 1) requestAnimationFrame(tick);
            else setProgress(1);
          };
          requestAnimationFrame(tick);
          break;
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [duration]);

  return (
    <ul ref={ref} className="advertise-demo-bars">
      {rows.map((r) => {
        const v = r.pct * progress;
        return (
          <li key={r.label} className="advertise-demo-row">
            <span className="advertise-demo-label">{r.label}</span>
            <span className="advertise-demo-track">
              <span
                className="advertise-demo-fill"
                style={{ width: `${v}%` }}
              />
            </span>
            <span className="advertise-demo-pct">{v.toFixed(1)}%</span>
          </li>
        );
      })}
    </ul>
  );
}

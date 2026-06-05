"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  sport: string;
  // Edition date the current page is showing. Used to highlight the
  // current cell in the calendar and to seed the popover's initial month.
  currentDate: string; // YYYY-MM-DD
  // Today's edition date in ET — the calendar's hard upper bound. Future
  // months are unreachable; today's month is open but cells beyond today
  // are non-clickable. Passed from the server so the client doesn't need
  // its own timezone math.
  today: string; // YYYY-MM-DD
  // When present, only dates this team played are clickable, and links
  // navigate to /[sport]/[date]/[slug] instead of /[sport]/[date].
  teamSlug?: string;
};

export function DateHeaderCalendar({ sport, currentDate, today, teamSlug }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<Set<string> | null>(null);
  const [view, setView] = useState(() => parseMonth(currentDate));
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // The dateline span is rendered inside dangerouslySetInnerHTML on the
  // digest page, so we can't pass props or refs to it directly. Find it
  // in the DOM after mount and wire up the toggle. The `calendar-enabled`
  // class gates the hover styling so non-JS visitors don't see a misleading
  // pointer cursor.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".dateline-text");
    if (!el) return;
    setAnchor(el);
    el.classList.add("calendar-enabled");
    const onClick = () => setOpen((o) => !o);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("click", onClick);
      el.classList.remove("calendar-enabled");
    };
  }, []);

  // Fetch the dates set on first open; cache in state so subsequent opens
  // are instant.
  useEffect(() => {
    if (!open || dates) return;
    const qs = new URLSearchParams({ sport });
    if (teamSlug) qs.set("team", teamSlug);
    let cancelled = false;
    fetch(`/api/calendar-dates?${qs}`)
      .then((r) => r.json())
      .then((data: { dates?: string[] }) => {
        if (!cancelled) setDates(new Set(data.dates ?? []));
      })
      .catch(() => {
        if (!cancelled) setDates(new Set());
      });
    return () => { cancelled = true; };
  }, [open, dates, sport, teamSlug]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (anchor?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor]);

  // Re-seed the visible month each time the popover opens, so opening
  // from a different page always lands on that page's month.
  useEffect(() => {
    if (open) setView(parseMonth(currentDate));
  }, [open, currentDate]);

  if (!anchor || !open) return null;

  const rect = anchor.getBoundingClientRect();
  const popStyle: React.CSSProperties = {
    position: "absolute",
    top: rect.bottom + window.scrollY + 4,
    left: rect.left + window.scrollX + rect.width / 2,
    transform: "translateX(-50%)",
  };

  const todayMonth = parseMonth(today);
  const atTodayMonth = view.year === todayMonth.year && view.month === todayMonth.month;

  return createPortal(
    <div ref={popoverRef} className="dateline-calendar" style={popStyle} role="dialog" aria-label="Edition calendar">
      <div className="dlc-header">
        <button type="button" className="dlc-nav" onClick={() => setView(addMonths(view, -1))} aria-label="Previous month">‹</button>
        <span className="dlc-title">{MONTH_NAMES[view.month]} {view.year}</span>
        <button
          type="button"
          className="dlc-nav"
          onClick={() => setView(addMonths(view, 1))}
          disabled={atTodayMonth}
          aria-label="Next month"
        >›</button>
      </div>
      <div className="dlc-dow">
        {DAY_INITIALS.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="dlc-grid">
        {monthCells(view.year, view.month).map((cell, i) => (
          <Cell
            key={i}
            cell={cell}
            sport={sport}
            teamSlug={teamSlug}
            currentDate={currentDate}
            today={today}
            available={dates}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function Cell({
  cell, sport, teamSlug, currentDate, today, available,
}: {
  cell: CalendarCell;
  sport: string;
  teamSlug?: string;
  currentDate: string;
  today: string;
  available: Set<string> | null;
}) {
  if (!cell.inMonth) return <span className="dlc-cell dlc-cell-blank" />;
  const iso = cell.iso;
  const future = iso > today;
  const has = available?.has(iso) ?? false;
  const isCurrent = iso === currentDate;
  const clickable = !future && has;
  const cls = [
    "dlc-cell",
    future ? "dlc-cell-future" : null,
    isCurrent ? "dlc-cell-current" : null,
    clickable ? "dlc-cell-link" : "dlc-cell-disabled",
  ].filter(Boolean).join(" ");
  if (!clickable) return <span className={cls}>{cell.day}</span>;
  const href = teamSlug ? `/${sport}/${iso}/${teamSlug}` : `/${sport}/${iso}`;
  return <a className={cls} href={href}>{cell.day}</a>;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

type ViewMonth = { year: number; month: number /* 0-11 */ };
type CalendarCell = { inMonth: false } | { inMonth: true; day: number; iso: string };

function parseMonth(iso: string): ViewMonth {
  const [y, m] = iso.split("-").map(Number) as [number, number, number];
  return { year: y, month: m - 1 };
}

function addMonths(v: ViewMonth, delta: number): ViewMonth {
  const m = v.month + delta;
  const year = v.year + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  return { year, month };
}

function pad2(n: number): string { return n < 10 ? `0${n}` : `${n}`; }

// Six rows × seven columns. Cells before the first-of-month and after the
// last-of-month are blank placeholders, not adjacent-month dates — keeps
// the popover focused on the visible month.
function monthCells(year: number, month: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = first.getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      inMonth: true,
      day: d,
      iso: `${year}-${pad2(month + 1)}-${pad2(d)}`,
    });
  }
  while (cells.length < 42) cells.push({ inMonth: false });
  return cells;
}

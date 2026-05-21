"use client";

// "Date" label + date input. Clicking the label text fills the input with
// today's ET date — saves a few keystrokes when the operator wants to
// jump to the most recent edition without scrolling the picker.

import { useRef } from "react";

function todayIsoInET(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function DateInputWithToday({ defaultValue }: { defaultValue: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label className="preview-date-label">
      <span
        className="preview-date-label-clickable"
        onClick={() => {
          if (inputRef.current) inputRef.current.value = todayIsoInET();
        }}
        title="Fill with today's date"
      >
        Date
      </span>
      <input
        ref={inputRef}
        type="date"
        name="date"
        defaultValue={defaultValue}
        className="admin-input"
      />
    </label>
  );
}

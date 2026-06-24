"use client";

import { useEffect, useRef, useState } from "react";

// Live filter for /admin/followers. The server renders every row with a
// `data-search` haystack on the <tr>; this component owns the input + the
// debounced DOM toggle so typing doesn't trigger a server roundtrip or
// disturb the existing server-action forms (star, notes) inside each row.
export function FollowerSearch({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(total);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const needle = q.trim().toLowerCase();
      const rows = document.querySelectorAll<HTMLTableRowElement>(
        ".followers-table tr[data-search]",
      );
      let visible = 0;
      rows.forEach((r) => {
        const hay = r.dataset.search ?? "";
        const match = needle === "" || hay.includes(needle);
        r.style.display = match ? "" : "none";
        if (match) visible++;
      });
      setShown(visible);
    }, 120);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q]);

  // Server changes (view/sort/dir) re-render the table and remount this
  // component, resetting `total` and `shown` together. No extra wiring
  // needed to keep the counter honest after a view switch.

  return (
    <div className="followers-search" role="search">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search handle, name, bio, or notes"
        aria-label="Search followers"
        className="admin-input"
        autoComplete="off"
      />
      <span className="admin-meta">
        {q.trim() ? `${shown} of ${total}` : `${total} shown`}
      </span>
    </div>
  );
}

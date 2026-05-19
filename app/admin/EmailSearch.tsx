"use client";

import { useEffect, useState, useTransition } from "react";
import { searchSends, type SendSearchRow, type SendStatus } from "./actions";

// Live recipient-email lookup for /admin. Debounces 250ms so a paste fires
// one query, typing fires one per pause. Renders the result table inline
// below the input — no modal, no navigation, no page reload.
//
// Empty state: prompt; <3 chars: prompt; pending: spinner; no matches: meta
// message. The visible state changes are small, so we keep them all in one
// component rather than splitting into result/empty/loading variants.

const MIN_QUERY = 3;
const DEBOUNCE_MS = 250;

export function EmailSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SendSearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setError(null);
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        try {
          const rows = await searchSends(q);
          setResults(rows);
        } catch (e) {
          setError((e as Error).message);
          setResults([]);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const showEmptyHint = query.trim().length === 0;
  const showShortHint = query.trim().length > 0 && query.trim().length < MIN_QUERY;
  const showNoResults =
    query.trim().length >= MIN_QUERY && !pending && results.length === 0 && !error;

  return (
    <div className="email-search">
      <input
        type="search"
        className="email-search-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Paste or type a recipient email…"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search by recipient email"
      />
      {showEmptyHint && (
        <p className="admin-meta">
          Searches every production send to a matching subscriber email
          (substring match, case-insensitive).
        </p>
      )}
      {showShortHint && (
        <p className="admin-meta">Keep typing — at least {MIN_QUERY} characters.</p>
      )}
      {pending && <p className="admin-meta">Searching…</p>}
      {error && <p className="admin-error">{error}</p>}
      {showNoResults && <p className="admin-meta">No matching sends.</p>}
      {results.length > 0 && (
        <table className="email-search-results">
          <thead>
            <tr>
              <th>To</th>
              <th>Status</th>
              <th>Subject</th>
              <th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id}>
                <td className="email-search-to"><code>{r.to}</code></td>
                <td><StatusPill status={r.status} /></td>
                <td>{r.subject}</td>
                <td className="admin-meta">{relativeTime(r.sentAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<SendStatus, string> = {
  delivered: "Delivered",
  bounced: "Bounced",
  delayed: "Delayed",
  complained: "Complained",
  pending: "Sent",
  failed: "Failed",
};

function StatusPill({ status }: { status: SendStatus }) {
  return (
    <span className={`send-status send-status-${status}`}>{STATUS_LABEL[status]}</span>
  );
}

// Relative time like "about 3 hours ago" — matches the Resend dashboard's
// formatting so the screen reads the same way Jeff already reads it there.
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `about ${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

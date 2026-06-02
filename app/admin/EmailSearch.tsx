"use client";

import { useEffect, useState, useTransition } from "react";
import {
  searchSends,
  type SearchResults,
  type SendStatus,
  type SubscriberSearchRow,
  type SubscriberStatus,
} from "./actions";

// Live recipient-email lookup for /admin. Debounces 250ms so a paste fires
// one query, typing fires one per pause. Renders the result tables inline
// below the input — subscriber matches first (so we can tell at a glance if
// an address is in our DB even when it's never received a send), then the
// per-send history.
//
// Empty state: prompt; <3 chars: prompt; pending: spinner; no matches: meta
// message. The visible state changes are small, so we keep them all in one
// component rather than splitting into result/empty/loading variants.

const MIN_QUERY = 3;
const DEBOUNCE_MS = 250;

const EMPTY_RESULTS: SearchResults = { subscribers: [], sends: [] };

export function EmailSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setError(null);
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults(EMPTY_RESULTS);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        try {
          const data = await searchSends(q);
          setResults(data);
        } catch (e) {
          setError((e as Error).message);
          setResults(EMPTY_RESULTS);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const showEmptyHint = query.trim().length === 0;
  const showShortHint = query.trim().length > 0 && query.trim().length < MIN_QUERY;
  const hasAny = results.subscribers.length > 0 || results.sends.length > 0;
  const showNoResults =
    query.trim().length >= MIN_QUERY && !pending && !hasAny && !error;

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
          Searches subscribers and every production send by recipient email
          (substring match, case-insensitive).
        </p>
      )}
      {showShortHint && (
        <p className="admin-meta">Keep typing — at least {MIN_QUERY} characters.</p>
      )}
      {pending && <p className="admin-meta">Searching…</p>}
      {error && <p className="admin-error">{error}</p>}
      {showNoResults && <p className="admin-meta">No matching subscribers or sends.</p>}
      {results.subscribers.length > 0 && (
        <>
          <h3 className="email-search-section">Subscribers</h3>
          <table className="email-search-results">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Signed up</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {results.subscribers.map((s) => (
                <tr key={s.id}>
                  <td className="email-search-to"><code>{s.email}</code></td>
                  <td><SubscriberStatusPill status={s.status} /></td>
                  <td className="admin-meta">{relativeTime(s.createdAt)}</td>
                  <td className="admin-meta"><SubscriberNotes s={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {results.sends.length > 0 && (
        <>
          <h3 className="email-search-section">Sends</h3>
          <table className="email-search-results">
            <thead>
              <tr>
                <th>To</th>
                <th>Status</th>
                <th>Engagement</th>
                <th>Subject</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {results.sends.map((r) => (
                <tr key={r.id}>
                  <td className="email-search-to"><code>{r.to}</code></td>
                  <td><StatusPill status={r.status} /></td>
                  <td><Engagement opened={r.opened} clicked={r.clicked} /></td>
                  <td>{r.subject}</td>
                  <td className="admin-meta">{relativeTime(r.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {results.subscribers.length > 0 && results.sends.length === 0 && !pending && (
        <p className="admin-meta">No sends recorded for matching subscribers.</p>
      )}
    </div>
  );
}

const SUBSCRIBER_STATUS_LABEL: Record<SubscriberStatus, string> = {
  pending: "Pending",
  active: "Active",
  unsubscribed: "Unsubscribed",
};

function SubscriberStatusPill({ status }: { status: SubscriberStatus }) {
  return (
    <span className={`sub-status sub-status-${status}`}>
      {SUBSCRIBER_STATUS_LABEL[status]}
    </span>
  );
}

function SubscriberNotes({ s }: { s: SubscriberSearchRow }) {
  const bits: string[] = [];
  if (s.isAdmin) bits.push("admin");
  if (s.status === "unsubscribed" && s.unsubscribedAt) {
    const reason = s.unsubscribeReason ?? "user";
    bits.push(`unsubscribed ${relativeTime(s.unsubscribedAt)} (${reason})`);
  } else if (s.status === "active" && s.confirmedAt) {
    bits.push(`confirmed ${relativeTime(s.confirmedAt)}`);
  } else if (s.status === "pending") {
    bits.push("awaiting confirmation");
  }
  if (bits.length === 0) return <>—</>;
  return <>{bits.join(", ")}</>;
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

// Opens are noisy (Apple MPP prefetches the pixel for most iOS/Mac users);
// clicks are real intent. Render each as its own pill so a click without a
// recorded open — possible if the client blocked the pixel but followed a
// link — still shows. An em-dash placeholder keeps the column from looking
// empty when nothing's fired yet.
function Engagement({ opened, clicked }: { opened: boolean; clicked: boolean }) {
  if (!opened && !clicked) {
    return <span className="admin-meta">—</span>;
  }
  return (
    <span className="send-engagement">
      {opened && <span className="send-engagement-pill send-engagement-opened">Opened</span>}
      {clicked && <span className="send-engagement-pill send-engagement-clicked">Clicked</span>}
    </span>
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

import { requireAdmin } from "../require-admin";
import {
  syncIfStale,
  getStoredFollowers,
  getLastSyncs,
  type Follower,
  type FollowerFilter,
  type Platform,
} from "@/lib/social-followers";
import { toggleStar, saveNotes, forceSync } from "./actions";
import { NotesField } from "./NotesField";

// Followers dashboard, now backed by social_followers (migration 0028).
// Renders the union of stored rows from both platforms with star + notes
// persisted across reloads, and surfaces a "they follow me but I don't
// follow back" filter so the operator can act on the dashboard's main
// purpose. The page itself triggers a sync-if-stale on every render so
// loading the page is enough to keep data fresh; an explicit "Refresh now"
// button bypasses the 5-minute TTL.

// Force dynamic so star/notes changes show immediately and so syncIfStale
// runs on every visit. Without this, Next.js would cache the rendered HTML
// and the live API + DB writes would still happen but the user would see
// stale markup.
export const dynamic = "force-dynamic";
export const metadata = { title: "Followers · admin · boxscore", robots: { index: false } };

const PLATFORM_LABEL: Record<Platform, string> = {
  twitter: "Twitter",
  bluesky: "Bluesky",
};

type ViewKey = "all" | "twitter" | "bluesky" | "starred" | "unreciprocated" | "removed";

const VIEWS: Array<{ key: ViewKey; label: string; filter: FollowerFilter }> = [
  { key: "all",            label: "All",            filter: {} },
  { key: "twitter",        label: "Twitter",        filter: { platform: "twitter" } },
  { key: "bluesky",        label: "Bluesky",        filter: { platform: "bluesky" } },
  { key: "starred",        label: "Starred",        filter: { starred: true } },
  { key: "unreciprocated", label: "Follow back?",   filter: { unreciprocated: true } },
  { key: "removed",        label: "Unfollowers",    filter: { includeRemoved: true } },
];

type SortKey = "starred" | "name" | "handle" | "bio" | "notes" | "following";
type SortDir = "asc" | "desc";

const SORT_KEYS: ReadonlySet<SortKey> = new Set([
  "starred", "name", "handle", "bio", "notes", "following",
]);

// Default direction when a column first becomes the active sort. Stars and
// the follow-back flag sort desc-first because the operator usually wants
// "show me the starred/followed ones first"; text columns sort asc-first.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  starred:   "desc",
  name:      "asc",
  handle:    "asc",
  bio:       "asc",
  notes:     "asc",
  following: "desc",
};

function compareFollowers(a: Follower, b: Follower, key: SortKey): number {
  // Secondary sort is always display name so rows with the same primary
  // value (e.g. both unstarred, both with empty notes) stay in a stable,
  // human-readable order.
  const byName = a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" });
  switch (key) {
    case "starred":
      return (Number(b.starred) - Number(a.starred)) || byName;
    case "name":
      return byName;
    case "handle":
      return a.handle.localeCompare(b.handle, "en", { sensitivity: "base" }) || byName;
    case "bio":
      // Empty bios sort to the end regardless of direction — they aren't
      // meaningful to compare.
      if (!a.bio && b.bio) return 1;
      if (a.bio && !b.bio) return -1;
      return a.bio.localeCompare(b.bio, "en", { sensitivity: "base" }) || byName;
    case "notes":
      if (!a.notes && b.notes) return 1;
      if (a.notes && !b.notes) return -1;
      return a.notes.localeCompare(b.notes, "en", { sensitivity: "base" }) || byName;
    case "following":
      return (Number(b.weFollow) - Number(a.weFollow)) || byName;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AdminFollowersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string; dir?: string }>;
}) {
  await requireAdmin();
  const { view: viewParam, sort: sortParam, dir: dirParam } = await searchParams;
  const sortKey: SortKey = SORT_KEYS.has(sortParam as SortKey)
    ? (sortParam as SortKey)
    : "name";
  const sortDir: SortDir = dirParam === "asc" || dirParam === "desc"
    ? dirParam
    : DEFAULT_DIR[sortKey];

  // Sync first so the read below reflects whatever the live APIs returned.
  // Errors are surfaced via the sync-log row, not thrown — one platform
  // failing shouldn't black-hole the whole page.
  const syncResult = await syncIfStale();

  // VIEWS is a non-empty const array so [0] is always defined; the ?? makes
  // TypeScript happy and falls through to "all" for any unknown view param.
  const active = VIEWS.find((v) => v.key === viewParam) ?? VIEWS[0]!;

  // For the "Unfollowers" view we want *only* removed rows; the default
  // filter API is "exclude removed unless asked", so flip it.
  const filter: FollowerFilter = active.key === "removed"
    ? { includeRemoved: true }
    : active.filter;

  const [followers, lastSyncs] = await Promise.all([
    getStoredFollowers(filter),
    getLastSyncs(),
  ]);

  const filtered = active.key === "removed"
    ? followers.filter((f) => f.removedAt != null)
    : followers;
  const visible = filtered.slice().sort((a, b) => {
    const cmp = compareFollowers(a, b, sortKey);
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Count per view for the filter chips. One DB call per view would be
  // wasteful; instead pull everything once (capped at the active filter
  // already includes everyone) and count in-process. For the chip counts
  // we want totals not filtered by the active view, so do a separate
  // unfiltered read.
  const all = await getStoredFollowers({ includeRemoved: true });
  const counts: Record<ViewKey, number> = {
    all:            all.filter((f) => !f.removedAt).length,
    twitter:        all.filter((f) => f.platform === "twitter" && !f.removedAt).length,
    bluesky:        all.filter((f) => f.platform === "bluesky" && !f.removedAt).length,
    starred:        all.filter((f) => f.starred && !f.removedAt).length,
    unreciprocated: all.filter((f) => !f.weFollow && !f.removedAt).length,
    removed:        all.filter((f) => f.removedAt != null).length,
  };

  return (
    <main className="admin">
      <h1>Followers</h1>
      <p className="admin-meta">
        Backed by <code>social_followers</code>; the live APIs are polled when
        the stored copy is older than 5 minutes.
        {" "}
        <SyncStatus lastSyncs={lastSyncs} />
      </p>

      <div className="followers-actions">
        <form action={forceSync}>
          <button type="submit" className="admin-btn">Refresh now</button>
        </form>
      </div>

      {Object.entries(syncResult.errors).map(([p, msg]) => (
        <p key={p} className="admin-meta admin-error">
          {PLATFORM_LABEL[p as Platform]} sync failed: {msg}
        </p>
      ))}

      <div className="followers-filter">
        {VIEWS.map((v) => (
          <a
            key={v.key}
            href={buildUrl({ view: v.key, sort: sortKey, dir: sortDir })}
            className={active.key === v.key ? "active" : undefined}
          >
            {v.label} ({counts[v.key]})
          </a>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="admin-meta">No followers in this view.</p>
      ) : (
        <table className="followers-table">
          <thead>
            <tr>
              <th className="fl-star">
                <SortHeader label="★" sortKey="starred" view={active.key} activeSort={sortKey} activeDir={sortDir} />
              </th>
              <th className="fl-avatar">&nbsp;</th>
              <th className="fl-handle">
                <SortHeader label="Handle" sortKey="handle" view={active.key} activeSort={sortKey} activeDir={sortDir} />
              </th>
              <th className="fl-name">
                <SortHeader label="Name" sortKey="name" view={active.key} activeSort={sortKey} activeDir={sortDir} />
              </th>
              <th className="fl-bio">
                <SortHeader label="Bio" sortKey="bio" view={active.key} activeSort={sortKey} activeDir={sortDir} />
              </th>
              <th className="fl-notes">
                <SortHeader label="Notes" sortKey="notes" view={active.key} activeSort={sortKey} activeDir={sortDir} />
              </th>
              <th className="fl-followback">
                <SortHeader label="Follow?" sortKey="following" view={active.key} activeSort={sortKey} activeDir={sortDir} />
              </th>
              <th className="fl-platform">Platform</th>
              <th className="fl-action">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => (
              <FollowerRow key={`${f.platform}:${f.handle}`} f={f} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function buildUrl(params: { view: ViewKey; sort: SortKey; dir: SortDir }): string {
  // Keep the URL clean: omit params that match the defaults so a fresh visit
  // to /admin/followers stays a bare path.
  const qs = new URLSearchParams();
  if (params.view !== "all") qs.set("view", params.view);
  if (params.sort !== "name") qs.set("sort", params.sort);
  if (params.dir !== DEFAULT_DIR[params.sort]) qs.set("dir", params.dir);
  const s = qs.toString();
  return s ? `/admin/followers?${s}` : "/admin/followers";
}

function SortHeader({
  label,
  sortKey,
  view,
  activeSort,
  activeDir,
}: {
  label: string;
  sortKey: SortKey;
  view: ViewKey;
  activeSort: SortKey;
  activeDir: SortDir;
}) {
  const isActive = activeSort === sortKey;
  // Clicking the active column flips direction; clicking any other column
  // jumps to that column's default direction so star/follow start "yes
  // first" and text columns start A→Z.
  const nextDir: SortDir = isActive
    ? (activeDir === "asc" ? "desc" : "asc")
    : DEFAULT_DIR[sortKey];
  const arrow = isActive
    ? (activeDir === "asc" ? "▲" : "▼")
    : "";
  return (
    <a
      href={buildUrl({ view, sort: sortKey, dir: nextDir })}
      className={isActive ? "fl-sort active" : "fl-sort"}
    >
      {label}
      <span className="fl-sort-arrow">{arrow}</span>
    </a>
  );
}

function SyncStatus({
  lastSyncs,
}: {
  lastSyncs: Awaited<ReturnType<typeof getLastSyncs>>;
}) {
  const parts: string[] = [];
  for (const p of ["twitter", "bluesky"] as Platform[]) {
    const row = lastSyncs[p];
    if (!row) {
      parts.push(`${PLATFORM_LABEL[p]} never synced`);
    } else if (row.error) {
      parts.push(`${PLATFORM_LABEL[p]} error ${timeAgo(row.synced_at)}`);
    } else {
      parts.push(`${PLATFORM_LABEL[p]} ${timeAgo(row.synced_at)}`);
    }
  }
  return <>Last sync: {parts.join(", ")}.</>;
}

function FollowerRow({ f }: { f: Follower }) {
  const removed = f.removedAt != null;
  return (
    <tr className={removed ? "fl-row-removed" : undefined}>
      <td className="fl-star">
        <form action={toggleStar}>
          <input type="hidden" name="platform" value={f.platform} />
          <input type="hidden" name="handle" value={f.handle} />
          <input type="hidden" name="current" value={f.starred ? "1" : "0"} />
          <button
            type="submit"
            className={f.starred ? "fl-star-btn on" : "fl-star-btn"}
            aria-label={f.starred ? "Unstar" : "Star"}
            title={f.starred ? "Unstar" : "Star"}
          >
            {f.starred ? "★" : "☆"}
          </button>
        </form>
      </td>
      <td className="fl-avatar">
        {f.avatar ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={f.avatar} alt="" width={40} height={40} loading="lazy" />
        ) : (
          <div className="fl-avatar-blank" aria-hidden="true" />
        )}
      </td>
      <td className="fl-handle">
        <span className="fl-handle-text">{f.handle}</span>
      </td>
      <td className="fl-name">
        <div className="fl-display">{f.displayName}</div>
        {removed && f.removedAt ? (
          <div className="fl-removed-tag">Unfollowed {timeAgo(f.removedAt)}</div>
        ) : null}
      </td>
      <td className="fl-bio">
        {f.bio || <span className="fl-empty">—</span>}
      </td>
      <td className="fl-notes">
        <NotesField
          platform={f.platform}
          handle={f.handle}
          defaultValue={f.notes}
          action={saveNotes}
        />
      </td>
      <td className="fl-followback">
        {f.weFollow ? (
          <span className="fl-yes" title="You follow back">✓</span>
        ) : (
          <span className="fl-no" title="You don't follow back">—</span>
        )}
      </td>
      <td className="fl-platform">{PLATFORM_LABEL[f.platform]}</td>
      <td className="fl-action">
        <a href={f.profileUrl} target="_blank" rel="noreferrer noopener">
          Open profile →
        </a>
      </td>
    </tr>
  );
}

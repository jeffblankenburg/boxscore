import { requireAdmin } from "../require-admin";
import { AdminNav } from "../AdminNav";
import { getAllFollowers, type Follower, type Platform } from "@/lib/social-followers";

// Followers dashboard. Live fetch on render with a 5-minute revalidate so a
// page refresh isn't a Twitter/Bluesky API hit every time. The page renders
// both platforms in one combined table sorted by displayName so Jeff can
// scan top-down to find amplifiers; tap a row's "Open profile" to act.

export const revalidate = 300;
export const metadata = { title: "Followers · admin · boxscore", robots: { index: false } };

const PLATFORM_LABEL: Record<Platform, string> = {
  twitter: "Twitter",
  bluesky: "Bluesky",
};

function sortByName(a: Follower, b: Follower): number {
  return a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" });
}

export default async function AdminFollowersPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  await requireAdmin();
  const { platform } = await searchParams;
  const { followers, errors } = await getAllFollowers();

  const visible = platform === "twitter" || platform === "bluesky"
    ? followers.filter((f) => f.platform === platform)
    : followers;
  const sorted = visible.slice().sort(sortByName);

  const counts = {
    twitter: followers.filter((f) => f.platform === "twitter").length,
    bluesky: followers.filter((f) => f.platform === "bluesky").length,
  };

  return (
    <main className="admin">
      <AdminNav active="followers" />
      <h1>Followers</h1>
      <p className="admin-meta">
        Combined view of the boxscore accounts&apos; followers on Twitter and
        Bluesky. Refreshes from the live APIs every 5 minutes.
      </p>

      <div className="followers-filter">
        <a
          href="/admin/followers"
          className={!platform ? "active" : undefined}
        >
          All ({followers.length})
        </a>
        <a
          href="/admin/followers?platform=twitter"
          className={platform === "twitter" ? "active" : undefined}
        >
          Twitter ({counts.twitter})
        </a>
        <a
          href="/admin/followers?platform=bluesky"
          className={platform === "bluesky" ? "active" : undefined}
        >
          Bluesky ({counts.bluesky})
        </a>
      </div>

      {Object.entries(errors).map(([p, msg]) => (
        <p key={p} className="admin-meta admin-error">
          {PLATFORM_LABEL[p as Platform]} fetch failed: {msg}
        </p>
      ))}

      {sorted.length === 0 ? (
        <p className="admin-meta">No followers in this view.</p>
      ) : (
        <table className="followers-table">
          <thead>
            <tr>
              <th className="fl-avatar">&nbsp;</th>
              <th className="fl-name">Name &amp; handle</th>
              <th className="fl-bio">Bio</th>
              <th className="fl-platform">Platform</th>
              <th className="fl-action">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={`${f.platform}:${f.handle}`}>
                <td className="fl-avatar">
                  {f.avatar ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={f.avatar} alt="" width={40} height={40} loading="lazy" />
                  ) : (
                    <div className="fl-avatar-blank" aria-hidden="true" />
                  )}
                </td>
                <td className="fl-name">
                  <div className="fl-display">{f.displayName}</div>
                  <div className="fl-handle">{f.handle}</div>
                </td>
                <td className="fl-bio">{f.bio || <span className="fl-empty">—</span>}</td>
                <td className="fl-platform">{PLATFORM_LABEL[f.platform]}</td>
                <td className="fl-action">
                  <a href={f.profileUrl} target="_blank" rel="noreferrer noopener">
                    Open profile →
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

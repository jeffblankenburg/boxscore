import { getStoredManifest } from "@/lib/share-storage";
import { imagePostContent } from "@/lib/social-content";
import { CopyButtons } from "./CopyButtons";
import { requireAdmin } from "../require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Twitter compose · admin · boxscore", robots: { index: false } };

export default async function AdminTwitterCompose() {
  await requireAdmin();
  const manifest = await getStoredManifest();
  if (!manifest) {
    return (
      <main className="admin">
        <h1>Twitter compose</h1>
        <p className="admin-meta">
          No share images currently in Storage. Generate them first at{" "}
          <a href="/admin/images">/admin/images</a>.
        </p>
      </main>
    );
  }

  const posts = manifest.entries.map(({ entry, url }) => {
    const { text } = imagePostContent(entry, manifest.prettyDate);
    return { entry, url, text };
  });

  return (
    <main className="admin admin-wide">
      <h1>Twitter compose</h1>
      <p className="admin-meta">
        {manifest.entries.length} posts for <i>{manifest.prettyDate}</i>.
        For each: click <b>Copy text</b> → paste into the X compose box → click{" "}
        <b>Copy image</b> → paste again to attach the image → post.
      </p>
      <p className="admin-meta">
        Quick link to compose:{" "}
        <a href="https://twitter.com/intent/post" target="_blank" rel="noreferrer">
          twitter.com/intent/post
        </a>
      </p>

      <ol className="twitter-post-list">
        {posts.map((p) => (
          <li key={p.entry.subId} className="twitter-post-card">
            <div className="twitter-post-image">
              <img src={p.url} alt={p.entry.subId} loading="lazy" />
            </div>
            <div className="twitter-post-body">
              <div className="twitter-post-label">{p.entry.subId}</div>
              <pre className="twitter-post-text">{p.text}</pre>
              <CopyButtons text={p.text} imageUrl={p.url} />
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}

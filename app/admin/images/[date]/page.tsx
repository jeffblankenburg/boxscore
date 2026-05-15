import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { notFound } from "next/navigation";
import { isValidIsoDate } from "@/lib/dates";
import { regenerateShareImages } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Share images · admin · boxscore.email", robots: { index: false } };

export default async function AdminImagesView({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidIsoDate(date)) notFound();

  const dir = resolve("out/share", date);
  let files: string[] = [];
  try {
    files = (await readdir(dir))
      .filter((f) => f.endsWith(".png"))
      .sort();
  } catch {
    // dir doesn't exist yet — empty state
  }

  return (
    <main className="admin">
      <h1>Share images · {date}</h1>

      <form action={async () => {
        "use server";
        await regenerateShareImages(date);
      }}>
        <button className="admin-btn" type="submit">
          {files.length > 0 ? "Regenerate images" : "Generate images"}
        </button>
      </form>

      {files.length === 0 ? (
        <p className="admin-meta">
          No images yet. Click <em>Generate images</em>. (Requires the dev
          server to be running and Playwright installed.)
        </p>
      ) : (
        <p className="admin-meta">
          {files.length} images in <code>out/share/{date}/</code>
        </p>
      )}

      <div className="admin-image-grid">
        {files.map((f) => (
          <figure key={f}>
            <a href={`/admin/file/${date}/${f}`} target="_blank" rel="noreferrer">
              <img src={`/admin/file/${date}/${f}`} alt={f} loading="lazy" />
            </a>
            <figcaption>{f}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}

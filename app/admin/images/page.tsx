import { listStoredImages } from "@/lib/share-storage";
import { yesterdayInET, prettyDate } from "@/lib/dates";
import { regenerateShareImages } from "../actions";
import { SubmitButton } from "../SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Share images · admin · boxscore.email", robots: { index: false } };

export default async function AdminImagesView({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const defaultDate = yesterdayInET();
  const { date, images } = await listStoredImages();
  const { error, ok } = await searchParams;

  return (
    <main className="admin">
      <h1>Share images</h1>
      {ok && (
        <p className="admin-success">
          <strong>✓</strong> {ok}
        </p>
      )}
      {error && (
        <p className="admin-error">
          <strong>Regenerate failed:</strong> {error}
        </p>
      )}
      <p className="admin-meta">
        {date
          ? `${images.length} images in Storage for ${prettyDate(date)}.`
          : "Nothing in Storage yet."}
      </p>

      <form action={regenerateShareImages} className="admin-regen-form">
        <label>
          Date:{" "}
          <input
            name="date"
            type="date"
            defaultValue={defaultDate}
            className="admin-input"
          />
        </label>
        <SubmitButton
          idleLabel={images.length > 0 ? "Regenerate" : "Generate"}
          pendingLabel="Generating… (10–30s)"
        />
        <span className="admin-meta">Renders the page, screenshots each section, uploads to Storage.</span>
      </form>

      <div className="admin-image-grid">
        {images.map((img) => (
          <figure key={img.file}>
            <a href={img.url} target="_blank" rel="noreferrer">
              <img src={img.url} alt={img.file} loading="lazy" />
            </a>
            <figcaption>{img.file}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}

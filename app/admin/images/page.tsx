import { listStoredImages } from "@/lib/share-storage";
import { yesterdayInET, prettyDate, nextDay, prevDay } from "@/lib/dates";
import { regenerateShareImages } from "../actions";
import { SubmitButton } from "../SubmitButton";
import { requireAdmin } from "../require-admin";
import { AdminNav } from "../AdminNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Share images · admin · boxscore", robots: { index: false } };

export default async function AdminImagesView({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  await requireAdmin();
  // Input shows the edition date (today); regenerateShareImages expects
  // games_date so the form wrapper translates at submission.
  const defaultDate = nextDay(yesterdayInET());
  const { date, images } = await listStoredImages();
  const { error, ok } = await searchParams;

  return (
    <main className="admin">
      <AdminNav />
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

      <form
        action={async (formData: FormData) => {
          "use server";
          // Edition date → games_date at the boundary.
          const raw = formData.get("date");
          if (typeof raw === "string" && raw) formData.set("date", prevDay(raw));
          await regenerateShareImages(formData);
        }}
        className="admin-regen-form"
      >
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

      {images.length > 0 && (
        <p className="admin-meta">
          <a href="/admin/images/download" className="admin-link">
            Download all as ZIP
          </a>
        </p>
      )}

      <div className="admin-image-grid">
        {images.map((img) => {
          const bust = img.updatedAt ? `?v=${encodeURIComponent(img.updatedAt)}` : "";
          const src = `${img.url}${bust}`;
          return (
            <figure key={img.file}>
              <a href={src} target="_blank" rel="noreferrer">
                <img src={src} alt={img.file} loading="lazy" />
              </a>
              <figcaption>{img.file}</figcaption>
            </figure>
          );
        })}
      </div>
    </main>
  );
}

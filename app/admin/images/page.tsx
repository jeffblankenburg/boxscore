import { redirect } from "next/navigation";
import { listStoredDates, listStoredImages } from "@/lib/share-storage";
import {
  yesterdayInET,
  prettyDate,
  nextDay,
  prevDay,
  isValidIsoDate,
} from "@/lib/dates";
import { regenerateShareImages } from "../actions";
import { SubmitButton } from "../SubmitButton";
import { requireAdmin } from "../require-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Share images · admin · boxscore", robots: { index: false } };

export default async function AdminImagesView({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; date?: string }>;
}) {
  await requireAdmin();
  const { error, ok, date: rawDate } = await searchParams;

  // Explicit ?date= shows exactly that date — even when empty — so the URL is
  // a stable bookmark. No ?date= defaults to the latest date present in the
  // bucket, falling back to today's edition only when the bucket is empty.
  const todaysEdition = nextDay(yesterdayInET());
  const explicitDate =
    rawDate && isValidIsoDate(rawDate) ? rawDate : null;

  const [latestSet, allDates] = await Promise.all([
    listStoredImages(),
    listStoredDates(),
  ]);

  const viewDate =
    explicitDate ?? latestSet.date ?? todaysEdition;

  const { images } =
    explicitDate && explicitDate !== latestSet.date
      ? await listStoredImages(explicitDate)
      : { images: latestSet.images };

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
        {images.length > 0
          ? `${images.length} images in Storage for ${prettyDate(viewDate)}.`
          : allDates.length > 0
            ? `No images for ${prettyDate(viewDate)}. ${allDates.length} other date${allDates.length === 1 ? "" : "s"} in Storage.`
            : "Nothing in Storage yet."}
      </p>

      {allDates.length > 0 && (
        <form
          action={async (formData: FormData) => {
            "use server";
            const d = formData.get("date");
            if (typeof d === "string" && isValidIsoDate(d)) {
              redirect(`/admin/images?date=${d}`);
            }
            redirect("/admin/images");
          }}
          className="admin-regen-form"
        >
          <label>
            View date:{" "}
            <select name="date" defaultValue={viewDate} className="admin-input">
              {allDates.includes(viewDate) ? null : (
                <option value={viewDate}>{prettyDate(viewDate)} (no images)</option>
              )}
              {allDates.map((d) => (
                <option key={d} value={d}>{prettyDate(d)}</option>
              ))}
            </select>
          </label>
          <SubmitButton idleLabel="View" pendingLabel="Loading…" />
        </form>
      )}

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
          Regenerate date:{" "}
          <input
            name="date"
            type="date"
            defaultValue={todaysEdition}
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
          <a href={`/admin/images/download?date=${viewDate}`} className="admin-link">
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

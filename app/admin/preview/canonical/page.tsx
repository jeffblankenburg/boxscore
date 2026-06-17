import { redirect } from "next/navigation";
import { requireAdmin } from "../../require-admin";
import { yesterdayInET } from "@/lib/dates";

// Bare /admin/preview/canonical entry — bounce to yesterday so the
// sidebar link has a sensible default landing date.
export const dynamic  = "force-dynamic";
export const metadata = { title: "Canonical preview · admin · boxscore", robots: { index: false } };

export default async function CanonicalPreviewIndex() {
  await requireAdmin();
  redirect(`/admin/preview/canonical/${yesterdayInET()}?source=statsapi`);
}

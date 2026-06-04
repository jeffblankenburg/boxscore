import { requireAdmin } from "../../require-admin";
import { EmailSearch } from "../../EmailSearch";
import { PageHeader, Section } from "../../_components/primitives";

// /admin/operations/email-lookup — the "I need to look up an email RIGHT NOW"
// tool. Paste a recipient address; see every send to it. Used to triage user
// support requests ("did I get this morning's digest?") and confirm that a
// subscriber state matches their email history.

export const dynamic = "force-dynamic";
export const metadata = { title: "Email lookup · Operations · boxscore admin", robots: { index: false } };

export default async function EmailLookupPage() {
  await requireAdmin();

  return (
    <>
      <PageHeader
        title="Email lookup"
        subtitle="Paste a recipient email to see their subscriber state and every send to that address."
        breadcrumbs={[{ label: "Operations" }, { label: "Email lookup" }]}
      />

      <Section>
        <EmailSearch />
      </Section>
    </>
  );
}

// Lead enrichment for /advertise inquiries.
//
// Today: domain parsing only. Strips the email domain, recognizes
// consumer-mail providers (gmail/yahoo/etc) and skips enrichment for
// those, and surfaces the company domain for everyone else. This is
// the "no API key required" baseline — gets us ~80% of the lead-
// intel value for $0 (the domain itself is usually the company name
// in dotcom form, which is what a salesperson actually needs to
// research and follow up).
//
// Tomorrow: drop a real API call into `enrichViaApi` (Apollo, Hunter,
// or whichever provider has a usable free tier when we decide). The
// shape returned matches the advertise_inquiries columns so the
// caller can spread it directly into the update.
//
// Why per-inquiry snapshot (not a separate company table): a person
// at Acme today might be at DifferentCo next year; the lead row
// records what was true at submission. Lower coupling, simpler
// /admin/leads read.

export type EnrichmentResult = {
  enrichment_status:    "ok" | "not_found" | "error" | "pending";
  enrichment_company:   string | null;
  enrichment_domain:    string | null;
  enrichment_industry:  string | null;
  enrichment_employees: number | null;
  enrichment_linkedin:  string | null;
};

// Domains we treat as "personal email, not enrichable." Order doesn't
// matter — Set lookup. Keep this list small; obscure ISP domains can
// stay as best-effort company stand-ins.
const CONSUMER_DOMAINS = new Set<string>([
  "gmail.com", "googlemail.com",
  "yahoo.com", "ymail.com", "yahoo.co.uk", "yahoo.ca",
  "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
  "proton.me", "protonmail.com", "tutanota.com",
  "duck.com",
]);

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase().trim();
  if (!d.includes(".")) return null;
  return d;
}

// Best guess at a human-readable company name from a domain — strip
// the TLD and capitalize. "greenfield-garden.com" → "Greenfield Garden".
// Falls back to the bare domain when the pattern is weird.
function companyFromDomain(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  if (!stem) return domain;
  return stem
    .split(/[-_]/)
    .map((w) => w.length === 0 ? "" : w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** Synchronous baseline — purely domain parsing, no network. */
export function enrichFromDomain(email: string): EnrichmentResult {
  const domain = extractDomain(email);
  if (!domain) {
    return {
      enrichment_status: "not_found",
      enrichment_company: null, enrichment_domain: null,
      enrichment_industry: null, enrichment_employees: null,
      enrichment_linkedin: null,
    };
  }
  if (CONSUMER_DOMAINS.has(domain)) {
    return {
      enrichment_status: "not_found",
      enrichment_company: null, enrichment_domain: domain,
      enrichment_industry: null, enrichment_employees: null,
      enrichment_linkedin: null,
    };
  }
  return {
    enrichment_status: "ok",
    enrichment_company:  companyFromDomain(domain),
    enrichment_domain:   domain,
    enrichment_industry: null,
    enrichment_employees: null,
    enrichment_linkedin: null,
  };
}

// Placeholder for the real API integration. When we decide on a
// provider, fill this in with the network call and let it override
// the domain-only baseline. Keeping the seam here so the call site
// in actions.ts doesn't have to change.
//
// export async function enrichViaApi(email: string): Promise<EnrichmentResult | null> {
//   const key = process.env.ENRICHMENT_API_KEY;
//   if (!key) return null;
//   // ... fetch + parse + return same shape
// }

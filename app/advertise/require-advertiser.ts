import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADVERTISER_SESSION_COOKIE, validateSession } from "@/lib/advertiser-auth";
import { supabaseAdmin } from "@/lib/supabase";

export type AdvertiserSession = {
  email: string;
  advertiserId: string;
  advertiserName: string;
};

// Server-side gate for /advertise/account. Validates the session cookie,
// resolves the matching ad_advertisers row (case-insensitive), and returns
// the canonical identity. Redirects to /advertise/login on any miss.
//
// Cookie email won't always be perfectly case-aligned with the stored
// advertiser email — the column has a `lower(email)` unique index but the
// row preserves whatever case the admin entered. ilike(?, normalized)
// handles that without needing a trigger.
export async function requireAdvertiser(): Promise<AdvertiserSession> {
  const jar = await cookies();
  const sessionToken = jar.get(ADVERTISER_SESSION_COOKIE)?.value;
  const email = sessionToken ? await validateSession(sessionToken) : null;
  if (!email) redirect("/advertise/login");

  const { data, error } = await supabaseAdmin()
    .from("ad_advertisers")
    .select("id, name")
    .ilike("email", email)
    .maybeSingle<{ id: string; name: string }>();
  if (error) {
    console.error(`requireAdvertiser lookup: ${error.message}`);
    redirect("/advertise/login");
  }
  // Session points at an email that no longer has an advertiser row
  // (deleted between cookie issuance and now). Treat as signed-out.
  if (!data) redirect("/advertise/login");

  return { email, advertiserId: data.id, advertiserName: data.name };
}

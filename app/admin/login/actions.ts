"use server";

import { redirect } from "next/navigation";
import { issueCode } from "@/lib/admin-auth";
import { sendEmail } from "@/lib/email";

// Login flow step 1: user submits email, we mint a code and email it.
// Always redirects to /admin/verify so an outside observer can't tell which
// emails are valid admin addresses (single-user app, but cheap to do right).
export async function requestCode(formData: FormData): Promise<void> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email || !email.includes("@")) {
    redirect(`/admin/login?error=${encodeURIComponent("Enter a valid email.")}`);
  }

  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (!adminEmail) {
    redirect(`/admin/login?error=${encodeURIComponent("ADMIN_EMAIL not set on the server.")}`);
  }

  if (email === adminEmail) {
    try {
      const { plaintext } = await issueCode(email);
      await sendEmail({
        to: email,
        subject: `boxscore admin code: ${plaintext}`,
        html: `<p>Your boxscore admin sign-in code is:</p>
               <p style="font-size:24px; font-weight:700; letter-spacing:4px;">${plaintext}</p>
               <p style="color:#666; font-size:13px;">Good for 10 minutes. If you didn&rsquo;t request this, you can ignore the message.</p>`,
        text: `Your boxscore admin sign-in code: ${plaintext}\n\nGood for 10 minutes.`,
      });
    } catch (err) {
      console.error(`[admin/login] requestCode for ${email}: ${(err as Error).message}`);
      // Still redirect to verify to avoid leaking — operator can check Resend
      // logs if no code arrives.
    }
  }

  redirect(`/admin/verify?email=${encodeURIComponent(email)}`);
}

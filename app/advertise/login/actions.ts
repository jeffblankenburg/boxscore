"use server";

import { redirect } from "next/navigation";
import { isAdvertiserEmail, issueCode } from "@/lib/advertiser-auth";
import { sendEmail } from "@/lib/email";

// Portal login step 1: email → 6-digit code. Always redirects to /verify even
// for unknown emails so the page can't be used as an "is X an advertiser?"
// oracle. Operator sees the gap in Resend logs if a legitimate advertiser
// doesn't get their code.
export async function requestCode(formData: FormData): Promise<void> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!email || !email.includes("@")) {
    redirect(`/advertise/login?error=${encodeURIComponent("Enter a valid email.")}`);
  }

  if (await isAdvertiserEmail(email)) {
    try {
      const { plaintext } = await issueCode(email);
      await sendEmail({
        to: email,
        subject: `boxscore portal code: ${plaintext}`,
        html: `<p>Your boxscore advertiser portal sign-in code is:</p>
               <p style="font-size:24px; font-weight:700; letter-spacing:4px;">${plaintext}</p>
               <p style="color:#666; font-size:13px;">Good for 10 minutes. If you didn&rsquo;t request this, you can ignore the message.</p>`,
        text: `Your boxscore advertiser portal sign-in code: ${plaintext}\n\nGood for 10 minutes.`,
      });
    } catch (err) {
      console.error(`[advertise/login] requestCode for ${email}: ${(err as Error).message}`);
    }
  }

  redirect(`/advertise/verify?email=${encodeURIComponent(email)}`);
}

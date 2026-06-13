import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  validateSession,
  SUBSCRIBER_SESSION_COOKIE,
} from "@/lib/subscriber-auth";
import { DemographicsForm } from "./DemographicsForm";
import "./welcome.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Welcome — boxscore",
  robots: { index: false },
};

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const jar = await cookies();
  const session = await validateSession(jar.get(SUBSCRIBER_SESSION_COOKIE)?.value);
  // Anonymous arrivals get pushed to subscribe. The welcome page only
  // makes sense in the post-confirmation moment when a session cookie
  // is freshly set.
  if (!session) redirect("/subscribe");

  return (
    <main className="welcome">
      <section className="welcome-card">
        <h1 className="welcome-h1">Welcome to boxscore.</h1>
        <p className="welcome-lede">
          Boxscore stays free because advertisers help support it — and
          they want to understand who&rsquo;s reading. A few quick optional
          answers give us an aggregate picture of the audience. Every
          field is optional, and you can change or clear them later in
          Settings.
        </p>
        {sp.error === "save_failed" ? (
          <p className="welcome-error">Sorry — that didn&rsquo;t save. Try again?</p>
        ) : null}
        <DemographicsForm showSkip />
      </section>
    </main>
  );
}

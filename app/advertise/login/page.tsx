import { SubmitButton } from "@/app/admin/SubmitButton";
import { requestCode } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign in · Advertiser portal · boxscore",
  robots: { index: false, follow: false },
};

export default async function AdvertiseLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const { error, email } = await searchParams;
  return (
    <main className="advertise-page">
      <div className="advertise-masthead">
        <div className="advertise-masthead-section">Advertiser portal</div>
        <div className="advertise-masthead-edition">Sign in</div>
      </div>
      <header className="advertise-lede">
        <h1>Sign in to your campaigns.</h1>
        <p>
          Enter the email address on file with boxscore. We&rsquo;ll send a
          six-digit code that&rsquo;s good for 10 minutes.
        </p>
      </header>
      <section className="advertise-section">
        {error && (
          <p className="advertise-meta" style={{ color: "#b00", marginBottom: 12 }}>
            <strong>Failed:</strong> {error}
          </p>
        )}
        <form action={requestCode} className="admin-auth-form">
          <label>
            <span className="admin-trigger-label">Email</span>
            <input
              type="email"
              name="email"
              className="admin-input"
              defaultValue={email ?? ""}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </label>
          <SubmitButton idleLabel="Send code" pendingLabel="Sending…" />
        </form>
        <p className="advertise-meta" style={{ marginTop: 20 }}>
          Not an advertiser yet?{" "}
          <a href="/advertise">See the media kit and inquire here</a>.
        </p>
      </section>
    </main>
  );
}

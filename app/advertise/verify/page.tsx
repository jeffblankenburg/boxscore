import { SubmitButton } from "@/app/admin/SubmitButton";
import { verifyCode } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Enter code · Advertiser portal · boxscore",
  robots: { index: false, follow: false },
};

export default async function AdvertiseVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email, error } = await searchParams;
  return (
    <main className="advertise-page">
      <div className="advertise-masthead">
        <div className="advertise-masthead-section">Advertiser portal</div>
        <div className="advertise-masthead-edition">Enter your code</div>
      </div>
      <header className="advertise-lede">
        <h1>Enter your code.</h1>
        <p>
          If <code>{email ?? "(no email)"}</code> matches an advertiser on file,
          a six-digit code is on its way. Codes are good for 10 minutes.
        </p>
      </header>
      <section className="advertise-section">
        {error && (
          <p className="advertise-meta" style={{ color: "#b00", marginBottom: 12 }}>
            <strong>Failed:</strong> {error}
          </p>
        )}
        <form action={verifyCode} className="admin-auth-form">
          <input type="hidden" name="email" value={email ?? ""} />
          <label>
            <span className="admin-trigger-label">Code</span>
            <input
              type="text"
              name="code"
              className="admin-input admin-code-input"
              placeholder="000000"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </label>
          <SubmitButton idleLabel="Sign in" pendingLabel="Verifying…" />
        </form>
        <p className="advertise-meta" style={{ marginTop: 20 }}>
          <a href="/advertise/login">← Use a different email</a>
        </p>
      </section>
    </main>
  );
}

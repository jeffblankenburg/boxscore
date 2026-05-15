import { SubmitButton } from "../SubmitButton";
import { verifyCode } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enter code · Admin", robots: { index: false } };

export default async function AdminVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email, error } = await searchParams;
  return (
    <main className="admin admin-auth">
      <h1>Enter your code</h1>
      <p className="admin-meta">
        If <code>{email ?? "(no email)"}</code> matches the admin address, a 6-digit
        code is on its way. Codes are good for 10 minutes.
      </p>
      {error && (
        <p className="admin-error"><strong>Failed:</strong> {error}</p>
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
      <p className="admin-meta" style={{ marginTop: 16 }}>
        <a href="/admin/login">← Use a different email</a>
      </p>
    </main>
  );
}

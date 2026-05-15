import { SubmitButton } from "../SubmitButton";
import { requestCode } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Admin", robots: { index: false } };

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const { error, email } = await searchParams;
  return (
    <main className="admin admin-auth">
      <h1>Admin sign-in</h1>
      <p className="admin-meta">
        Enter your admin email. We&apos;ll email a 6-digit code that&apos;s good for
        10 minutes.
      </p>
      {error && (
        <p className="admin-error"><strong>Failed:</strong> {error}</p>
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
    </main>
  );
}

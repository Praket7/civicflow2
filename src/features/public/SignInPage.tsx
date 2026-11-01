import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, CheckboxField, TextField } from "../../components/ui";
import { hostedAuthConfigured } from "../../lib/auth/hosted";
import { accountHome, useAuth } from "../../lib/auth/session";
import type { Account } from "../../types/domain";
import { AuthPortrait } from "./AuthPortrait";
import { GoogleSignIn } from "./GoogleSignIn";
import styles from "./auth.module.css";
import { messageOf } from "../../lib/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function describeError(caught: unknown): string {
  if (caught && typeof caught === "object" && "message" in caught) {
    return String((caught as { message: unknown }).message);
  }
  return messageOf(caught);
}

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signIn, openDemo, expired } = useAuth();
  // A deep link that bounced through RequireAuth leaves the page it wanted.
  // Only honour it when the signed-in role can actually open that section.
  const from = (location.state as { from?: string } | null)?.from ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  // Without this, the guard below races the navigation after a sign-in.
  const leaving = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: { email?: string; password?: string; form?: string } = {};
    const cleanEmail = email.trim();
    if (!cleanEmail) next.email = "Enter the email address for this workspace.";
    else if (!EMAIL_PATTERN.test(cleanEmail))
      next.email = "Use an email address like name@example.org.";
    if (!password) next.password = "Enter your password.";
    else if (password.length < 8) next.password = "Passwords are at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      const session = await signIn(cleanEmail, password, remember);
      leaving.current = true;
      navigate(destination(session.user), { replace: true });
    } catch (caught) {
      setErrors({ form: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  function destination(account: Account): string {
    const allowed = account.role === "coordinator" ? "/coordinator/" : "/volunteer/";
    return from.startsWith(allowed) ? from : accountHome(account);
  }

  async function openDemoWorkspace() {
    setErrors({});
    setBusy(true);
    try {
      const session = await openDemo(remember);
      leaving.current = true;
      navigate(destination(session.user), { replace: true });
    } catch (caught) {
      setErrors({ form: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  // Signing in over an existing session would silently swap accounts.
  if (user && !busy && !leaving.current) return <Navigate to={accountHome(user)} replace />;

  return (
    <main className={styles.screen}>
      <Link className={styles.back} to="/welcome">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to welcome
      </Link>

      <section className={styles.card} aria-labelledby="sign-in-title">
        <AuthPortrait />

        <div className={styles.formPanel}>
          <div className={styles.formHead}>
            <h1 className={styles.title} id="sign-in-title">
              Welcome back
            </h1>
            <p className={styles.subtitle}>Sign in to your CivicFlow workspace.</p>
          </div>

          {expired ? (
            <p className={styles.resetNote} role="status">
              Your session ended on this device. Sign in again to pick up where you left off.
            </p>
          ) : null}

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.fields}>
              <TextField
                label="Email"
                className={styles.fieldInput}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.org"
                value={email}
                error={errors.email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
                }}
              />
              <TextField
                label="Password"
                className={styles.fieldInput}
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                error={errors.password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (errors.password)
                    setErrors((current) => ({ ...current, password: undefined }));
                }}
              />
            </div>

            <div className={styles.formMeta}>
              <CheckboxField
                label="Keep me signed in on this device"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              {hostedAuthConfigured ? (
                <Link className={styles.forgot} to="/forgot-password">
                  Forgot password?
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.forgot}
                  aria-expanded={helpOpen}
                  onClick={() => setHelpOpen((open) => !open)}
                >
                  Forgot password?
                </button>
              )}
            </div>

            {helpOpen ? (
              <div className={styles.resetNote} role="note">
                <p>
                  Passwords live in this device&rsquo;s database, so there is no reset email to
                  send. A coordinator resets yours from Settings &rarr; Accounts in about a minute.
                </p>
              </div>
            ) : null}

            {errors.form ? (
              <p className={styles.error} role="alert">
                {errors.form}
              </p>
            ) : null}

            <Button type="submit" size="large" className={styles.primary} disabled={busy}>
              {busy ? "Signing in…" : "Continue"}
            </Button>

            {hostedAuthConfigured ? (
              <GoogleSignIn
                label="Continue with Google"
                disabled={busy}
                onError={(message) => setErrors({ form: message })}
              />
            ) : null}

            <div className={styles.divider} aria-hidden="true">
              <span>or</span>
            </div>

            <Button
              variant="secondary"
              size="large"
              className={styles.demo}
              onClick={() => void openDemoWorkspace()}
              disabled={busy}
            >
              Open demo workspace
            </Button>
          </form>

          <p className={styles.swap}>
            New to CivicFlow? <Link to="/create-account">Create an account</Link>
          </p>

          <div className={styles.localNote}>
            <LockKeyhole size={15} strokeWidth={1.9} aria-hidden="true" />
            <div>
              <p className={styles.localTitle}>
                {hostedAuthConfigured
                  ? "Google and email accounts work anywhere. Local accounts still work offline."
                  : "Local accounts protect the two workspaces."}
              </p>
              <p className={styles.localBody}>
                {hostedAuthConfigured
                  ? "Google and email sign-in are handled by Supabase Auth. Workspace records stay in this device's database."
                  : "Passwords are stored as Argon2 hashes in this device's database. No network requests leave the app."}
              </p>
            </div>
          </div>

          <p className={styles.legal}>By continuing you agree to the demo workspace terms.</p>
        </div>
      </section>
    </main>
  );
}

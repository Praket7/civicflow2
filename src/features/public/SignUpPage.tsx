import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, KeyRound, LockKeyhole, Mail } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button, CheckboxField, TextField } from "../../components/ui";
import {
  hostedAuthConfigured,
  hostedSignUp,
  identityFromUser,
  rememberPendingSignup,
  resendHostedVerification,
} from "../../lib/auth/hosted";
import { accountHome, useAuth } from "../../lib/auth/session";
import { markSetupPending } from "../../lib/onboarding/store";
import { AuthPortrait } from "./AuthPortrait";
import { GoogleSignIn } from "./GoogleSignIn";
import styles from "./auth.module.css";
import local from "./SignUpPage.module.css";
import { messageOf } from "../../lib/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
  form?: string;
};

function readError(caught: unknown): { message: string; field?: string } {
  if (caught && typeof caught === "object") {
    const bag = caught as { message?: unknown; field?: unknown };
    return {
      message: typeof bag.message === "string" ? bag.message : String(caught),
      field: typeof bag.field === "string" ? bag.field : undefined,
    };
  }
  return { message: messageOf(caught) };
}

function newCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => String(byte % 10)).join("");
}

export function SignUpPage() {
  const navigate = useNavigate();
  const { user, signUp, adoptHostedIdentity } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [step, setStep] = useState<"details" | "verify" | "sent">("details");
  const [challenge, setChallenge] = useState("");
  const [codeEntry, setCodeEntry] = useState("");
  const [codeError, setCodeError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendBusy, setResendBusy] = useState(false);

  function clearError(field: keyof FieldErrors) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function beginVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: FieldErrors = {};
    const cleanName = name.trim().replace(/\s+/g, " ");
    const cleanEmail = email.trim();
    if (cleanName.length < 2) next.name = "Enter the name to show on this account.";
    if (!cleanEmail) next.email = "Enter the email address for this account.";
    else if (!EMAIL_PATTERN.test(cleanEmail))
      next.email = "Use an email address like name@example.org.";
    if (password.length < 8) next.password = "Use at least 8 characters for the password.";
    if (confirm !== password) next.confirm = "The two passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (hostedAuthConfigured) {
      setBusy(true);
      setNotice("");
      try {
        const identity = { name: cleanName, email: cleanEmail.toLowerCase() };
        rememberPendingSignup(identity);
        const result = await hostedSignUp(identity, password);
        if (result.session?.user) {
          const resolved = identityFromUser(result.session.user);
          if (!resolved) throw new Error("That account has no email address.");
          const session = await adoptHostedIdentity(resolved, remember);
          markSetupPending(session.user.email);
          navigate(accountHome(session.user), { replace: true });
          return;
        }
        setStep("sent");
      } catch (caught) {
        const { message, field } = readError(caught);
        setErrors(
          field === "name" || field === "email" || field === "password"
            ? { [field]: message }
            : { form: message },
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    setChallenge(newCode());
    setCodeEntry("");
    setCodeError("");
    setStep("verify");
  }

  async function resendVerification() {
    setResendBusy(true);
    setNotice("");
    try {
      await resendHostedVerification(email.trim().toLowerCase());
      setNotice("A new confirmation link is on its way.");
    } catch (caught) {
      setErrors({ form: readError(caught).message });
    } finally {
      setResendBusy(false);
    }
  }

  async function finish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (codeEntry !== challenge) {
      setCodeError("That code does not match. Check the six digits and try again.");
      return;
    }
    setBusy(true);
    try {
      const session = await signUp(
        name.trim().replace(/\s+/g, " "),
        email.trim(),
        password,
        remember,
      );
      markSetupPending(session.user.email);
      navigate(accountHome(session.user), { replace: true });
    } catch (caught) {
      const { message, field } = readError(caught);
      setStep("details");
      setErrors(
        field === "name" || field === "email" || field === "password"
          ? { [field]: message }
          : { form: message },
      );
    } finally {
      setBusy(false);
    }
  }

  // An account already signed in on this device goes to its own home; creating
  // another one here would replace the session without warning.
  if (user && !busy) return <Navigate to={accountHome(user)} replace />;

  return (
    <main className={styles.screen}>
      <Link className={styles.back} to="/welcome">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to welcome
      </Link>

      <section className={styles.card} aria-labelledby="create-account-title">
        <AuthPortrait />

        <div className={styles.formPanel}>
          <div className={styles.formHead}>
            <h1 className={styles.title} id="create-account-title">
              {step === "details"
                ? "Create your account"
                : step === "verify"
                  ? "Verify your email"
                  : "Check your inbox"}
            </h1>
            <p className={styles.subtitle}>
              {step === "details"
                ? hostedAuthConfigured
                  ? "One account per person. We email a link to confirm your address."
                  : "One account per person. It stays on this device."
                : step === "verify"
                  ? `Enter the six-digit code for ${email.trim().toLowerCase()}.`
                  : `We sent a confirmation link to ${email.trim().toLowerCase()}. Open it on this device to finish.`}
            </p>
          </div>

          {step === "details" ? (
            <form className={styles.form} onSubmit={beginVerification} noValidate>
              <div className={styles.fields}>
                <TextField
                  label="Full name"
                  className={styles.fieldInput}
                  name="name"
                  autoComplete="name"
                  placeholder="Alicia Moreno"
                  value={name}
                  error={errors.name}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearError("name");
                  }}
                />
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
                    clearError("email");
                  }}
                />
                <TextField
                  label="Password"
                  className={styles.fieldInput}
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  error={errors.password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearError("password");
                  }}
                />
                <TextField
                  label="Confirm password"
                  className={styles.fieldInput}
                  type="password"
                  name="confirm-password"
                  autoComplete="new-password"
                  placeholder="Type the same password again"
                  value={confirm}
                  error={errors.confirm}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    clearError("confirm");
                  }}
                />
              </div>

              <div className={styles.formMeta}>
                <CheckboxField
                  label="Keep me signed in on this device"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
              </div>

              {errors.form ? (
                <p className={styles.error} role="alert">
                  {errors.form}
                </p>
              ) : null}

              <Button type="submit" size="large" className={styles.primary} disabled={busy}>
                Continue
              </Button>

              {hostedAuthConfigured ? (
                <GoogleSignIn
                  label="Sign up with Google"
                  disabled={busy}
                  onError={(message) => setErrors({ form: message })}
                />
              ) : null}

              <ul className={local.checklist}>
                <li>
                  <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                  Next: create an organization or redeem an invitation. Your role comes from that
                  membership.
                </li>
                <li>
                  <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                  {hostedAuthConfigured
                    ? "Google accounts skip the email step. Email sign-ups get a confirmation link from Supabase Auth."
                    : "Passwords are hashed with Argon2id and never leave this device."}
                </li>
              </ul>
            </form>
          ) : step === "verify" ? (
            <form className={styles.form} onSubmit={finish} noValidate>
              <div className={local.challenge}>
                <p className={local.challengeLabel}>
                  <Mail size={14} aria-hidden="true" /> Verification code
                </p>
                <output className={local.challengeCode} aria-label="Verification code">
                  {challenge}
                </output>
                <p className={local.challengeNote}>
                  This offline build has no mail server, so the code appears here instead of your
                  inbox. A hosted deployment sends the same code by email.
                </p>
              </div>

              <TextField
                label="Six-digit code"
                className={`${styles.fieldInput} ${local.codeField}`}
                name="verification-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={codeEntry}
                error={codeError}
                onChange={(event) => {
                  setCodeEntry(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setCodeError("");
                }}
              />

              {errors.form ? (
                <p className={styles.error} role="alert">
                  {errors.form}
                </p>
              ) : null}

              <Button type="submit" size="large" className={styles.primary} disabled={busy}>
                {busy ? "Creating your account…" : "Verify and create account"}
              </Button>

              <div className={local.verifyActions}>
                <button
                  type="button"
                  className={local.textButton}
                  onClick={() => {
                    setChallenge(newCode());
                    setCodeEntry("");
                    setCodeError("");
                  }}
                >
                  <KeyRound size={13} aria-hidden="true" /> Send a new code
                </button>
                <button
                  type="button"
                  className={local.textButton}
                  onClick={() => {
                    setStep("details");
                    setCodeEntry("");
                    setCodeError("");
                  }}
                >
                  Change details
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.form}>
              <div className={styles.localNote}>
                <Mail size={15} strokeWidth={1.9} aria-hidden="true" />
                <div>
                  <p className={styles.localTitle}>Confirm {email.trim().toLowerCase()}</p>
                  <p className={styles.localBody}>
                    The link opens this app and finishes creating your account. Check spam if it
                    does not arrive within a minute.
                  </p>
                </div>
              </div>

              {notice ? (
                <p className={styles.subtitle} role="status">
                  {notice}
                </p>
              ) : null}

              {errors.form ? (
                <p className={styles.error} role="alert">
                  {errors.form}
                </p>
              ) : null}

              <Button
                variant="secondary"
                size="large"
                className={styles.demo}
                onClick={() => void resendVerification()}
                disabled={resendBusy}
              >
                {resendBusy ? "Sending…" : "Resend the email"}
              </Button>

              <div className={local.verifyActions}>
                <button
                  type="button"
                  className={local.textButton}
                  onClick={() => {
                    setStep("details");
                    setNotice("");
                  }}
                >
                  Use a different email
                </button>
              </div>
            </div>
          )}

          <p className={styles.swap}>
            Already have an account? <Link to="/sign-in">Sign in</Link>
          </p>

          <div className={styles.localNote}>
            <LockKeyhole size={15} strokeWidth={1.9} aria-hidden="true" />
            <div>
              <p className={styles.localTitle}>
                {hostedAuthConfigured
                  ? "Email accounts, local workspace."
                  : "Nothing leaves this device."}
              </p>
              <p className={styles.localBody}>
                {hostedAuthConfigured
                  ? "Supabase handles the password and confirmation email. Workspace records stay in this device's database, and a coordinator can still reset a local password."
                  : "Accounts live in the same local database as the workspace. A coordinator can reset any password from Settings → Accounts."}
              </p>
            </div>
          </div>

          <p className={styles.legal}>
            By creating an account you agree to the demo workspace terms.
          </p>
        </div>
      </section>
    </main>
  );
}

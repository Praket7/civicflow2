import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, TextField } from "../../components/ui";
import { hostedAuthConfigured, requestHostedPasswordReset } from "../../lib/auth/hosted";
import { AuthPortrait } from "./AuthPortrait";
import styles from "./auth.module.css";
import { messageOf } from "../../lib/errors";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = email.trim();
    if (!EMAIL_PATTERN.test(clean)) {
      setError("Use an email address like name@example.org.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await requestHostedPasswordReset(clean);
      setSent(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <Link className={styles.back} to="/sign-in">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to sign in
      </Link>

      <section className={styles.card} aria-labelledby="forgot-title">
        <AuthPortrait />

        <div className={styles.formPanel}>
          <div className={styles.formHead}>
            <h1 className={styles.title} id="forgot-title">
              Reset your password
            </h1>
            <p className={styles.subtitle}>
              {hostedAuthConfigured
                ? "We email a link that lets you choose a new password."
                : "This build has no mail server, so a coordinator resets passwords."}
            </p>
          </div>

          {!hostedAuthConfigured ? (
            <>
              <div className={styles.localNote}>
                <Mail size={15} strokeWidth={1.9} aria-hidden="true" />
                <div>
                  <p className={styles.localTitle}>Ask a coordinator</p>
                  <p className={styles.localBody}>
                    Accounts live in this device&rsquo;s database. A coordinator opens Settings
                    &rarr; Accounts, picks your name, and sets a new password while you wait.
                  </p>
                </div>
              </div>
              <p className={styles.swap}>
                <Link to="/sign-in">Return to sign in</Link>
              </p>
            </>
          ) : sent ? (
            <>
              <div className={styles.localNote}>
                <Check size={15} strokeWidth={2.4} aria-hidden="true" />
                <div>
                  <p className={styles.localTitle}>Check your inbox</p>
                  <p className={styles.localBody}>
                    If an account uses {email.trim().toLowerCase()}, a reset link is on its way.
                    Open it on this device.
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="large"
                className={styles.demo}
                onClick={() => setSent(false)}
              >
                Send another link
              </Button>
            </>
          ) : (
            <form className={styles.form} onSubmit={submit} noValidate>
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
                  error={error}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError("");
                  }}
                />
              </div>

              <Button type="submit" size="large" className={styles.primary} disabled={busy}>
                {busy ? "Sending the link…" : "Email me a reset link"}
              </Button>
            </form>
          )}

          <p className={styles.swap}>
            Remembered it? <Link to="/sign-in">Sign in</Link>
          </p>

          <p className={styles.legal}>
            Links expire after one hour. Opening a link signs you out of the old password.
          </p>
        </div>
      </section>
    </main>
  );
}

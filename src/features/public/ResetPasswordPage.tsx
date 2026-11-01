import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Check, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, TextField } from "../../components/ui";
import {
  currentHostedSession,
  exchangeHostedCode,
  hostedAuthConfigured,
  hostedCodeInLocation,
  hostedTokensInHash,
  setHostedSession,
  updateHostedPassword,
} from "../../lib/auth/hosted";
import { AuthPortrait } from "./AuthPortrait";
import styles from "./auth.module.css";
import { messageOf } from "../../lib/errors";

type Stage = "checking" | "ready" | "missing" | "saved";

export function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>(() => (hostedAuthConfigured ? "checking" : "missing"));
  const [message, setMessage] = useState(() =>
    hostedAuthConfigured
      ? ""
      : "This build uses local accounts. A coordinator can reset the password.",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!hostedAuthConfigured) return;
    void (async () => {
      try {
        const code = hostedCodeInLocation(window.location.search);
        const tokens = hostedTokensInHash(window.location.hash);
        if (tokens.accessToken && tokens.refreshToken) {
          await setHostedSession(tokens.accessToken, tokens.refreshToken);
        } else if (code) {
          await exchangeHostedCode(code);
        } else if (!(await currentHostedSession())) {
          setStage("missing");
          setMessage("Open the reset link from your email to choose a new password.");
          return;
        }
        window.history.replaceState({}, "", "/reset-password");
        setStage("ready");
      } catch (caught) {
        setStage("missing");
        setMessage(messageOf(caught, "That link could not be verified. Request a new one."));
      }
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters for the password.");
      return;
    }
    if (confirm !== password) {
      setConfirmError("The two passwords do not match.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await updateHostedPassword(password);
      setStage("saved");
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

      <section className={styles.card} aria-labelledby="reset-title">
        <AuthPortrait />

        <div className={styles.formPanel}>
          <div className={styles.formHead}>
            <h1 className={styles.title} id="reset-title">
              {stage === "saved" ? "Password updated" : "Choose a new password"}
            </h1>
            <p className={styles.subtitle}>
              {stage === "saved"
                ? "The next sign-in uses the password you just set."
                : stage === "checking"
                  ? "Checking your reset link."
                  : stage === "missing"
                    ? message
                    : "Pick something you have not used for this account."}
            </p>
          </div>

          {stage === "saved" ? (
            <>
              <div className={styles.localNote}>
                <Check size={15} strokeWidth={2.4} aria-hidden="true" />
                <div>
                  <p className={styles.localTitle}>You can sign in again</p>
                  <p className={styles.localBody}>
                    The reset link has been used. If you still have the app open elsewhere, sign out
                    and back in with the new password.
                  </p>
                </div>
              </div>
              <p className={styles.swap}>
                <Link to="/sign-in">Sign in with the new password</Link>
              </p>
            </>
          ) : stage === "ready" ? (
            <form className={styles.form} onSubmit={submit} noValidate>
              <div className={styles.fields}>
                <TextField
                  label="New password"
                  className={styles.fieldInput}
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  error={error}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError("");
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
                  error={confirmError}
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    if (confirmError) setConfirmError("");
                  }}
                />
              </div>

              <Button type="submit" size="large" className={styles.primary} disabled={busy}>
                {busy ? "Saving…" : "Save the new password"}
              </Button>
            </form>
          ) : (
            <div className={styles.localNote}>
              <KeyRound size={15} strokeWidth={1.9} aria-hidden="true" />
              <div>
                <p className={styles.localTitle}>
                  {stage === "checking" ? "One moment" : "Ask for a fresh link"}
                </p>
                <p className={styles.localBody}>
                  Reset links are single-use and expire after an hour.
                </p>
              </div>
            </div>
          )}

          <p className={styles.swap}>
            Need a new link? <Link to="/forgot-password">Start over</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

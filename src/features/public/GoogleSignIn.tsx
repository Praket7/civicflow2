import { useState } from "react";
import { Button } from "../../components/ui";
import { hostedRedirect, startHostedOAuth } from "../../lib/auth/hosted";
import { isTauri, openExternal } from "../../lib/platform";
import styles from "./auth.module.css";
import { messageOf } from "../../lib/errors";

interface GoogleSignInProps {
  label: string;
  disabled?: boolean;
  onError(message: string): void;
}

function GoogleMark() {
  return (
    <svg className={styles.googleMark} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Google blocks its consent screen inside a webview, so the desktop build uses
 * the system browser and resumes from the `civicflow://` answer.
 */
export function GoogleSignIn({ label, disabled, onError }: GoogleSignInProps) {
  const [busy, setBusy] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  // Only the bundled app can receive the `civicflow://` answer.
  const needsBundledApp = isTauri() && import.meta.env.DEV;

  async function start() {
    setBusy(true);
    setHandedOff(false);
    try {
      const { url } = await startHostedOAuth(hostedRedirect("callback"));
      await openExternal(url);
      if (isTauri()) setHandedOff(true);
    } catch (caught) {
      onError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="large"
        className={`${styles.demo} ${styles.googleButton}`}
        onClick={() => void start()}
        disabled={disabled || busy || needsBundledApp}
      >
        <GoogleMark />
        {busy ? "Opening Google…" : label}
      </Button>
      {needsBundledApp ? (
        <p className={styles.oauthNote} role="status">
          Google sign-in finishes in the installed CivicFlow app. This development build cannot
          receive that hand-off — use an email account here, or sign in from the packaged app.
        </p>
      ) : handedOff ? (
        <p className={styles.oauthNote} role="status">
          Finish in your browser. CivicFlow reopens by itself when you are done.
        </p>
      ) : null}
    </>
  );
}

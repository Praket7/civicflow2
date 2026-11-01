import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { accountHome, useAuth } from "../../lib/auth/session";
import { t } from "../../lib/i18n";

import {
  exchangeHostedCode,
  finishHostedHandoff,
  hostedAuthConfigured,
  hostedHandoffPending,
  identityFromUser,
  keepHostedAnswer,
  parseHostedLink,
  readHostedProblem,
  rememberHostedAnswer,
  rememberHostedLinkAnswer,
  rememberedHostedAnswer,
  setHostedSession,
  takeStoredHostedLink,
  type HostedAnswer,
} from "../../lib/auth/hosted";
import { isTauri } from "../../lib/platform";
import { AuthPortrait } from "./AuthPortrait";
import styles from "./auth.module.css";
import { messageOf } from "../../lib/errors";

type Failure = {
  message: string;
  /**
   * Which explanation fits. The sentences stay in the JSX below so every
   * locale keeps a translated version of them; only the provider's own message
   * is dynamic.
   */
  kind: "canceled" | "unconfigured" | "link" | "retry";
};

/** How long a desktop window waits for the browser it handed off to. */
const WAIT_STEP_MS = 1500;
const WAIT_LIMIT_MS = 120_000;

function providerFailure(): Failure | null {
  const problem = readHostedProblem(window.location.hash, window.location.search);
  if (!problem) return null;
  if (problem.kind === "canceled") {
    return {
      message: t("Google sign-in was canceled. Nothing changed on this device."),
      kind: "canceled",
    };
  }
  // An OAuth request that sat too long is not an email link that expired. The
  // provider's own sentence says which one happened; the sidebar only has to
  // point at the next step.
  return { message: problem.message, kind: problem.kind === "expired" ? "link" : "retry" };
}

/** Only the answers that are already decided on this page load. */
function settledFailure(): Failure | null {
  if (!hostedAuthConfigured) {
    return { message: t("Hosted sign-in is not configured in this build."), kind: "unconfigured" };
  }
  return providerFailure();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * In trust order: the address bar, a kept answer, then the native record of the
 * return link.
 */
async function answerFromThisPage(): Promise<HostedAnswer | null> {
  const fromAddress = rememberHostedAnswer(window.location.search, window.location.hash);
  if (fromAddress) return fromAddress;
  const kept = rememberedHostedAnswer();
  if (kept) return kept;
  const stored = await takeStoredHostedLink();
  const link = stored ? parseHostedLink(stored) : null;
  if (!link) return null;
  if (link.error) throw new Error(link.error);
  return rememberHostedLinkAnswer(link);
}

/** Waits for the browser hand-off to land while this window stays open. */
async function waitForAnswer(isLive: () => boolean): Promise<HostedAnswer | null> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline && isLive()) {
    await sleep(WAIT_STEP_MS);
    const answer = await answerFromThisPage();
    if (answer) return answer;
  }
  return null;
}

/** The desktop keeps its route in the fragment, the browser build in the path. */
function stripAnswerFromAddress(): void {
  if (isTauri()) {
    window.location.hash = "#/auth/callback";
    return;
  }
  try {
    window.history.replaceState({}, "", "/auth/callback");
  } catch {
    // A webview that refuses the rewrite can still finish the sign-in.
  }
}

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { adoptHostedIdentity } = useAuth();
  const [failure, setFailure] = useState<Failure | null>(settledFailure);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!hostedAuthConfigured || providerFailure()) return;
    let live = true;
    void (async () => {
      try {
        let answer = await answerFromThisPage();
        if (!answer) {
          // The return this device asked for may still be in the browser.
          if (!isTauri() || !(await hostedHandoffPending("callback"))) {
            throw new Error(
              t("This link was not requested on this device. Start again from the sign-in screen."),
            );
          }
          answer = await waitForAnswer(() => live);
          if (!answer) {
            throw new Error(
              t("This link was not requested on this device. Start again from the sign-in screen."),
            );
          }
        }
        if (!live) return;
        // Kept until the exchange finishes, so a reload retries instead of
        // landing on a bare route.
        keepHostedAnswer(answer);
        if (isTauri() && !(await hostedHandoffPending("callback"))) {
          throw new Error(
            t("This link was not requested on this device. Start again from the sign-in screen."),
          );
        }
        const hostedSession =
          answer.accessToken && answer.refreshToken
            ? await setHostedSession(answer.accessToken, answer.refreshToken)
            : await exchangeHostedCode(answer.code as string);
        const identity = identityFromUser(hostedSession.user);
        if (!identity) throw new Error(t("That account has no email address."));
        // Adopt first: only the exchange makes the memberships readable.
        const session = await adoptHostedIdentity(identity, true);
        stripAnswerFromAddress();
        await finishHostedHandoff();
        if (!live) return;
        setDone(true);
        // A membership lands on its own home; anything else gains one first.
        navigate(accountHome(session.user), { replace: true });
      } catch (caught) {
        if (!live) return;
        setFailure({
          message: messageOf(caught),
          kind: "retry",
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [adoptHostedIdentity, navigate]);

  return (
    <main className={styles.screen}>
      <Link className={styles.back} to="/sign-in">
        <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
      </Link>

      <section className={styles.card} aria-labelledby="callback-title">
        <AuthPortrait />

        <div className={styles.formPanel}>
          <div className={styles.formHead}>
            <h1 className={styles.title} id="callback-title">
              {failure ? "That sign-in did not finish" : done ? "You are in" : "Finishing sign-in"}
            </h1>
            <p className={styles.subtitle}>
              {failure
                ? failure.message
                : done
                  ? "Opening your workspace."
                  : "Confirming the account and signing this device in."}
            </p>
          </div>

          <div className={styles.localNote}>
            {failure ? (
              failure.kind === "canceled" ? (
                <X size={15} strokeWidth={1.9} aria-hidden="true" />
              ) : (
                <AlertCircle size={15} strokeWidth={1.9} aria-hidden="true" />
              )
            ) : (
              <Check size={15} strokeWidth={2.4} aria-hidden="true" />
            )}
            <div>
              <p className={styles.localTitle}>
                {failure
                  ? failure.kind === "canceled"
                    ? "You closed the browser"
                    : failure.kind === "unconfigured"
                      ? "Not available here"
                      : failure.kind === "link"
                        ? "Expired or already used"
                        : "Start over"
                  : "One-time link"}
              </p>
              <p className={styles.localBody}>
                {failure
                  ? failure.kind === "canceled"
                    ? "Start again whenever you are ready. Pick the same account on the sign-in screen."
                    : failure.kind === "unconfigured"
                      ? "This build runs on local accounts only. Sign in with an email and password."
                      : failure.kind === "link"
                        ? "Each link works once and expires after an hour. Request a new email from the sign-in screen."
                        : "Start again whenever you are ready. Pick the same account on the sign-in screen."
                  : "Keep this window open. The app finishes by itself."}
              </p>
            </div>
          </div>

          <p className={styles.swap}>
            <Link to="/sign-in">Back to sign in</Link>
            {" · "}
            <Link to="/forgot-password">Send a new link</Link>
          </p>
        </div>
      </section>
    </main>
  );
}

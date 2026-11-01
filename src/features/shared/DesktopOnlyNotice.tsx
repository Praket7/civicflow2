import type { ReactNode } from "react";
import { ButtonLink } from "../../components/ui";
import styles from "./shared.module.css";

/**
 * Five shared screens change the organization, and the browser build has no
 * replica to write through. Each one used to repeat this panel with slightly
 * different wording; the explanation stays here so they cannot drift.
 */
export function DesktopOnlyNotice({
  children,
  hosted = true,
}: {
  children: ReactNode;
  /** Conflicts and volunteer records have no hosted equivalent to offer. */
  hosted?: boolean;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelBody}>
        <h2 className={styles.panelTitle}>This screen lives in the desktop app</h2>
        <p className={styles.panelCopy}>{children}</p>
        {hosted ? (
          <div className={styles.panelAction}>
            <ButtonLink to="/shared" variant="secondary">
              Open hosted workspace
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </section>
  );
}

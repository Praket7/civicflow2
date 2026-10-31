import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, DatabaseBackup, RefreshCw, Trash2 } from "lucide-react";
import { Button, ButtonLink, Page, PageHeader } from "../../components/ui";
import { isTauri } from "../../lib/platform";
import { startDesktopSync } from "../../lib/sync/desktop";
import { useSharedReplica } from "../../lib/sync/sharedReplica";
import {
  listSharedConflicts,
  resolveSharedConflict,
  type SharedConflict,
} from "../../lib/sync/writes";
import { SharedNav } from "./SharedNav";
import styles from "./shared.module.css";

function formatJson(value: Record<string, unknown> | null): string {
  if (!value) return "No local value was kept.";
  return JSON.stringify(value, null, 2);
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SharedConflictsPage() {
  const { sync, reload } = useSharedReplica();
  const [conflicts, setConflicts] = useState<SharedConflict[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isTauri() || !sync.organizationId) {
      setLoading(false);
      return;
    }
    try {
      setConflicts(await listSharedConflicts());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [sync.organizationId]);

  useEffect(() => {
    let current = true;
    void (async () => {
      await Promise.resolve();
      if (current) await load();
    })();
    return () => {
      current = false;
    };
  }, [load, sync.cursor, sync.conflicts]);

  async function resolve(conflict: SharedConflict, resolution: "resolved" | "dismissed") {
    setBusy(conflict.id);
    setNotice("");
    try {
      await resolveSharedConflict(conflict.id, resolution);
      await load();
      setNotice(
        resolution === "resolved"
          ? "Conflict closed. The server's value is the one in this replica."
          : "Conflict dismissed without changing the organization.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  async function rebuild() {
    setBusy("rebuild");
    setNotice("");
    try {
      await startDesktopSync(true);
      await load();
      await reload();
      setNotice("Replica rebuilt from the organization's current state.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy("");
    }
  }

  const open = conflicts.filter((conflict) => conflict.status === "open");
  const closed = conflicts.filter((conflict) => conflict.status !== "open");

  return (
    <Page width="wide">
      <div className={styles.shell}>
        <PageHeader
          eyebrow="Shared coordinator"
          title="Sync issues"
          description="Commands the server refused, with the value this device held and the value the organization now has. Nothing is merged silently."
          backTo="/shared"
          backLabel="Hosted workspace"
          actions={
            <div className={styles.actions}>
              <Button
                variant="secondary"
                icon={<RefreshCw aria-hidden size={14} />}
                disabled={busy !== "" || !isTauri()}
                onClick={() => void load()}
              >
                Reload
              </Button>
              <Button
                variant="ghost"
                icon={<DatabaseBackup aria-hidden size={14} />}
                disabled={busy !== "" || !isTauri()}
                onClick={() => void rebuild()}
              >
                {busy === "rebuild" ? "Rebuilding…" : "Rebuild from server"}
              </Button>
            </div>
          }
        />

        <SharedNav conflicts={sync.conflicts} />

        {!isTauri() ? (
          <section className={styles.panel}>
            <div className={styles.panelBody}>
              <h2 className={styles.panelTitle}>This screen lives in the desktop app</h2>
              <p className={styles.panelCopy}>
                Conflicts belong to this computer&apos;s outbox. The hosted workspace shows its own
                failures.
              </p>
              <div style={{ marginTop: 12 }}>
                <ButtonLink to="/shared" variant="secondary">
                  Open hosted workspace
                </ButtonLink>
              </div>
            </div>
          </section>
        ) : (
          <>
            {error ? (
              <p role="alert" className={`${styles.notice} ${styles.noticeError}`}>
                {error}
              </p>
            ) : null}
            {notice ? (
              <p
                role="status"
                aria-live="polite"
                className={`${styles.notice} ${styles.noticeGood}`}
              >
                {notice}
              </p>
            ) : null}

            {loading ? <p className={styles.notice}>Reading the conflict log…</p> : null}

            {!loading && conflicts.length === 0 ? (
              <section className={styles.panel}>
                <div className={styles.panelBody}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <Check aria-hidden size={18} />
                    <h2 className={styles.panelTitle}>No sync issues</h2>
                  </div>
                  <p className={styles.panelCopy} style={{ marginTop: 6 }}>
                    Every command this computer sent was accepted. If the organization changes
                    something while this device is offline, the refusal will appear here.
                  </p>
                </div>
              </section>
            ) : null}

            {open.length > 0 ? (
              <section className={styles.panel} aria-labelledby="open-conflicts">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="open-conflicts" className={styles.panelTitle}>
                      Open ({open.length})
                    </h2>
                    <p className={styles.panelCopy}>
                      Closing an issue does not edit the organization. If the local intent still
                      matters, rebuild and enter it again against the current values.
                    </p>
                  </div>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.conflictList}>
                    {open.map((conflict) => (
                      <article key={conflict.id} className={styles.conflict}>
                        <div className={styles.conflictHead}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <AlertTriangle aria-hidden size={15} />
                            <h3 className={styles.conflictTitle}>
                              {conflict.code.replaceAll("_", " ")}
                            </h3>
                          </div>
                          <div className={styles.actions}>
                            <span className={`${styles.pill} ${styles.pillOpen}`}>
                              {conflict.classification}
                            </span>
                            <span className={styles.pill}>{conflict.command ?? "command"}</span>
                          </div>
                        </div>
                        <p className={styles.conflictCopy}>{conflict.message}</p>
                        <div className={styles.compare}>
                          <div className={styles.compareBox}>
                            <p className={styles.compareLabel}>This device sent</p>
                            <pre className={`${styles.mono} ${styles.compareValue}`}>
                              {formatJson(conflict.localPayload)}
                            </pre>
                          </div>
                          <div className={styles.compareBox}>
                            <p className={styles.compareLabel}>Organization now</p>
                            <pre className={`${styles.mono} ${styles.compareValue}`}>
                              {formatJson(conflict.authoritative)}
                            </pre>
                          </div>
                        </div>
                        <div className={styles.conflictHead}>
                          <span className={styles.muted} style={{ fontSize: 11.5 }}>
                            {formatWhen(conflict.createdAt)}
                            {conflict.operationId ? ` · ${conflict.operationId.slice(0, 8)}` : ""}
                          </span>
                          <div className={styles.actions}>
                            <Button
                              variant="secondary"
                              size="small"
                              icon={<Check aria-hidden size={13} />}
                              disabled={busy !== ""}
                              onClick={() => void resolve(conflict, "resolved")}
                            >
                              Keep server
                            </Button>
                            <Button
                              variant="ghost"
                              size="small"
                              icon={<Trash2 aria-hidden size={13} />}
                              disabled={busy !== ""}
                              onClick={() => void resolve(conflict, "dismissed")}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {closed.length > 0 ? (
              <section className={styles.panel} aria-labelledby="closed-conflicts">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="closed-conflicts" className={styles.panelTitle}>
                      Closed ({closed.length})
                    </h2>
                  </div>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">When</th>
                          <th scope="col">Code</th>
                          <th scope="col">Command</th>
                          <th scope="col">Status</th>
                          <th scope="col">Summary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closed.map((conflict) => (
                          <tr key={conflict.id}>
                            <td className={styles.muted}>{formatWhen(conflict.createdAt)}</td>
                            <td>{conflict.code}</td>
                            <td className={styles.muted}>{conflict.command ?? "—"}</td>
                            <td>
                              <span
                                className={[
                                  styles.pill,
                                  conflict.status === "resolved" ? styles.pillGood : "",
                                ].join(" ")}
                              >
                                {conflict.status}
                              </span>
                            </td>
                            <td className={styles.muted}>{conflict.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>
              {sync.online
                ? "Connected. New refusals appear here after the next upload."
                : "Offline. Queued commands will be sent when the organization is reachable."}
            </p>
          </>
        )}
      </div>
    </Page>
  );
}

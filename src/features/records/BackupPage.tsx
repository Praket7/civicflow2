import { useState } from "react";
import { CheckCircle2, Database, HardDrive, History, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Page,
  PageHeader,
  SectionHeader,
  StatCard,
  TextField,
} from "../../components/ui";
import { t } from "../../lib/i18n";
import { isTauri } from "../../lib/platform";
import { useWorkspace } from "../../lib/workspace/session";
import { formatDateTime, formatTime } from "../../lib/workspace/selectors";
import type { BackupSnapshot } from "../../types/domain";
import styles from "./Records.module.css";
import { messageOf } from "../../lib/errors";

function formatBytes(bytes: number): string {
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function BackupPage() {
  const { backups, actions, installationSteward } = useWorkspace();
  const native = isTauri();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);

  // UI only; the backup commands check the same rule themselves.
  if (installationSteward !== true) {
    return (
      <Page>
        <PageHeader
          eyebrow="Organize"
          title="Installation backups"
          description="Installation backups contain every CivicFlow workspace stored on this device. Only the installation steward can create, restore, or manage them."
        />
      </Page>
    );
  }

  const latest = backups[0];
  const selected = backups.find((snapshot) => snapshot.id === selectedId) ?? latest;
  const armed = backups.find((snapshot) => snapshot.id === pendingRestore);

  async function createSnapshot() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await actions.createBackup("Manual snapshot");
      const created = next[0];
      if (created) {
        setSelectedId(created.id);
        setMessage(`Snapshot created: ${created.rows} rows, ${formatBytes(created.bytes)}.`);
      }
    } catch (caught) {
      setError(`Snapshot failed: ${messageOf(caught)}`);
    } finally {
      setBusy(false);
    }
  }

  async function restore(snapshot: BackupSnapshot) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await actions.restoreBackup(snapshot.id);
      setPendingRestore(null);
      setSelectedId(snapshot.id);
      setMessage(
        `Restored ${snapshot.rows} rows from the ${formatDateTime(
          snapshot.createdAt,
        )} snapshot. A safety snapshot of the pre-restore state was kept.`,
      );
    } catch (caught) {
      setPendingRestore(null);
      setError(`Restore failed: ${messageOf(caught)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveEncrypted() {
    setError("");
    setMessage("");
    if (passphrase.trim().length < 12) {
      setError(
        "Use a passphrase of at least 12 characters. It is the only thing protecting the copy.",
      );
      return;
    }
    setArchiveBusy(true);
    try {
      const receipt = await actions.exportEncryptedBackup(passphrase);
      if (receipt) {
        setMessage(
          `Encrypted copy written (${formatBytes(receipt.bytes)}). Without the passphrase the file cannot be opened, so keep it somewhere other than the copy.`,
        );
      }
    } catch (caught) {
      setError(`Encrypted copy failed: ${messageOf(caught)}`);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function openEncrypted() {
    setError("");
    setMessage("");
    if (passphrase.trim().length < 12) {
      setError("Enter the passphrase the archive was written with.");
      return;
    }
    setArchiveBusy(true);
    try {
      const result = await actions.importEncryptedBackup(passphrase);
      if (result) {
        setMessage(
          "Restored from the encrypted archive. A safety snapshot of the previous state was kept.",
        );
      }
    } catch (caught) {
      setError(`Restore from archive failed: ${messageOf(caught)}`);
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Organize"
        title="Installation backups"
        description="Installation backups contain every CivicFlow workspace stored on this device. Only the installation steward can create, restore, or manage them."
        actions={
          <Button
            variant="primary"
            icon={<Database size={14} />}
            onClick={createSnapshot}
            disabled={busy}
          >
            Create snapshot
          </Button>
        }
      />

      <div className={styles.protectBanner}>
        <span className={styles.protectIcon} aria-hidden="true">
          <ShieldCheck size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <div className={styles.protectTitle}>Snapshots stay on this device.</div>
          <p className={styles.protectCopy}>
            {native
              ? "Each snapshot is a transactionally consistent copy of the local SQLite database, written with SQLite's backup API."
              : "Each snapshot is a validated copy of this browser workspace, stored in local storage for the preview."}
          </p>
        </div>
        <Badge tone="green" dot>
          {backups.length} {t("available")}
        </Badge>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <StatCard
          icon={History}
          value={latest ? formatTime(latest.createdAt) : "—"}
          label="Latest snapshot"
          meta={latest ? `${formatDateTime(latest.createdAt)} · ${latest.kind}` : "No snapshot yet"}
          tone="green"
        />
        <StatCard
          icon={Database}
          value={backups.length}
          label="Available snapshots"
          meta="stored on this device"
          tone="cobalt"
        />
        <StatCard
          icon={HardDrive}
          value={latest ? formatBytes(latest.bytes) : "—"}
          label="Latest size"
          meta={native ? "SQLite copy" : "JSON copy"}
          tone="violet"
        />
        <StatCard
          icon={ShieldCheck}
          value={selected?.rows ?? 0}
          label="Rows in selected"
          meta="across stored tables"
          tone="amber"
        />
      </div>

      <p
        role={error ? "alert" : "status"}
        aria-live="polite"
        style={{ minHeight: 18, fontSize: 13, color: error ? "#b32a2a" : "#0b6b40" }}
      >
        {error || message}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: 14,
          alignItems: "start",
        }}
      >
        <Card>
          <SectionHeader
            title="Snapshot history"
            subtitle="Only validated snapshots are listed; damaged files are refused and older snapshots are pruned automatically"
          />
          {backups.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No snapshots yet. Create one to protect every workspace on this device.
            </p>
          ) : (
            <div className={styles.snapshotList}>
              {backups.map((snapshot) => {
                const isSelected = selected?.id === snapshot.id;
                const isArmed = pendingRestore === snapshot.id;
                return (
                  <div className={styles.snapshot} key={snapshot.id}>
                    <div className={styles.snapshotDate} aria-hidden="true">
                      <span className={styles.snapshotDay}>{snapshot.createdAt.slice(8, 10)}</span>
                      <span className={styles.snapshotMonth}>
                        {new Date(snapshot.createdAt).toLocaleString("en-US", { month: "short" })}
                      </span>
                    </div>
                    <div className={styles.snapshotCopy}>
                      <div className={styles.snapshotTitle}>
                        {snapshot.kind === "automatic" ? "Automatic snapshot" : "Manual snapshot"}{" "}
                        {isSelected ? <Badge tone="cobalt">Previewing</Badge> : null}
                      </div>
                      <div className={styles.snapshotMeta}>
                        {formatDateTime(snapshot.createdAt)} · {snapshot.rows} rows ·{" "}
                        {formatBytes(snapshot.bytes)} · {snapshot.note}
                      </div>
                    </div>
                    <div className={styles.snapshotActions}>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() => {
                          setSelectedId(snapshot.id);
                          setPendingRestore(null);
                        }}
                      >
                        Preview
                      </Button>
                      <Button
                        size="small"
                        variant={isArmed ? "danger" : "secondary"}
                        disabled={busy}
                        onClick={() => {
                          setPendingRestore(null);
                          setError("");
                          setMessage("");
                          if (isArmed) {
                            void restore(snapshot);
                          } else {
                            setPendingRestore(snapshot.id);
                            setSelectedId(snapshot.id);
                          }
                        }}
                      >
                        {isArmed ? "Confirm restore" : "Restore"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <aside style={{ position: "sticky", top: 8 }}>
          <Card padding="compact">
            <SectionHeader
              title="Snapshot preview"
              subtitle={selected ? formatDateTime(selected.createdAt) : "None selected"}
            />
            {selected ? (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: 11,
                    borderRadius: 10,
                    background: "var(--surface-canvas)",
                    marginBottom: 10,
                  }}
                >
                  <CheckCircle2
                    size={16}
                    style={{ color: "var(--color-green)" }}
                    aria-hidden="true"
                  />
                  <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                    Validated before restore
                    <div style={{ color: "var(--text-muted)" }}>
                      {native
                        ? "application id, schema, integrity, foreign keys"
                        : "snapshot shape and required fields checked"}
                    </div>
                  </div>
                </div>
                {(
                  [
                    ["Volunteers", selected.counts.volunteers],
                    ["Programs", selected.counts.programs],
                    ["Shifts", selected.counts.shifts],
                    ["Hour entries", selected.counts.hours],
                    ["Notifications", selected.counts.notifications],
                    ["Audit events", selected.counts.audit],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid rgba(7,27,50,0.07)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>{label}</span>
                    <span style={{ fontWeight: 570, fontVariantNumeric: "tabular-nums" }}>
                      {value}
                    </span>
                  </div>
                ))}
                <p
                  style={{
                    marginTop: 10,
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    color: "var(--text-muted)",
                  }}
                >
                  Restoring replaces current records with this snapshot. A safety snapshot is
                  written first, and the restore is recorded in the audit log with your name.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Create a snapshot to inspect what it contains.
              </p>
            )}
            {armed ? (
              <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--tone-red-ink)" }}>
                Restore is armed for the {formatDateTime(armed.createdAt)} snapshot. Confirm in the
                list to replace live records, or choose another snapshot to cancel.
              </p>
            ) : null}
          </Card>

          <Card padding="compact" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
              <LockKeyhole size={14} aria-hidden="true" />
              Encrypted copy
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: "var(--text-muted)" }}>
              A sealed archive is the only backup safe to carry off this device. It is encrypted
              with a passphrase using Argon2id and XChaCha20-Poly1305, so it opens only on a machine
              where someone types that phrase.
            </p>
            {native ? (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <TextField
                  label="Passphrase"
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button variant="secondary" disabled={archiveBusy} onClick={saveEncrypted}>
                    Save encrypted copy
                  </Button>
                  <Button variant="ghost" disabled={archiveBusy} onClick={openEncrypted}>
                    Restore from archive
                  </Button>
                </div>
              </div>
            ) : (
              <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
                The desktop app writes and opens these archives.
              </p>
            )}
          </Card>

          <Card padding="compact" surface="dark" style={{ marginTop: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 13,
                color: "var(--color-lime)",
              }}
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Restores are audited
            </div>
            <p
              style={{
                marginTop: 6,
                fontSize: 13,
                lineHeight: 1.55,
                color: "rgba(255,255,255,0.7)",
              }}
            >
              Every restore adds an event to the audit log naming the snapshot and the safety copy.
              Local snapshots protect against mistakes, not hardware loss.
            </p>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

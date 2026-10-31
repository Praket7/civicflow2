import { useEffect, useState } from "react";
import {
  BellRing,
  Database,
  HardDrive,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "../lib/sync/auth";
import { useCloud } from "../lib/sync/provider";
import { Button, Card, PageTitle, Pill, relativeTime } from "./ui";
import styles from "./pwa.module.css";

interface DeviceRow {
  replicaId: string;
  label: string;
  platform: string;
  lastSeenAt: string | null;
  lastSuccessfulSyncAt: string | null;
  pendingOperations: number;
  oldestPendingAt: string | null;
  lastError: string | null;
}

interface HealthSnapshot {
  status: string;
  revision: number;
  devices: DeviceRow[];
  lastBackup: {
    startedAt: string;
    finishedAt: string | null;
    status: string;
    verifiedAt: string | null;
    ageHours: number | null;
  } | null;
  lastJob: { job: string; startedAt: string; status: string; detail: string } | null;
  counts: {
    volunteers: number;
    opportunities: number;
    shifts: number;
    registrations: number;
    openHourEntries: number;
    devices: number;
    pushSubscriptions: number;
  };
  serverTime: string;
}

interface DeliveryRow {
  id: string;
  channel: string;
  status: string;
  attempts: number;
  scheduledAt: string;
  sentAt: string | null;
  lastError: string | null;
  title: string;
}

interface DeliveryHealth {
  status: string;
  byStatus: Record<string, number>;
  recent: DeliveryRow[];
}

function describeJob(detail: string): string {
  try {
    const summary = JSON.parse(detail) as Record<string, unknown>;
    const parts = [
      ["generated", summary.generated],
      ["claimed", summary.claimed],
      ["sent", summary.sent],
      ["failed", summary.failed],
      ["skipped", summary.skipped],
    ]
      .filter(([, value]) => typeof value === "number")
      .map(([label, value]) => `${value} ${label}`);
    return parts.length > 0 ? parts.join(", ") : detail;
  } catch {
    return detail;
  }
}

function toneFor(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "sent" || status === "succeeded") return "good";
  if (status === "failed") return "bad";
  if (status === "sending" || status === "scheduled" || status === "deferred") return "warn";
  return "neutral";
}

export function CoordinatorApp() {
  const { workspace, workspaces, selectWorkspace, signOut } = useCloud();
  const organizationId = workspace?.organizationId ?? null;
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;

    async function load() {
      try {
        const [snapshot, delivery] = await Promise.all([
          supabase().rpc("health_snapshot", { p_organization_id: organizationId }),
          supabase().rpc("delivery_health", { p_organization_id: organizationId }),
        ]);
        if (!active) return;
        if (snapshot.error) throw new Error(snapshot.error.message);
        if (delivery.error) throw new Error(delivery.error.message);
        const snapshotData = snapshot.data as HealthSnapshot | null;
        if (snapshotData?.status !== "ok") {
          throw new Error("This account cannot read health for that organization.");
        }
        setHealth(snapshotData);
        setDeliveries((delivery.data as DeliveryHealth | null) ?? null);
        setProblem(null);
        setRefreshedAt(new Date().toISOString());
      } catch (caught) {
        if (active) setProblem(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [organizationId]);

  if (!workspace) return null;

  async function refresh() {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [snapshot, delivery] = await Promise.all([
        supabase().rpc("health_snapshot", { p_organization_id: organizationId }),
        supabase().rpc("delivery_health", { p_organization_id: organizationId }),
      ]);
      if (snapshot.error) throw new Error(snapshot.error.message);
      if (delivery.error) throw new Error(delivery.error.message);
      setHealth(snapshot.data as HealthSnapshot);
      setDeliveries((delivery.data as DeliveryHealth | null) ?? null);
      setProblem(null);
      setRefreshedAt(new Date().toISOString());
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  const backupAge = health?.lastBackup?.ageHours;
  const backupHealthy = typeof backupAge === "number" && backupAge < 36;
  const now = health ? Date.parse(health.serverTime) : 0;
  const staleDevices = (health?.devices ?? []).filter(
    (device) =>
      device.pendingOperations > 0 ||
      (device.lastSeenAt ? now - Date.parse(device.lastSeenAt) > 24 * 3600_000 : true),
  );
  const deliveryFailures = (deliveries?.recent ?? []).filter(
    (row) => row.status === "failed" || row.status === "skipped",
  );

  return (
    <main className={styles.coordinatorPage}>
      <header className={styles.coordinatorHead}>
        <div>
          <p className={styles.eyebrow}>{workspace.organization.name}</p>
          <h1 className={styles.coordinatorTitle}>Workspace health</h1>
          <p className={styles.muted}>
            {refreshedAt
              ? `Checked ${relativeTime(refreshedAt)}`
              : "Checking the shared workspace…"}
          </p>
        </div>
        <div className={styles.rowActions}>
          {workspaces.length > 1 ? (
            <select
              className={styles.input}
              aria-label="Organization"
              value={workspace.organizationId}
              onChange={(event) => void selectWorkspace(event.target.value)}
            >
              {workspaces
                .filter((entry) => entry.status === "active")
                .map((entry) => (
                  <option key={entry.organizationId} value={entry.organizationId}>
                    {entry.organization.name}
                  </option>
                ))}
            </select>
          ) : null}
          <Button variant="secondary" loading={loading} onClick={() => void refresh()}>
            <RefreshCw aria-hidden size={16} /> Refresh
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut aria-hidden size={16} /> Sign out
          </Button>
        </div>
      </header>

      {problem ? (
        <Card className={styles.conflictCard}>
          <TriangleAlert aria-hidden size={19} />
          <p className={styles.cautionBody}>{problem}</p>
        </Card>
      ) : null}

      <PageTitle
        eyebrow="Shared workspace"
        title={
          health
            ? `${health.counts.volunteers} volunteers, ${health.counts.shifts} shifts`
            : "Loading the ledger"
        }
        body="Counts and device state come from the server, not this phone. A coordinator sees the same numbers in every session."
      />

      <div className={styles.statRow}>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>
            <Database aria-hidden size={14} /> Revision
          </span>
          <strong>{health?.revision ?? "—"}</strong>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>
            <MonitorSmartphone aria-hidden size={14} /> Devices
          </span>
          <strong>{health?.counts.devices ?? "—"}</strong>
        </Card>
        <Card className={styles.stat}>
          <span className={styles.statLabel}>
            <BellRing aria-hidden size={14} /> Push devices
          </span>
          <strong>{health?.counts.pushSubscriptions ?? "—"}</strong>
        </Card>
      </div>

      <Card>
        <h2 className={styles.cardTitle}>
          <HardDrive aria-hidden size={18} /> Backup
        </h2>
        {health?.lastBackup ? (
          <>
            <p className={styles.body}>
              Last verified backup{" "}
              {health.lastBackup.finishedAt
                ? relativeTime(health.lastBackup.finishedAt)
                : "has not finished"}
              {typeof backupAge === "number" ? ` (${Math.round(backupAge)} hours ago)` : ""}.
            </p>
            <Pill tone={backupHealthy ? "good" : "bad"}>
              {backupHealthy ? "Within the 36-hour window" : "Overdue"}
            </Pill>
          </>
        ) : (
          <>
            <p className={styles.body}>No successful backup is recorded for this workspace.</p>
            <Pill tone="bad">Not proven</Pill>
          </>
        )}
        <p className={styles.fieldHint}>
          Desktop snapshots stay on the device. Reporting them here arrives with desktop sync; no
          scheduled cloud backup is configured yet.
        </p>
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Last server job</h2>
        {health?.lastJob ? (
          <>
            <p className={styles.body}>
              {health.lastJob.job.replaceAll("_", " ")} · {health.lastJob.status}
            </p>
            <p className={styles.muted}>{relativeTime(health.lastJob.startedAt)}</p>
            {health.lastJob.detail ? (
              <p className={styles.fieldHint}>{describeJob(health.lastJob.detail).slice(0, 280)}</p>
            ) : null}
          </>
        ) : (
          <p className={styles.muted}>
            The reminder dispatcher has not run yet. Schedule it before relying on reminders.
          </p>
        )}
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Devices</h2>
        {!health || health.devices.length === 0 ? (
          <p className={styles.muted}>No device has registered with this workspace yet.</p>
        ) : (
          <ul className={styles.healthList}>
            {health.devices.map((device) => (
              <li key={device.replicaId} className={styles.healthRow}>
                <div>
                  <p className={styles.prefTitle}>{device.label || "Unnamed device"}</p>
                  <p className={styles.muted}>
                    {device.platform || "Unknown platform"} · seen{" "}
                    {device.lastSeenAt ? relativeTime(device.lastSeenAt) : "never"}
                  </p>
                  {device.lastError ? <p className={styles.error}>{device.lastError}</p> : null}
                </div>
                <div className={styles.healthEnd}>
                  <Pill tone={device.pendingOperations > 0 ? "warn" : "good"}>
                    {device.pendingOperations > 0
                      ? `${device.pendingOperations} queued`
                      : "Up to date"}
                  </Pill>
                  {device.oldestPendingAt ? (
                    <span className={styles.fieldHint}>
                      oldest {relativeTime(device.oldestPendingAt)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {staleDevices.length > 0 ? (
          <p className={styles.cautionBody}>
            {staleDevices.length} device{staleDevices.length === 1 ? "" : "s"} need attention.
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Reminder delivery</h2>
        {deliveries && Object.keys(deliveries.byStatus).length > 0 ? (
          <ul className={styles.healthList}>
            {Object.entries(deliveries.byStatus).map(([status, count]) => (
              <li key={status} className={styles.healthRow}>
                <span className={styles.prefTitle}>{status}</span>
                <Pill tone={toneFor(status)}>{count}</Pill>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No reminder has been generated yet.</p>
        )}

        {deliveries && deliveries.recent.length > 0 ? (
          <ul className={styles.healthList}>
            {deliveries.recent.slice(0, 8).map((row) => (
              <li key={row.id} className={styles.healthRow}>
                <div>
                  <p className={styles.prefTitle}>{row.title}</p>
                  <p className={styles.muted}>
                    {row.channel} · {relativeTime(row.scheduledAt)}
                    {row.attempts > 1 ? ` · ${row.attempts} attempts` : ""}
                  </p>
                  {row.lastError ? <p className={styles.error}>{row.lastError}</p> : null}
                </div>
                <Pill tone={toneFor(row.status)}>{row.status}</Pill>
              </li>
            ))}
          </ul>
        ) : null}

        {deliveryFailures.length > 0 ? (
          <p className={styles.cautionBody}>
            {deliveryFailures.length} recent deliver
            {deliveryFailures.length === 1 ? "y" : "ies"} were skipped or failed. Check the channel
            configuration before the next shift.
          </p>
        ) : null}
      </Card>

      <p className={styles.finePrint}>
        Health is read from the hosted workspace. Rosters, AutoRoster and reports stay in the
        CivicFlow desktop app.
      </p>
    </main>
  );
}

import { useEffect, useState } from "react";
import { Cloud, CloudOff, Database, RefreshCw, RotateCcw } from "lucide-react";
import { Button, ButtonLink, Page, PageHeader } from "../components/ui";
import { isTauri } from "../lib/platform";
import { readReplicaEntities } from "../lib/sync/desktopStore";
import {
  desktopSyncSnapshot,
  startDesktopSync,
  subscribeDesktopSync,
  syncDesktopNow,
  type DesktopSyncState,
} from "../lib/sync/desktop";

type Row = Record<string, unknown>;

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function number(row: Row, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value) || 0;
}

function time(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormat.format(parsed);
}

function StatusPill({ sync }: { sync: DesktopSyncState }) {
  const label =
    sync.phase === "starting"
      ? "Checking the organization…"
      : sync.online
        ? "Connected"
        : sync.configured
          ? "Working from this computer"
          : "Not connected";
  const tone = sync.online ? "var(--tone-green-ink)" : "var(--text-muted)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: tone }}>
      {sync.online ? <Cloud aria-hidden size={14} /> : <CloudOff aria-hidden size={14} />}
      {label}
    </span>
  );
}

/**
 * The desktop's own copy of a hosted organization.
 *
 * This screen is deliberately read-only in the first sync phase. The hosted
 * workspace inside `/shared` remains the place coordinators write; this view
 * proves the encrypted SQLite replica can be rebuilt, survives a restart, and
 * shows the same rows the server holds.
 */
export function DesktopReplicaPage() {
  const [sync, setSync] = useState<DesktopSyncState>(() => desktopSyncSnapshot());
  const [organization, setOrganization] = useState<Row | null>(null);
  const [shifts, setShifts] = useState<Row[]>([]);
  const [opportunities, setOpportunities] = useState<Row[]>([]);
  const [volunteers, setVolunteers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => subscribeDesktopSync(setSync), []);

  useEffect(() => {
    void startDesktopSync();
  }, []);

  useEffect(() => {
    const organizationId = sync.organizationId;
    if (!organizationId || !isTauri()) return;
    let current = true;
    void (async () => {
      try {
        const [organizations, nextShifts, nextOpportunities, nextVolunteers] = await Promise.all([
          readReplicaEntities(organizationId, "organization", 1),
          readReplicaEntities(organizationId, "shift", 500),
          readReplicaEntities(organizationId, "opportunity", 500),
          readReplicaEntities(organizationId, "volunteer", 500),
        ]);
        if (!current) return;
        setOrganization(organizations[0] ?? null);
        setShifts(
          [...nextShifts].sort((left, right) =>
            String(left.starts_at ?? "").localeCompare(String(right.starts_at ?? "")),
          ),
        );
        setOpportunities(nextOpportunities);
        setVolunteers(nextVolunteers);
      } catch {
        if (!current) return;
        setOrganization(null);
        setShifts([]);
        setOpportunities([]);
        setVolunteers([]);
      }
    })();
    return () => {
      current = false;
    };
    // A pull can change the cursor without the user pressing anything; reload
    // the rows then too, or the screen would show the state before the sync.
  }, [sync.organizationId, sync.cursor, sync.entities, version]);

  async function refresh(rebuild: boolean) {
    setBusy(true);
    try {
      if (rebuild) {
        await startDesktopSync(true);
      } else {
        // A failed first start leaves no engine to wake, so refresh also
        // retries the connection before asking for new changes.
        await startDesktopSync();
        await syncDesktopNow();
      }
      setVersion((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  const opportunitiesById = new Map(opportunities.map((row) => [text(row, "id"), row]));

  return (
    <Page>
      <PageHeader
        eyebrow="Shared workspace"
        title="Synced copy"
        description="The organization held in this computer's encrypted database. It is rebuilt from the server and stays readable offline."
        backTo="/shared"
        backLabel="Hosted workspace"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              icon={<RefreshCw aria-hidden size={14} />}
              disabled={busy || !isTauri()}
              onClick={() => void refresh(false)}
            >
              {busy ? "Working…" : "Refresh"}
            </Button>
            <Button
              variant="ghost"
              icon={<RotateCcw aria-hidden size={14} />}
              disabled={busy || !isTauri()}
              onClick={() => void refresh(true)}
            >
              Rebuild from server
            </Button>
          </div>
        }
      />

      {!isTauri() ? (
        <section
          style={{
            border: "1px solid var(--border-soft)",
            borderRadius: 12,
            padding: 18,
            background: "var(--surface-raised)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15 }}>This screen lives in the desktop app</h2>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            The browser build keeps its shared copy in the hosted workspace. Open CivicFlow on this
            computer to inspect the encrypted SQLite replica.
          </p>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <section
            aria-label="Replica status"
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: 12,
              padding: 16,
              background: "var(--surface-raised)",
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Database aria-hidden size={16} />
                <strong style={{ fontSize: 14 }}>
                  {sync.organizationName ||
                    text(organization ?? {}, "name") ||
                    "Shared organization"}
                </strong>
              </span>
              <StatusPill sync={sync} />
            </div>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
                margin: 0,
              }}
            >
              {[
                ["Volunteers", String(volunteers.length)],
                ["Shifts", String(shifts.length)],
                ["Opportunities", String(opportunities.length)],
                ["Waiting to upload", String(sync.pending)],
                ["Open conflicts", String(sync.conflicts)],
                ["Last synced", sync.lastSyncedAt ? time(sync.lastSyncedAt) : "Never"],
                ["Cursor", String(sync.cursor)],
                ["Revision", String(sync.revision)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{label}</dt>
                  <dd style={{ margin: 0, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 12.5 }}>
              {sync.error ? (
                <span style={{ color: "var(--tone-red-ink)" }}>{sync.error}</span>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>
                  {sync.online
                    ? "Changes arrive through the same cursor protocol the volunteer app uses."
                    : "Showing the last copy received. Nothing here was invented while offline."}
                </span>
              )}
            </p>
            {sync.phase === "error" ? (
              <div>
                <ButtonLink to="/coordinator/settings" variant="secondary">
                  Open shared workspace settings
                </ButtonLink>
              </div>
            ) : null}
          </section>

          <section
            aria-labelledby="replica-shifts"
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: 12,
              background: "var(--surface-raised)",
              overflow: "hidden",
            }}
          >
            <h2 id="replica-shifts" style={{ margin: 0, padding: "14px 16px 0", fontSize: 15 }}>
              Shifts in this copy
            </h2>
            {shifts.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: "8px 16px 16px",
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                {sync.configured
                  ? "The organization has no shifts, or the first copy has not finished."
                  : "Connect a shared workspace under Settings to receive the organization."}
              </p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <caption
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      overflow: "hidden",
                      clipPath: "inset(50%)",
                    }}
                  >
                    Shifts received from the shared organization
                  </caption>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 11.5 }}>
                      <th scope="col" style={{ padding: "10px 16px", fontWeight: 560 }}>
                        Starts
                      </th>
                      <th scope="col" style={{ padding: "10px 8px", fontWeight: 560 }}>
                        Opportunity
                      </th>
                      <th scope="col" style={{ padding: "10px 8px", fontWeight: 560 }}>
                        Status
                      </th>
                      <th scope="col" style={{ padding: "10px 16px", fontWeight: 560 }}>
                        Seats
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((shift) => {
                      const id = text(shift, "id");
                      const opportunity = opportunitiesById.get(text(shift, "opportunity_id"));
                      return (
                        <tr key={id} style={{ borderTop: "1px solid var(--border-soft)" }}>
                          <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                            {time(shift.starts_at)}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            {text(opportunity ?? {}, "title") || text(shift, "opportunity_id")}
                          </td>
                          <td style={{ padding: "10px 8px" }}>
                            {text(shift, "status") || "scheduled"}
                          </td>
                          <td style={{ padding: "10px 16px", fontVariantNumeric: "tabular-nums" }}>
                            {number(shift, "confirmed")} / {number(shift, "capacity")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
            Writing coordinators still use the hosted workspace. This copy accepts server changes
            only, so a local edit can never silently disagree with the organization.
          </p>
        </div>
      )}
    </Page>
  );
}

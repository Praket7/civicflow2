import { useMemo, useState } from "react";
import { ChevronDown, Download, ShieldCheck } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Page,
  PageHeader,
  SearchField,
  SelectField,
  StatCard,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useWorkspace } from "../../lib/workspace/session";
import { formatDateTime, getAuditEvents } from "../../lib/workspace/selectors";
import type { AuditEvent } from "../../types/domain";
import styles from "./Records.module.css";

const ENTITY_LABEL: Record<AuditEvent["entityType"], string> = {
  volunteer: "Volunteer",
  shift: "Shift",
  opportunity: "Program",
  hours: "Hours",
  settings: "Settings",
  backup: "Backup",
  system: "System",
};

export function AuditPage() {
  const { session, workspace, backups } = useWorkspace();
  const events = getAuditEvents(session);
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("all");
  const [entity, setEntity] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(events[0]?.id ?? null);

  const actors = useMemo(() => [...new Set(events.map((event) => event.actor))], [events]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return events
      .filter((event) => (actor === "all" ? true : event.actor === actor))
      .filter((event) => (entity === "all" ? true : event.entityType === entity))
      .filter((event) =>
        normalized
          ? `${event.summary} ${event.action} ${event.entityId} ${event.detail ?? ""}`
              .toLowerCase()
              .includes(normalized)
          : true,
      );
  }, [actor, entity, events, query]);

  function exportCsv() {
    const rows = filtered.map((event) => [
      event.at,
      event.actor,
      event.action,
      `${event.entityType}:${event.entityId}`,
      event.summary,
      event.detail ?? "",
    ]);
    downloadCsv("civicflow-audit-log.csv", [
      ["Timestamp", "Actor", "Action", "Entity", "Summary", "Detail"],
      ...rows,
    ]);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Records"
        title="Audit log"
        description="Every consequential write: who changed what, when, and why. IDs stay collapsed until you need them."
        actions={
          <>
            <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>
              Export log
            </Button>
            <Badge tone="green" dot>
              Local, tamper-evident
            </Badge>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <StatCard icon={ShieldCheck} value={events.length} label="Audited events" tone="cobalt" />
        <StatCard
          icon={ShieldCheck}
          value={events.filter((event) => event.actor === workspace.coordinator.name).length}
          label="By you"
          meta="coordinator actions"
          tone="violet"
        />
        <StatCard
          icon={ShieldCheck}
          value={events.filter((event) => event.actor === "System").length}
          label="Automatic"
          meta="rules and snapshots"
          tone="neutral"
        />
        <StatCard
          icon={ShieldCheck}
          value={backups.length}
          label="Backups covered"
          meta="validated snapshots"
          tone="green"
        />
      </div>

      <Card>
        <div
          style={{
            display: "flex",
            gap: 9,
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginBottom: 8,
          }}
        >
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search action, summary, or ID…"
            label="Search audit log"
          />
          <div style={{ width: 170 }}>
            <SelectField
              label="Actor"
              value={actor}
              onChange={(event) => setActor(event.target.value)}
            >
              <option value="all">All actors</option>
              {actors.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </SelectField>
          </div>
          <div style={{ width: 150 }}>
            <SelectField
              label="Entity"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
            >
              <option value="all">All entities</option>
              {Object.entries(ENTITY_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
          </div>
          <Badge tone="neutral">{filtered.length} events</Badge>
        </div>

        <div className={styles.timeline}>
          {filtered.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13.5, color: "var(--text-muted)" }}>
              No audit events match these filters.
            </p>
          ) : (
            filtered.map((event) => {
              const isOpen = expanded === event.id;
              return (
                <div className={styles.timelineItem} key={event.id}>
                  <div className={styles.timelineRail}>
                    <span
                      className={styles.timelineDot}
                      style={{
                        background:
                          event.actor === "System" ? "var(--color-violet)" : "var(--color-cobalt)",
                      }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineAction}>
                      <Avatar
                        initials={
                          event.actor === "System"
                            ? "SY"
                            : event.actor
                                .split(" ")
                                .map((part) => part[0])
                                .join("")
                        }
                        tone={event.actor === "System" ? "violet" : "cobalt"}
                        size={22}
                      />
                      <span className={styles.timelineSummary}>{event.summary}</span>
                      <Badge tone="neutral">{ENTITY_LABEL[event.entityType]}</Badge>
                      <Badge tone="cobalt">{event.action}</Badge>
                    </div>
                    <div className={styles.timelineMeta}>
                      {event.actor} · {formatDateTime(event.at)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : event.id)}
                      aria-expanded={isOpen}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 6,
                        border: 0,
                        background: "none",
                        padding: 0,
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      <ChevronDown
                        size={11}
                        aria-hidden="true"
                        style={{ transform: isOpen ? "rotate(180deg)" : undefined }}
                      />
                      {isOpen ? "Hide details" : "Show details"}
                    </button>
                    {isOpen ? (
                      <div className={styles.timelineDetail}>
                        entity: {event.entityType}/{event.entityId}
                        {event.detail ? ` · ${event.detail}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <time className={styles.timelineRight} dateTime={event.at}>
                    {formatDateTime(event.at)}
                  </time>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </Page>
  );
}

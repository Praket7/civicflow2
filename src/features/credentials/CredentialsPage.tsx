import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Download,
  Mail,
  ShieldCheck,
  Users,
} from "lucide-react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Page,
  PageHeader,
  ProgressBar,
  SearchField,
  SectionHeader,
  StatCard,
  Tabs,
  statusLabel,
  statusTone,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import type { CredentialStatus } from "../../types/domain";
import { t } from "../../lib/i18n";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { peopleTabs } from "../../app/workAreas";
import {
  getCredentialSupply,
  getCredentials,
  getRoleRisk,
  type CredentialRow,
} from "../../lib/workspace/selectors";
import styles from "./CredentialsPage.module.css";

type Filter = "all" | CredentialStatus;

const FILTER_LABELS: Record<Filter, string> = {
  all: "All credentials",
  current: "Current",
  expiring: "Expiring",
  expired: "Expired",
};

export function CredentialsPage() {
  const { workspace, session } = useWorkspace();
  const credentials = getCredentials(session, workspace);
  const supply = getCredentialSupply(workspace);
  const roleRisk = getRoleRisk(workspace);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [exported, setExported] = useState("");

  const counts = useMemo(() => {
    return credentials.reduce(
      (totals, credential) => {
        totals[credential.status] += 1;
        return totals;
      },
      { current: 0, expiring: 0, expired: 0 } as Record<CredentialStatus, number>,
    );
  }, [credentials]);

  const uniqueVolunteers = useMemo(
    () => new Set(credentials.map((credential) => credential.volunteer.id)).size,
    [credentials],
  );

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return credentials.filter((credential) => {
      if (filter !== "all" && credential.status !== filter) return false;
      if (!normalized) return true;
      return (
        credential.volunteer.name.toLowerCase().includes(normalized) ||
        credential.name.toLowerCase().includes(normalized) ||
        credential.volunteer.email.toLowerCase().includes(normalized)
      );
    });
  }, [credentials, filter, query]);

  const tabs = (["all", "current", "expiring", "expired"] as Filter[]).map((id) => ({
    id,
    label: t(FILTER_LABELS[id]),
    count: id === "all" ? credentials.length : counts[id as Exclude<CredentialStatus, never>],
  }));

  const gapRoles = roleRisk.filter((role) => role.percent < 100).slice(0, 3);
  const sortedSupply = useMemo(
    () =>
      [...supply].sort((first, second) => {
        const firstGap = first.demand - first.supply;
        const secondGap = second.demand - second.supply;
        return secondGap - firstGap || second.demand - first.demand;
      }),
    [supply],
  );

  function statusFor(credential: CredentialRow) {
    if (!credential.expiresAt) return { days: null, label: t("No expiry") };
    const days = differenceInCalendarDays(parseISO(credential.expiresAt), parseISO(workspace.now));
    if (days < 0) return { days, label: t("{count} days ago", { count: Math.abs(days) }) };
    if (days === 0) return { days, label: t("Today") };
    return { days, label: t("{count} days left", { count: days }) };
  }

  function exportCsv() {
    const header = ["Volunteer", "Email", "Credential", "Issued", "Expires", "Status"];
    const rows = filtered.map((credential) => [
      credential.volunteer.name,
      credential.volunteer.email,
      credential.name,
      credential.issuedAt,
      credential.expiresAt ?? "",
      credential.status,
    ]);
    downloadCsv("civicflow-credentials.csv", [header, ...rows]);
    setExported(t("Exported {count} credential records.", { count: filtered.length }));
  }

  return (
    <Page>
      <WorkAreaTabs label="People" items={peopleTabs} />
      <PageHeader
        eyebrow="Workforce readiness"
        title="Credentials & skills"
        description="Know who is cleared before you schedule them. Expiry dates are tracked, shortages stay visible, and reminders go to a real person."
        actions={
          <>
            <ButtonLink
              to="/coordinator/applications"
              variant="secondary"
              icon={<Users size={14} />}
            >
              Recruit volunteers
            </ButtonLink>
            <Button variant="primary" icon={<Download size={14} />} onClick={exportCsv}>
              Export CSV
            </Button>
          </>
        }
      />

      <p className={styles.liveRegion} role="status" aria-live="polite">
        {exported}
      </p>

      <div className={styles.stats}>
        <StatCard
          icon={ShieldCheck}
          tone="green"
          value={counts.current}
          label="Current credentials"
          meta={t("{count} volunteers cleared", { count: uniqueVolunteers })}
        />
        <StatCard
          icon={CalendarClock}
          tone="amber"
          value={counts.expiring}
          label="Expiring in 45 days"
          meta="Reminder window"
        />
        <StatCard
          icon={AlertTriangle}
          tone="coral"
          value={counts.expired}
          label="Expired"
          meta="Blocks scheduling"
        />
        <StatCard
          icon={Users}
          tone="cobalt"
          value={roleRisk.filter((role) => role.percent < 100).length}
          label="Roles under 100%"
          meta="Across upcoming shifts"
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <Card>
            <SectionHeader
              title="Supply against scheduled demand"
              subtitle="Volunteers who hold each credential, compared with upcoming role slots that ask for it."
              action={
                <Badge tone="neutral">
                  {t("{count} tracked skills", { count: sortedSupply.length })}
                </Badge>
              }
            />
            <div className={styles.supplyList}>
              {sortedSupply.map((row) => {
                const state =
                  row.supply < row.demand ? "short" : row.demand === 0 ? "unused" : "covered";
                const tone =
                  state === "short"
                    ? "var(--tone-red-ink)"
                    : state === "unused"
                      ? "var(--text-muted)"
                      : "var(--tone-green-ink)";
                const max = Math.max(row.supply, row.demand, 1);
                return (
                  <div className={styles.supplyRow} key={row.skill}>
                    <div className={styles.supplyName}>
                      <span className={styles.skillName}>{row.skill}</span>
                      <span className={styles.skillState} style={{ color: tone }}>
                        {t(
                          state === "short"
                            ? "Short"
                            : state === "unused"
                              ? "No demand"
                              : "Covered",
                        )}
                      </span>
                    </div>
                    <div className={styles.bars}>
                      <div className={styles.barLine}>
                        <span className={styles.barTag}>{t("Supply")}</span>
                        <div className={styles.barTrack}>
                          <span
                            className={styles.barFill}
                            style={{
                              width: `${(row.supply / max) * 100}%`,
                              background: "var(--color-cobalt)",
                            }}
                          />
                        </div>
                        <span className={styles.barNumber}>{row.supply}</span>
                      </div>
                      <div className={styles.barLine}>
                        <span className={styles.barTag}>{t("Needed")}</span>
                        <div className={styles.barTrack}>
                          <span
                            className={styles.barFill}
                            style={{
                              width: `${(row.demand / max) * 100}%`,
                              background: "var(--color-orange)",
                            }}
                          />
                        </div>
                        <span className={styles.barNumber}>{row.demand}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={styles.footnote}>
              Demand counts required role slots in upcoming shifts, not total volunteers. A
              credential with no scheduled demand still matters for future scheduling.
            </p>
          </Card>

          <Card padding="compact">
            <div className={styles.tableHeader}>
              <SectionHeader
                title="Credential register"
                subtitle="Expiry dates come from each volunteer's record. Reminders open your email client."
              />
              <div className={styles.controls}>
                <SearchField
                  value={query}
                  onChange={setQuery}
                  placeholder="Search name or credential"
                  label="Search credentials"
                />
              </div>
            </div>

            <div className={styles.tabRow}>
              <Tabs
                items={tabs}
                value={filter}
                onChange={(value) => setFilter(value as Filter)}
                label="Filter credentials by status"
              />
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                title="No credentials match this view"
                copy="Try another status filter or clear the search. Expiring credentials appear here 45 days before their expiry date."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className="visually-hidden">
                    Volunteer credentials and expiry dates
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Volunteer</th>
                      <th scope="col">Credential</th>
                      <th scope="col">Issued</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Status</th>
                      <th scope="col" className={styles.alignRight}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((credential) => {
                      const expiry = statusFor(credential);
                      const mailto = `mailto:${credential.volunteer.email}?subject=${encodeURIComponent(
                        `CivicFlow: ${credential.name} renewal`,
                      )}&body=${encodeURIComponent(
                        `Hi ${credential.volunteer.firstName},\n\nOur records show your ${credential.name} ${
                          credential.status === "expired" ? "has expired" : "expires soon"
                        }${credential.expiresAt ? ` on ${format(parseISO(credential.expiresAt), "MMMM d, yyyy")}` : ""}. Could you send an updated copy so we can keep you scheduled?\n\nThank you,\n${workspace.coordinator.name}\n${workspace.organization.name}`,
                      )}`;
                      return (
                        <tr key={credential.id}>
                          <td>
                            <div className={styles.person}>
                              <Avatar
                                initials={credential.volunteer.initials}
                                tone={credential.volunteer.tone}
                                size={30}
                              />
                              <div>
                                <Link
                                  className={styles.personName}
                                  to={`/coordinator/volunteers/${credential.volunteer.id}`}
                                >
                                  {credential.volunteer.name}
                                </Link>
                                <div className={styles.personMeta}>
                                  {credential.volunteer.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={styles.credentialName}>{credential.name}</span>
                          </td>
                          <td className={styles.muted}>
                            {format(parseISO(credential.issuedAt), "MMM d, yyyy")}
                          </td>
                          <td>
                            <span className={styles.expiry}>
                              {credential.expiresAt
                                ? format(parseISO(credential.expiresAt), "MMM d, yyyy")
                                : t("No expiry")}
                            </span>
                            <span
                              className={
                                credential.status === "expired"
                                  ? `${styles.daysLeft} ${styles.daysBad}`
                                  : credential.status === "expiring"
                                    ? `${styles.daysLeft} ${styles.daysWarn}`
                                    : styles.daysLeft
                              }
                            >
                              {expiry.label}
                            </span>
                          </td>
                          <td>
                            <Badge tone={statusTone(credential.status)} dot>
                              {statusLabel(credential.status)}
                            </Badge>
                          </td>
                          <td className={styles.alignRight}>
                            <a className={styles.remind} href={mailto}>
                              <Mail size={12} aria-hidden="true" />
                              Remind
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className={styles.rail} aria-label="Credential insights">
          <Card>
            <SectionHeader
              title="Recruitment recommendations"
              subtitle="Roles with unfilled slots in the next 30 days."
              action={
                <Badge tone={gapRoles.length > 0 ? "amber" : "green"}>{gapRoles.length}</Badge>
              }
            />
            {gapRoles.length === 0 ? (
              <p className={styles.railCopy}>
                Every upcoming role is fully staffed. Keep recruiting ahead of the holiday rush.
              </p>
            ) : (
              <ul className={styles.recommendations}>
                {gapRoles.map((role) => (
                  <li key={role.role} className={styles.recommendation}>
                    <span className={styles.recommendIcon} aria-hidden="true">
                      <AlertTriangle size={14} />
                    </span>
                    <div className={styles.recommendBody}>
                      <div className={styles.recommendTitle}>{role.role}</div>
                      <p className={styles.recommendCopy}>
                        {role.required - role.filled} more{" "}
                        {role.required - role.filled === 1 ? "person" : "people"} needed ·{" "}
                        {role.percent}% covered
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ButtonLink to="/coordinator/applications" variant="secondary" size="small">
              Open recruitment pipeline <ArrowRight size={13} aria-hidden="true" />
            </ButtonLink>
          </Card>

          <Card>
            <SectionHeader
              title="Role coverage"
              subtitle="Filled against required slots, all upcoming shifts."
              action={
                <ButtonLink to="/coordinator/coverage" variant="ghost" size="small">
                  Coverage
                </ButtonLink>
              }
            />
            <div className={styles.riskList}>
              {roleRisk.slice(0, 5).map((role) => {
                const tone =
                  role.percent < 70
                    ? "var(--tone-red-ink)"
                    : role.percent < 90
                      ? "var(--tone-amber-ink)"
                      : "var(--tone-green-ink)";
                return (
                  <div className={styles.riskRow} key={role.role}>
                    <div className={styles.riskTop}>
                      <span className={styles.riskName}>{role.role}</span>
                      <span className={styles.riskValue} style={{ color: tone }}>
                        {role.filled}/{role.required}
                      </span>
                    </div>
                    <ProgressBar value={role.percent} tone={tone} label={`${role.role} coverage`} />
                  </div>
                );
              })}
            </div>
            <p className={styles.footnote}>
              Expired credentials block assignment even when a seat is open.
            </p>
          </Card>

          <Card surface="dark">
            <p className={styles.policyEyebrow}>Credential policy</p>
            <h2 className={styles.policyTitle}>Cleared before scheduled.</h2>
            <p className={styles.policyCopy}>
              CivicFlow warns 45 days before expiry, blocks assignment on expiry, and records the
              reminder in the audit log. No volunteer arrives without the clearance their role
              requires.
            </p>
            <ButtonLink to="/coordinator/settings" variant="lime" size="small">
              Review policy
            </ButtonLink>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

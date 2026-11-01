import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Heart,
  ImagePlus,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Page,
  Tabs,
  statusLabel,
  statusTone,
} from "../../components/ui";
import type { Column } from "../../components/ui";
import type { DayKey, PeriodKey } from "../../types/domain";
import { t } from "../../lib/i18n";
import { profilePhoto } from "../../lib/images";
import {
  CAUSE_LABELS,
  currentVolunteer,
  formatDate,
  formatDateTime,
  formatMinutes,
  getCredentials,
  getHourRows,
  getHoursSummary,
  getMatches,
  getRecentActivityFor,
  getUpcomingShiftRows,
  type HourRow,
} from "../../lib/workspace/selectors";
import { useWorkspace } from "../../lib/workspace/session";
import styles from "./VolunteerProfilePage.module.css";
import { messageOf } from "../../lib/errors";

type ProfileTab = "overview" | "skills" | "availability" | "activity";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "skills", label: "Skills & credentials" },
  { id: "availability", label: "Availability" },
  { id: "activity", label: "Activity" },
];

const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: "mon", label: "Monday", short: "M" },
  { key: "tue", label: "Tuesday", short: "T" },
  { key: "wed", label: "Wednesday", short: "W" },
  { key: "thu", label: "Thursday", short: "T" },
  { key: "fri", label: "Friday", short: "F" },
  { key: "sat", label: "Saturday", short: "S" },
  { key: "sun", label: "Sunday", short: "S" },
];

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const HOUR_COLUMNS: Column<HourRow>[] = [
  {
    key: "date",
    header: "Date",
    width: "116px",
    render: (row) => <span className={styles.cellMuted}>{formatDate(`${row.date}T12:00:00`)}</span>,
  },
  {
    key: "program",
    header: "Program",
    render: (row) => (
      <div>
        <div className={styles.cellTitle}>{row.opportunity.title}</div>
        <div className={styles.cellSub}>{CAUSE_LABELS[row.opportunity.cause]}</div>
      </div>
    ),
  },
  {
    key: "logged",
    header: "Logged",
    width: "100px",
    render: (row) => (
      <span className={styles.cellStrong}>
        {formatMinutes(row.approvedMinutes ?? row.requestedMinutes)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    width: "110px",
    render: (row) => (
      <Badge tone={statusTone(row.status)} dot>
        {statusLabel(row.status)}
      </Badge>
    ),
  },
  {
    key: "verification",
    header: "Verification",
    width: "132px",
    render: (row) =>
      row.verificationId ? (
        <span className={styles.mono}>{row.verificationId}</span>
      ) : (
        <span className={styles.cellMuted}>Not issued</span>
      ),
  },
];

export function VolunteerProfilePage() {
  const { workspace, session, actions } = useWorkspace();
  const volunteer = currentVolunteer(workspace);
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [photo, setPhoto] = useState(session.volunteerProfile.photo ?? volunteer.photo ?? "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);

  const profile = session.volunteerProfile;
  const summary = getHoursSummary(volunteer.id, session, workspace);
  const hourRows = getHourRows(session, workspace)
    .filter((row) => row.volunteer.id === volunteer.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const credentials = getCredentials(session, workspace).filter(
    (row) => row.volunteer.id === volunteer.id,
  );
  const matches = getMatches(
    { ...volunteer, skills: profile.skills },
    3,
    workspace,
    session.createdOpportunities,
  );
  const recentActivity = getRecentActivityFor(volunteer.id, workspace);
  const upcoming = getUpcomingShiftRows(workspace);
  const expiring = credentials.filter((row) => row.status !== "current");
  const availability = profile.availability;
  const availableCount = availability.length;
  const phoneHref = `tel:${volunteer.phone.replace(/[^\d+]/g, "")}`;

  async function savePhoto(next: string) {
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await actions.saveVolunteerProfile({ ...profile, photo: next });
      setPhoto(next);
    } catch (caught) {
      setPhotoError(messageOf(caught));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      await savePhoto(await profilePhoto(file));
    } catch (caught) {
      setPhotoError(messageOf(caught));
      setPhotoBusy(false);
    }
  }

  const timeline = [
    ...recentActivity.map((item) => ({
      id: item.id,
      title: item.action,
      detail: item.detail,
      at: formatDateTime(item.at),
      tone: item.tone,
    })),
    ...hourRows.slice(0, 3).map((row) => ({
      id: `timeline-${row.id}`,
      title:
        row.status === "verified"
          ? `Logged ${formatMinutes(row.approvedMinutes ?? row.requestedMinutes)}`
          : "Submitted hours for review",
      detail: `${row.opportunity.title} · ${formatDate(`${row.date}T12:00:00`)}`,
      at: formatDate(`${row.date}T12:00:00`),
      tone: row.status === "verified" ? "green" : "amber",
    })),
  ].slice(0, 4);

  return (
    <Page>
      <header className={styles.hero}>
        <div className={styles.heroGrid}>
          <div className={styles.identity}>
            <div className={styles.avatarWrap}>
              <Avatar
                initials={volunteer.initials}
                src={photo || undefined}
                tone={volunteer.tone}
                size={84}
              />
              <span className={styles.avatarStatus} aria-hidden="true">
                <CheckCircle2 size={13} />
              </span>
            </div>
            <div className={styles.identityText}>
              <p className={styles.eyebrow}>Volunteer profile</p>
              <h1 className={styles.name}>{volunteer.name}</h1>
              <div className={styles.metaRow}>
                <span className={styles.metaItem}>
                  <MapPin size={12.5} aria-hidden="true" />
                  {workspace.organization.city}, {workspace.organization.state}
                </span>
                <span className={styles.metaItem}>
                  <CalendarDays size={12.5} aria-hidden="true" />
                  Joined {formatDate(volunteer.joinedAt)}
                </span>
                <Badge tone="green" dot>
                  Active volunteer
                </Badge>
              </div>
              <p className={styles.contactRow}>
                <a href={`mailto:${volunteer.email}`} className={styles.contactLink}>
                  <Mail size={12.5} aria-hidden="true" />
                  {volunteer.email}
                </a>
                <a href={phoneHref} className={styles.contactLink}>
                  <Phone size={12.5} aria-hidden="true" />
                  {volunteer.phone}
                </a>
              </p>
              <div className={styles.heroActions}>
                <ButtonLink
                  to="/volunteer/onboarding"
                  variant="primary"
                  size="small"
                  icon={<Pencil size={13} aria-hidden="true" />}
                >
                  Edit skills &amp; availability
                </ButtonLink>
                <ButtonLink
                  to="/volunteer/verification"
                  variant="secondary"
                  size="small"
                  icon={<BadgeCheck size={13} aria-hidden="true" />}
                >
                  View verification
                </ButtonLink>
              </div>
              <div className={styles.photoControls}>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  disabled={photoBusy}
                  onClick={() => photoInput.current?.click()}
                  icon={<ImagePlus size={13} aria-hidden="true" />}
                >
                  {photo ? t("Change photo") : t("Upload photo")}
                </Button>
                {photo ? (
                  <button
                    type="button"
                    className={styles.photoRemove}
                    disabled={photoBusy}
                    onClick={() => void savePhoto("")}
                  >
                    {t("Remove")}
                  </button>
                ) : null}
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    void uploadPhoto(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              <p className={styles.photoNote}>
                {photoError ||
                  t("Profile photo is optional. Your initials stand in until a photo is added.")}
              </p>
            </div>
          </div>

          <div className={styles.metricRow} aria-label="Profile summary">
            <div className={styles.metric}>
              <span className={styles.metricValue}>{volunteer.attendanceRate}%</span>
              <span className={styles.metricLabel}>Attendance</span>
              <span className={styles.metricFoot}>Across {volunteer.eventsCompleted} events</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>{formatMinutes(summary.verifiedMinutes)}</span>
              <span className={styles.metricLabel}>Verified hours</span>
              <span className={styles.metricFoot}>
                {summary.pendingMinutes > 0
                  ? t("{duration} awaiting review", {
                      duration: formatMinutes(summary.pendingMinutes),
                    })
                  : t("No hours waiting")}
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>{volunteer.eventsCompleted}</span>
              <span className={styles.metricLabel}>Events completed</span>
              <span className={styles.metricFoot}>
                {summary.certificates} service record issued
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className={styles.tabBar}>
        <Tabs
          items={TABS}
          value={tab}
          onChange={(value) => setTab(value as ProfileTab)}
          label="Profile sections"
        />
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
          {tab === "overview" ? (
            <>
              <Card>
                <h2 className={styles.cardTitle}>About {volunteer.firstName}</h2>
                <p className={styles.bodyCopy}>{volunteer.interests}</p>
                <p className={styles.bodyCopy}>
                  {volunteer.firstName} serves with {workspace.organization.name} and is interested
                  in {volunteer.causes.map((cause) => CAUSE_LABELS[cause].toLowerCase()).join(", ")}
                  .
                </p>

                <h3 className={styles.subheading}>Skills &amp; interests</h3>
                <div className={styles.skillChips}>
                  {profile.skills.map((skill) => (
                    <span key={skill} className={styles.skillChip}>
                      {skill}
                    </span>
                  ))}
                </div>

                <div className={styles.miniMetaGrid}>
                  <div>
                    <span className={styles.fieldLabel}>Languages</span>
                    <p className={styles.fieldValue}>{volunteer.languages.join(" · ")}</p>
                  </div>
                  <div>
                    <span className={styles.fieldLabel}>Availability</span>
                    <p className={styles.fieldValue}>
                      {t(
                        availableCount === 1
                          ? "{count} window each week"
                          : "{count} windows each week",
                        { count: availableCount },
                      )}
                    </p>
                  </div>
                </div>

                <h3 className={styles.subheading}>This week&apos;s availability</h3>
                <div className={styles.miniWeek} aria-label="Weekly availability summary">
                  {DAYS.map((day) => {
                    const daySlots = availability.filter((slot) => slot.day === day.key).length;
                    return (
                      <div key={day.key} className={styles.miniDay}>
                        <span className={styles.miniDayLabel}>{day.short}</span>
                        <span className={daySlots > 0 ? styles.miniDotOn : styles.miniDotOff}>
                          {daySlots > 0 ? <CheckCircle2 size={11} aria-hidden="true" /> : null}
                          <span className="visually-hidden">
                            {t("{day}: {state}", {
                              day: t(day.label),
                              state: t(daySlots > 0 ? "available" : "not available"),
                            })}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card>
                <div className={styles.cardHeadRow}>
                  <h2 className={styles.cardTitle}>Credentials</h2>
                  <Link className={styles.cardLink} to="/volunteer/verification">
                    View records
                    <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
                {credentials.length === 0 ? (
                  <EmptyState
                    title="No verified credentials yet"
                    copy="Skills are self-reported. A coordinator verifies a credential after reviewing documentation."
                    action={<ButtonLink to="/volunteer/onboarding">Add skills</ButtonLink>}
                  />
                ) : (
                  <ul className={styles.credentialList}>
                    {credentials.map((credential) => (
                      <li key={credential.id} className={styles.credentialRow}>
                        <span className={styles.credentialIcon} aria-hidden="true">
                          <ShieldCheck size={14} />
                        </span>
                        <span className={styles.credentialInfo}>
                          <span className={styles.credentialName}>{credential.name}</span>
                          <span className={styles.credentialMeta}>
                            {credential.expiresAt
                              ? t("Expires {date}", {
                                  date: formatDate(`${credential.expiresAt}T12:00:00`),
                                })
                              : t("No expiry")}
                          </span>
                        </span>
                        <Badge tone={statusTone(credential.status)} dot>
                          {statusLabel(credential.status)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={styles.note}>
                  {credentials.length === 0
                    ? "No credential documentation is on file for this profile."
                    : expiring.length > 0
                      ? t("{count} credential needs attention before the next service window.", {
                          count: expiring.length,
                        })
                      : t("All credentials on file are current.")}
                </p>
              </Card>

              <Card className={styles.recentCard}>
                <div className={styles.cardHeadRow}>
                  <h2 className={styles.cardTitle}>Recent activity</h2>
                  <Link className={styles.cardLink} to="/volunteer/hours">
                    All hours
                    <ArrowRight size={12} aria-hidden="true" />
                  </Link>
                </div>
                <div className={styles.recentGrid}>
                  {timeline.length === 0 ? (
                    <p className={styles.note}>No recorded activity yet.</p>
                  ) : (
                    timeline.map((item) => (
                      <div key={item.id} className={styles.recentItem}>
                        <span
                          className={styles.recentDot}
                          data-tone={item.tone}
                          aria-hidden="true"
                        />
                        <div>
                          <p className={styles.recentTitle}>{item.title}</p>
                          <p className={styles.recentDetail}>{item.detail}</p>
                          <p className={styles.recentMeta}>{item.at}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </>
          ) : null}

          {tab === "skills" ? (
            <>
              <div className={styles.splitCards}>
                <Card>
                  <h2 className={styles.cardTitle}>Skills &amp; languages</h2>
                  <p className={styles.bodyCopy}>
                    These skills come from your profile and drive the match score you see on
                    opportunities. Editing them updates recommendations immediately.
                  </p>
                  <div className={styles.skillChips}>
                    {profile.skills.map((skill) => (
                      <span key={skill} className={styles.skillChip}>
                        {skill}
                      </span>
                    ))}
                  </div>
                  <h3 className={styles.subheading}>Languages</h3>
                  <div className={styles.chipRow}>
                    {volunteer.languages.map((language) => (
                      <span key={language} className={styles.outlineChip}>
                        {language}
                      </span>
                    ))}
                  </div>
                  <h3 className={styles.subheading}>Causes you care about</h3>
                  <div className={styles.chipRow}>
                    {volunteer.causes.map((cause) => (
                      <span key={cause} className={styles.causeChip}>
                        {CAUSE_LABELS[cause]}
                      </span>
                    ))}
                  </div>
                  <div className={styles.cardAction}>
                    <ButtonLink to="/volunteer/onboarding" variant="primary" size="small">
                      Edit skills
                    </ButtonLink>
                  </div>
                </Card>

                <Card>
                  <h2 className={styles.cardTitle}>Credentials</h2>
                  <p className={styles.bodyCopy}>
                    Credentials require coordinator verification. Expired or expiring items are
                    flagged here before they block a role assignment.
                  </p>
                  {credentials.length === 0 ? (
                    <EmptyState
                      title="No credentials on file"
                      copy="A coordinator can verify CPR, food safety, driver clearance, and tutoring credentials."
                    />
                  ) : (
                    <ul className={styles.credentialList}>
                      {credentials.map((credential) => (
                        <li key={credential.id} className={styles.credentialRow}>
                          <span className={styles.credentialIcon} aria-hidden="true">
                            <ShieldCheck size={14} />
                          </span>
                          <span className={styles.credentialInfo}>
                            <span className={styles.credentialName}>{credential.name}</span>
                            <span className={styles.credentialMeta}>
                              Issued {formatDate(`${credential.issuedAt}T12:00:00`)}
                              {credential.expiresAt
                                ? ` · expires ${formatDate(`${credential.expiresAt}T12:00:00`)}`
                                : ""}
                            </span>
                          </span>
                          <Badge tone={statusTone(credential.status)} dot>
                            {statusLabel(credential.status)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={styles.cardAction}>
                    <ButtonLink to="/volunteer/verification" variant="secondary" size="small">
                      View verification records
                    </ButtonLink>
                  </div>
                </Card>
              </div>
              <Card>
                <h2 className={styles.cardTitle}>Recommended service</h2>
                <div className={styles.recommendGrid}>
                  {matches.map((match) => (
                    <Link
                      key={match.opportunity.id}
                      className={styles.recommendCard}
                      to={`/volunteer/opportunities/${match.opportunity.slug}`}
                    >
                      <img
                        src={match.opportunity.image}
                        alt={match.opportunity.imageAlt}
                        className={styles.recommendImage}
                        loading="lazy"
                      />
                      <span className={styles.recommendBody}>
                        <span className={styles.recommendTitle}>{match.opportunity.title}</span>
                        <span className={styles.recommendMeta}>
                          {CAUSE_LABELS[match.opportunity.cause]} · {match.score}% match
                        </span>
                      </span>
                      <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </Card>
            </>
          ) : null}

          {tab === "availability" ? (
            <Card>
              <div className={styles.cardHeadRow}>
                <div>
                  <h2 className={styles.cardTitle}>Weekly availability</h2>
                  <p className={styles.cardSub}>
                    Coordinators use these windows to place you without a scheduling call.
                  </p>
                </div>
                <ButtonLink
                  to="/volunteer/onboarding"
                  variant="primary"
                  size="small"
                  icon={<Pencil size={12} aria-hidden="true" />}
                >
                  Update availability
                </ButtonLink>
              </div>
              <table className={styles.availabilityTable}>
                <caption className="visually-hidden">
                  Availability by day and part of day for {volunteer.name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    {PERIODS.map((period) => (
                      <th key={period.key} scope="col">
                        {period.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((day) => (
                    <tr key={day.key}>
                      <th scope="row">{day.label}</th>
                      {PERIODS.map((period) => {
                        const available = availability.some(
                          (slot) => slot.day === day.key && slot.period === period.key,
                        );
                        return (
                          <td key={period.key}>
                            <span
                              className={available ? styles.availOn : styles.availOff}
                              aria-label={t("{day} {period}: {state}", {
                                day: t(day.label),
                                period: t(period.label),
                                state: t(available ? "available" : "not available"),
                              })}
                            >
                              {available ? <CheckCircle2 size={13} aria-hidden="true" /> : "—"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.note}>
                {t(
                  "{count} weekly windows selected. Availability is a preference, not a commitment — every shift still needs a confirmed registration.",
                  { count: availableCount },
                )}
              </p>
            </Card>
          ) : null}

          {tab === "activity" ? (
            <>
              <Card>
                <div className={styles.cardHeadRow}>
                  <div>
                    <h2 className={styles.cardTitle}>Hour history</h2>
                    <p className={styles.cardSub}>
                      Only verified hours count toward service verification.
                    </p>
                  </div>
                  <Badge tone={summary.pendingMinutes > 0 ? "amber" : "green"} dot>
                    {summary.pendingMinutes > 0
                      ? `${formatMinutes(summary.pendingMinutes)} pending`
                      : "All reviewed"}
                  </Badge>
                </div>
                <DataTable
                  columns={HOUR_COLUMNS}
                  rows={hourRows}
                  caption={`Hour records for ${volunteer.name}`}
                  empty="No hours have been logged yet."
                />
              </Card>

              <Card>
                <h2 className={styles.cardTitle}>Activity timeline</h2>
                <ul className={styles.timeline}>
                  {timeline.map((item) => (
                    <li key={item.id} className={styles.timelineItem}>
                      <span
                        className={styles.timelineDot}
                        data-tone={item.tone}
                        aria-hidden="true"
                      />
                      <div>
                        <p className={styles.recentTitle}>{item.title}</p>
                        <p className={styles.recentDetail}>{item.detail}</p>
                        <p className={styles.recentMeta}>{item.at}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}
        </div>

        <aside className={styles.rail} aria-label="Matches and impact">
          <Card>
            <div className={styles.cardHeadRow}>
              <h2 className={styles.cardTitle}>Best matches</h2>
            </div>
            <ul className={styles.matchList}>
              {matches.map((match) => {
                const nextShift = upcoming.find(
                  (row) => row.opportunity.id === match.opportunity.id,
                )?.shift;
                return (
                  <li key={match.opportunity.id}>
                    <Link
                      className={styles.matchCard}
                      to={`/volunteer/opportunities/${match.opportunity.slug}`}
                    >
                      <img
                        src={match.opportunity.image}
                        alt=""
                        className={styles.matchThumb}
                        loading="lazy"
                      />
                      <span className={styles.matchCopy}>
                        <span className={styles.matchTitle}>{match.opportunity.title}</span>
                        <span className={styles.matchMeta}>
                          {nextShift ? formatDate(nextShift.startsAt) : "No upcoming shift"}
                        </span>
                        <span className={styles.matchReason}>{match.reasons[0]}</span>
                      </span>
                      <span className={styles.matchScore}>{match.score}%</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link className={styles.cardLink} to="/volunteer/discover">
              Discover all opportunities
              <ArrowRight size={12} aria-hidden="true" />
            </Link>
          </Card>

          <Card surface="dark" className={styles.impactCard}>
            <div className={styles.impactHead}>
              <Heart size={15} aria-hidden="true" />
              <span>Your impact</span>
            </div>
            <p className={styles.impactValue}>{formatMinutes(summary.totalMinutes)}</p>
            <p className={styles.impactLabel}>recorded across {summary.events} programs</p>
            <div className={styles.impactGrid}>
              <div>
                <span className={styles.impactNumber}>
                  {formatMinutes(summary.verifiedMinutes)}
                </span>
                <span className={styles.impactCaption}>verified</span>
              </div>
              <div>
                <span className={styles.impactNumber}>{summary.certificates}</span>
                <span className={styles.impactCaption}>verification records</span>
              </div>
            </div>
            <Link className={styles.impactLink} to="/volunteer/impact">
              See your impact
              <ArrowRight size={12} aria-hidden="true" />
            </Link>
          </Card>

          <Card>
            <h2 className={styles.cardTitle}>Next steps</h2>
            <ul className={styles.nextList}>
              <li>
                <Clock3 size={14} aria-hidden="true" />
                <span>
                  {summary.pendingMinutes > 0
                    ? t("{duration} of hours waiting on review", {
                        duration: formatMinutes(summary.pendingMinutes),
                      })
                    : t("No hours waiting on review")}
                </span>
              </li>
              <li>
                <ShieldCheck size={14} aria-hidden="true" />
                <span>
                  {expiring.length > 0
                    ? t("{count} credential needs renewal", { count: expiring.length })
                    : t("Credentials are current")}
                </span>
              </li>
              <li>
                <CalendarDays size={14} aria-hidden="true" />
                <span>{upcoming.length} upcoming shifts across the team</span>
              </li>
            </ul>
            <div className={styles.cardAction}>
              <ButtonLink to="/volunteer/schedule" variant="secondary" size="small">
                View my schedule
              </ButtonLink>
            </div>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

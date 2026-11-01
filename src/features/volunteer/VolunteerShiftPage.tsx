import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import {
  Accessibility,
  CalendarPlus,
  Check,
  ChevronLeft,
  ClipboardList,
  Clock3,
  Copy,
  FileCheck2,
  MapPin,
  MessageSquare,
} from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Page,
  Tabs,
} from "../../components/ui";
import {
  CAUSE_LABELS,
  currentVolunteer,
  formatDate,
  formatLongDate,
  formatMinutes,
  formatTime,
  getRoster,
  opportunityById,
  shiftById,
  shiftMinutes,
  timeRange,
} from "../../lib/workspace/selectors";
import { downloadFile } from "../../lib/download";
import { t } from "../../lib/i18n";
import { useAuth } from "../../lib/auth/session";
import { currentOrganizationFor } from "../../lib/organizations/store";
import { useCheckinWindow } from "../../lib/workspace/queries";
import { useWorkspace } from "../../lib/workspace/session";
import type { Cause, Shift } from "../../types/domain";
import styles from "./VolunteerShiftPage.module.css";
import { messageOf } from "../../lib/errors";

const TASKS: Record<Cause, string[]> = {
  food: [
    "Pack produce and shelf-stable boxes for the day's pickups.",
    "Welcome families and help them choose what they need.",
    "Keep tables stocked, labeled, and easy to reach.",
    "Reset the distribution floor and break down boxes at the end.",
  ],
  education: [
    "Set up a quiet table with books and learning materials.",
    "Work one-to-one with a student on the day's reading or math goal.",
    "Note progress so the next tutor can pick up where you left off.",
    "Pack materials away and leave the room ready for the next session.",
  ],
  environment: [
    "Collect tools and assign a simple task to each volunteer.",
    "Clear beds, plant, mulch, or repair paths with the team.",
    "Sort green waste and return shared tools to the shed.",
    "Photograph the finished work so the coordinator can log the impact.",
  ],
  health: [
    "Check the route sheet and load meals safely for delivery.",
    "Knock, greet each neighbour, and hand off meals with a warm check-in.",
    "Flag any concern to the coordinator before leaving the route.",
    "Return coolers and route sheets to the pickup point.",
  ],
  community: [
    "Help set up tables, signage, and supplies for the event.",
    "Greet neighbours and explain the activity or project.",
    "Support the activity lead and keep the space safe and tidy.",
    "Pack down equipment and leave the site cleaner than you found it.",
  ],
  animals: [
    "Prepare kennels, bedding, and enrichment supplies.",
    "Spend calm, supervised time with animals who need socialisation.",
    "Keep intake notes and supply counts up to date.",
    "Clean shared areas and restock the next shift's station.",
  ],
};

const CHECKLIST = [
  { id: "training", label: "Training complete", hint: "Volunteer orientation and role briefing" },
  { id: "shoes", label: "Closed-toe shoes", hint: "Required on the distribution floor" },
  { id: "water", label: "Water bottle", hint: "Refill stations are available on site" },
  { id: "photo-id", label: "Photo ID", hint: "Used once for check-in verification" },
] as const;

const TAB_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "bring", label: "What to Bring" },
  { id: "accessibility", label: "Accessibility" },
  { id: "location", label: "Location" },
  { id: "organization", label: "Organization" },
];

function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function calendarStamp(iso: string): string {
  return format(parseISO(iso), "yyyyMMdd'T'HHmmss");
}

function buildCalendar(shift: Shift, title: string, location: string, timezone: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CivicFlow//Volunteer shift//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${shift.id}@civicflow.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;TZID=${timezone}:${calendarStamp(shift.startsAt)}`,
    `DTEND;TZID=${timezone}:${calendarStamp(shift.endsAt)}`,
    `SUMMARY:${escapeCalendarText(title)}`,
    `LOCATION:${escapeCalendarText(location)}`,
    `DESCRIPTION:${escapeCalendarText(
      "Volunteer shift scheduled in CivicFlow. Arrive 15 minutes early and bring a water bottle.",
    )}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function VolunteerShiftPage() {
  const { id } = useParams();
  const { workspace, session, actions } = useWorkspace();
  const { user } = useAuth();
  const navigate = useNavigate();
  const volunteer = currentVolunteer(workspace);
  const shift = id ? shiftById(id, workspace) : undefined;
  const opportunity = shift ? opportunityById(shift.opportunityId, workspace) : undefined;
  const [checks, setChecks] = useState<Record<string, boolean>>({
    training: false,
    shoes: false,
    water: false,
    "photo-id": false,
  });
  const [tab, setTab] = useState("overview");
  const [calendarMessage, setCalendarMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const { data: checkinWindow } = useCheckinWindow(shift?.id ?? "");

  if (!shift || !opportunity) {
    return (
      <Page width="narrow">
        <EmptyState
          title="That shift is no longer available"
          copy="It may have been canceled or the link may be out of date. Your schedule has the latest confirmed shifts."
          action={<ButtonLink to="/volunteer/schedule">Back to my schedule</ButtonLink>}
        />
      </Page>
    );
  }

  const roster = getRoster(shift.id, session, workspace);
  const myRosterRow = roster.find((row) => row.volunteer.id === volunteer.id);
  const status = myRosterRow?.status ?? "confirmed";
  const checkedCount = CHECKLIST.filter((item) => checks[item.id]).length;
  const startsAt = parseISO(shift.startsAt);
  const checkInOpen = checkinWindow?.canSelfCheckIn ?? false;
  const tasks = TASKS[opportunity.cause];
  const organization = user ? currentOrganizationFor(user.email) : null;
  const orgName = organization?.name ?? workspace.organization.name;
  const orgMission = organization?.description ?? workspace.organization.mission;
  const orgCity = organization?.city ?? workspace.organization.city;
  const orgState = organization?.state ?? workspace.organization.state;
  const orgWebsite = organization?.website ?? workspace.organization.website;
  const contactEmail = organization?.contactEmails[0] ?? workspace.organization.email;
  const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent(
    `Question about ${opportunity.title} on ${formatDate(shift.startsAt)}`,
  )}`;
  const arrivalTime = formatTime(new Date(startsAt.getTime() - 15 * 60_000).toISOString());
  const coordinatorInitials = opportunity.coordinator
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const statusLabel = t(
    status === "checked_in" ? "Checked in" : status === "completed" ? "Completed" : "Confirmed",
  );
  const statusTone = status === "checked_in" ? "cobalt" : status === "completed" ? "green" : "lime";

  const activeShift = shift;
  const activeOpportunity = opportunity;

  function downloadCalendar() {
    const calendar = buildCalendar(
      activeShift,
      `${activeOpportunity.title} — CivicFlow volunteer shift`,
      activeOpportunity.address,
      workspace.organization.timezone,
    );
    downloadFile(
      `civicflow-${activeOpportunity.slug}-${activeShift.startsAt.slice(0, 10)}.ics`,
      calendar,
      "text/calendar;charset=utf-8",
    );
    setCalendarMessage("Calendar file downloaded. Open it to add this shift to your calendar.");
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(activeOpportunity.address);
      setCopyMessage("Address copied to your clipboard.");
    } catch {
      setCopyMessage("Copy failed. The address is shown above.");
    }
  }

  async function cancelSpot() {
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    try {
      await actions.cancelRegistration(activeShift.id, volunteer.id, "Canceled from shift detail");
      navigate("/volunteer/schedule", { replace: true });
    } catch (caught) {
      setCancelError(messageOf(caught));
      setCancelArmed(false);
    }
  }

  return (
    <Page>
      <div className={styles.crumbs}>
        <Link to="/volunteer/schedule">
          <ChevronLeft size={13} aria-hidden="true" />
          My schedule
        </Link>
        <span aria-hidden="true">/</span>
        <span>Shift detail</span>
      </div>

      <section className={styles.hero} aria-labelledby="shift-title">
        <img className={styles.heroImage} src={opportunity.image} alt={opportunity.imageAlt} />
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <div className={styles.heroTop}>
            <Badge tone={statusTone} dot onMedia>
              {statusLabel}
            </Badge>
            <span className={styles.heroCause}>{CAUSE_LABELS[opportunity.cause]}</span>
          </div>
          <h1 className={styles.heroTitle} id="shift-title">
            {opportunity.title}
          </h1>
          <p className={styles.heroMeta}>
            {orgName} · {formatLongDate(shift.startsAt)} · {timeRange(shift.startsAt, shift.endsAt)}
          </p>
          <p className={styles.heroLocation}>
            <MapPin size={14} aria-hidden="true" />
            {opportunity.address} · {opportunity.distanceMiles} miles away
          </p>
        </div>
        <div className={styles.heroActions}>
          <Button variant="lime" icon={<CalendarPlus size={14} />} onClick={downloadCalendar}>
            Add to calendar
          </Button>
          {!checkinWindow ? null : checkInOpen ? (
            <ButtonLink to="/volunteer/check-in" variant="primary" icon={<FileCheck2 size={14} />}>
              Check in
            </ButtonLink>
          ) : (
            <Button
              variant="secondary"
              className={styles.heroNote}
              icon={<Clock3 size={14} />}
              disabled
              title={
                checkinWindow.status === "not_open"
                  ? `${t("Check-in opens")} ${formatTime(checkinWindow.opensAt)}`
                  : t("Check-in closed")
              }
            >
              {checkinWindow.status === "not_open"
                ? `${t("Check-in opens")} ${formatTime(checkinWindow.opensAt)}`
                : t("Check-in closed")}
            </Button>
          )}
        </div>
        <p className="visually-hidden" aria-live="polite">
          {calendarMessage}
        </p>
      </section>

      <div className={styles.grid}>
        <Card className={styles.panel}>
          <h2 className={styles.panelTitle}>Get Ready</h2>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>
                <span className={styles.factDot} data-tone="cobalt" aria-hidden="true" />
                Arrive by
              </dt>
              <dd>
                {arrivalTime}
                <span className={styles.factNote}>15 minutes early</span>
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <span className={styles.factDot} data-tone="teal" aria-hidden="true" />
                Location
              </dt>
              <dd>{opportunity.address}</dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <span className={styles.factDot} data-tone="violet" aria-hidden="true" />
                Coordinator
              </dt>
              <dd>{opportunity.coordinator}</dd>
            </div>
            <div className={styles.fact}>
              <dt>
                <span className={styles.factDot} data-tone="coral" aria-hidden="true" />
                Your role
              </dt>
              <dd>
                {myRosterRow?.role ?? "General support"}
                <span className={styles.factNote}>{formatMinutes(shiftMinutes(shift))} shift</span>
              </dd>
            </div>
          </dl>
          <div className={styles.panelActions}>
            <Button
              variant="secondary"
              size="small"
              icon={<CalendarPlus size={13} />}
              onClick={downloadCalendar}
            >
              Add to calendar
            </Button>
            <Button variant="ghost" size="small" icon={<Copy size={13} />} onClick={copyAddress}>
              Copy address
            </Button>
            {status === "confirmed" || status === "expected" ? (
              <Button variant="ghost" size="small" onClick={() => void cancelSpot()}>
                {t(cancelArmed ? "Confirm cancellation" : "Cancel my spot")}
              </Button>
            ) : null}
          </div>
          <p className={styles.srStatus} aria-live="polite">
            {calendarMessage}
            {copyMessage ? ` ${copyMessage}` : ""}
            {cancelError}
          </p>
        </Card>

        <Card className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Checklist</h2>
            <span className={styles.progressLabel}>
              {checkedCount} of {CHECKLIST.length}
            </span>
          </div>
          <div className={styles.progressTrack} aria-hidden="true">
            <span style={{ width: `${(checkedCount / CHECKLIST.length) * 100}%` }} />
          </div>
          <ul className={styles.checklist}>
            {CHECKLIST.map((item) => (
              <li key={item.id}>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={checks[item.id]}
                    onChange={(event) =>
                      setChecks((current) => ({ ...current, [item.id]: event.target.checked }))
                    }
                  />
                  <span className={styles.checkBoxVisual} aria-hidden="true">
                    {checks[item.id] ? <Check size={12} strokeWidth={2.6} /> : null}
                  </span>
                  <span className={styles.checkCopy}>
                    <span className={styles.checkLabel}>{t(item.label)}</span>
                    <span className={styles.checkHint}>{t(item.hint)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.checkNote}>
            Checks stay in this session only. They are a preparation aid, not attendance evidence.
          </p>
        </Card>

        <Card className={styles.panel}>
          <h2 className={styles.panelTitle}>Need help?</h2>
          <div className={styles.helpPerson}>
            <Avatar
              initials={coordinatorInitials}
              tone="teal"
              size={36}
              label={opportunity.coordinator}
            />
            <div>
              <p className={styles.helpName}>{opportunity.coordinator}</p>
              <p className={styles.helpRole}>Shift coordinator</p>
            </div>
          </div>
          <p className={styles.helpCopy}>
            Questions about the work, arrival, or an accommodation? Message the coordinator before
            the shift and include the date so it is easy to find.
          </p>
          <Button
            variant="primary"
            icon={<MessageSquare size={14} />}
            className={styles.fullWidth}
            onClick={() => {
              window.location.href = mailto;
            }}
          >
            Message coordinator
          </Button>
          <ButtonLink
            to="/volunteer/schedule"
            variant="secondary"
            className={styles.fullWidth}
            icon={<ClipboardList size={14} />}
          >
            All my shifts
          </ButtonLink>
          <p className={styles.replyNote}>Typical reply: one business day.</p>
        </Card>
      </div>

      <Card className={styles.detailCard}>
        <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} label="Shift details" />
        <div
          className={styles.tabPanel}
          role="tabpanel"
          aria-label={TAB_ITEMS.find((item) => item.id === tab)?.label}
        >
          {tab === "overview" ? (
            <div className={styles.overviewGrid}>
              <div>
                <h2 className={styles.detailTitle}>What you&apos;ll do</h2>
                <p className={styles.detailIntro}>{opportunity.description}</p>
                <ul className={styles.taskList}>
                  {tasks.map((task) => (
                    <li key={task}>
                      <span className={styles.taskDot} aria-hidden="true" />
                      {task}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={styles.overviewAside}>
                <figure className={styles.photoFigure}>
                  <img src={opportunity.image} alt={opportunity.imageAlt} />
                  <figcaption>{opportunity.impactMetric}</figcaption>
                </figure>
                <ul className={styles.accessSummary}>
                  <li>
                    <Accessibility size={14} aria-hidden="true" />
                    Step-free entrance and accessible restrooms
                  </li>
                  <li>
                    <Check size={14} aria-hidden="true" />
                    Seated tasks available on request
                  </li>
                  <li>
                    <Check size={14} aria-hidden="true" />
                    Quiet break area away from the main floor
                  </li>
                </ul>
              </div>
            </div>
          ) : null}

          {tab === "bring" ? (
            <div className={styles.detailColumns}>
              <div>
                <h2 className={styles.detailTitle}>What to bring</h2>
                <p className={styles.detailIntro}>
                  Wear comfortable clothes you can move in. Everything else is provided on site.
                </p>
                <ul className={styles.bringList}>
                  {[
                    ...opportunity.training,
                    ...opportunity.requirements,
                    "Photo ID",
                    "Water bottle",
                  ].map((item) => (
                    <li key={item}>
                      <span className={styles.checkCircle} aria-hidden="true">
                        <Check size={11} strokeWidth={2.8} />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={styles.infoPanel}>
                <h3 className={styles.infoTitle}>Before you arrive</h3>
                <p>
                  Complete the online orientation in your profile. If your plans change, cancel at
                  least 24 hours ahead so the coordinator can offer the seat to the waitlist.
                </p>
                <ButtonLink to="/volunteer/profile" variant="secondary" size="small">
                  Review my profile
                </ButtonLink>
              </div>
            </div>
          ) : null}

          {tab === "accessibility" ? (
            <div className={styles.detailColumns}>
              <div>
                <h2 className={styles.detailTitle}>Accessibility at this site</h2>
                <p className={styles.detailIntro}>
                  The coordinator can adjust tasks, timing, and seating. Ask for what you need; no
                  explanation is required.
                </p>
                <div className={styles.disclosureList}>
                  <details open>
                    <summary>Getting into the building</summary>
                    <p>
                      Step-free entrance with a power-assisted door. An accessible restroom is on
                      the same floor as the volunteering area.
                    </p>
                  </details>
                  <details>
                    <summary>Tasks and sensory needs</summary>
                    <p>
                      Seated intake, sorting, and greeting roles are available. A quieter break room
                      is available; noise-canceling headphones can be borrowed at the check-in desk.
                    </p>
                  </details>
                  <details>
                    <summary>Interpretation and service animals</summary>
                    <p>
                      Spanish interpretation is available on most shifts. Request ASL interpretation
                      at least five days ahead through the coordinator. Service animals are welcome.
                    </p>
                  </details>
                </div>
              </div>
              <div className={styles.infoPanel}>
                <h3 className={styles.infoTitle}>Request an adjustment</h3>
                <p>
                  Message {opportunity.coordinator} with the shift date and what would help.
                  Requests are kept private from other volunteers.
                </p>
                <Button
                  variant="secondary"
                  size="small"
                  icon={<MessageSquare size={13} />}
                  onClick={() => {
                    window.location.href = mailto;
                  }}
                >
                  Contact coordinator
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "location" ? (
            <div className={styles.detailColumns}>
              <div>
                <h2 className={styles.detailTitle}>Getting there</h2>
                <dl className={styles.locationFacts}>
                  <div>
                    <dt>Address</dt>
                    <dd>{opportunity.address}</dd>
                  </div>
                  <div>
                    <dt>Arrival</dt>
                    <dd>
                      {arrivalTime} · enter through the volunteer door and check in at the desk
                    </dd>
                  </div>
                  <div>
                    <dt>Parking</dt>
                    <dd>Free lot behind the building; street parking nearby after 8:00 AM.</dd>
                  </div>
                  <div>
                    <dt>Transit</dt>
                    <dd>NFTA Route 6 stops two blocks north; the entrance is step-free.</dd>
                  </div>
                </dl>
              </div>
              <div className={styles.infoPanel}>
                <MapPin size={22} aria-hidden="true" />
                <h3 className={styles.infoTitle}>{opportunity.distanceMiles} miles from you</h3>
                <p>{opportunity.address}</p>
                <Button
                  variant="secondary"
                  size="small"
                  icon={<Copy size={13} />}
                  onClick={copyAddress}
                >
                  Copy address
                </Button>
                <p className={styles.replyNote} aria-live="polite">
                  {copyMessage}
                </p>
              </div>
            </div>
          ) : null}

          {tab === "organization" ? (
            <div className={styles.detailColumns}>
              <div>
                <h2 className={styles.detailTitle}>{orgName}</h2>
                <p className={styles.detailIntro}>{orgMission}</p>
                <dl className={styles.locationFacts}>
                  <div>
                    <dt>Based in</dt>
                    <dd>
                      {orgCity}, {orgState}
                    </dd>
                  </div>
                  <div>
                    <dt>Website</dt>
                    <dd>
                      <a
                        href={`https://${orgWebsite}`}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.inlineLink}
                      >
                        {orgWebsite}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Contact</dt>
                    <dd>
                      <a href={mailto} className={styles.inlineLink}>
                        {contactEmail}
                      </a>
                    </dd>
                  </div>
                </dl>
              </div>
              <div className={styles.infoPanel}>
                <h3 className={styles.infoTitle}>Verified organization</h3>
                <p>
                  Shift details, roles, and hours are managed locally by CivicFlow. Only approved
                  hours appear on a service verification record.
                </p>
                <ButtonLink to="/volunteer/verification" variant="secondary" size="small">
                  View service record
                </ButtonLink>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </Page>
  );
}

import { useMemo, useState } from "react";
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bookmark,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Mail,
  MapPin,
  Navigation,
  Share2,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Page,
  PageHeader,
  ProgressBar,
  SelectField,
  Tabs,
} from "../../components/ui";
import type { TabItem } from "../../components/ui";
import { t } from "../../lib/i18n";
import {
  CAUSE_LABELS,
  currentVolunteer,
  fillPercent,
  formatDate,
  formatTime,
  getMatches,
  getOpportunities,
  getOrganizationImages,
  getShiftRowsForOpportunity,
  relativeDayLabel,
  shiftMinutes,
  timeRange,
} from "../../lib/workspace/selectors";
import { useWorkspace } from "../../lib/workspace/session";
import styles from "./OpportunityDetailPage.module.css";
import { messageOf } from "../../lib/errors";

type TabKey = "overview" | "shifts" | "location" | "organization";

const TABS: TabItem[] = [
  { id: "overview", label: "Overview" },
  { id: "shifts", label: "Roles & shifts" },
  { id: "location", label: "Location" },
  { id: "organization", label: "Organization" },
];

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(field);
      return copied;
    } catch {
      return false;
    }
  }
}

export function OpportunityDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { workspace, session, actions } = useWorkspace();
  const volunteer = currentVolunteer(workspace);
  const opportunities = getOpportunities(session, workspace);
  const opportunity = opportunities.find((item) => item.slug === slug);

  const [tab, setTab] = useState<TabKey>("overview");
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");
  const [addressState, setAddressState] = useState<"idle" | "copied" | "failed">("idle");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [role, setRole] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const shifts = useMemo(
    () =>
      opportunity
        ? getShiftRowsForOpportunity(opportunity.id, workspace).filter(
            (row) => row.shift.status === "scheduled" && row.shift.startsAt > workspace.now,
          )
        : [],
    [opportunity, workspace],
  );

  const activeShift =
    shifts.find((row) => row.shift.id === selectedShiftId)?.shift ?? shifts[0]?.shift;
  const roles = activeShift?.roles.filter((item) => item.filled < item.required) ?? [];
  const roleOptions =
    roles.length > 0
      ? roles.map((item) => item.name)
      : (activeShift?.roles.map((item) => item.name) ?? ["General support"]);
  const effectiveRole = roleOptions.includes(role) ? role : (roleOptions[0] ?? "General support");
  const spotsOpen = activeShift ? Math.max(0, activeShift.capacity - activeShift.confirmed) : 0;
  const isFull = Boolean(activeShift && spotsOpen === 0);
  const registration = activeShift
    ? session.registrations.find(
        (row) => row.shiftId === activeShift.id && row.volunteerId === volunteer.id,
      )
    : undefined;
  const isRegistered = Boolean(registration);
  // A full shift can be joined once. The button says so afterwards instead of
  // inviting the same click again.
  const isWaitlisted = Boolean(
    activeShift &&
    session.waitlist.some(
      (row) =>
        row.shiftId === activeShift.id &&
        row.volunteerId === volunteer.id &&
        row.status === "waiting",
    ),
  );
  const saved = opportunity ? session.savedOpportunityIds.includes(opportunity.id) : false;
  const match = opportunity
    ? getMatches(volunteer, 20, workspace, session.createdOpportunities).find(
        (row) => row.opportunity.id === opportunity.id,
      )
    : undefined;
  const matchScore = match?.score ?? 68;
  const matchReasons =
    match?.reasons && match.reasons.length > 0
      ? match.reasons
      : [
          t("Open to volunteers with your profile"),
          t("Upcoming shifts fit a weekday schedule"),
          t("Orientation is provided before the first shift"),
        ];
  const gallery = getOrganizationImages().slice(1, 4);

  if (!opportunity) {
    return (
      <Page>
        <PageHeader
          backTo="/volunteer/discover"
          backLabel="Back to discover"
          eyebrow="Opportunity"
          title="This opportunity has moved"
          description="The link may be out of date, or the program has been archived. Browse current opportunities to find a shift that fits."
        />
        <Card padding="loose">
          <EmptyState
            title="Opportunity not found"
            copy="We could not find a program with this address. Everything on this device is up to date."
            action={<ButtonLink to="/volunteer/discover">Browse opportunities</ButtonLink>}
          />
        </Card>
      </Page>
    );
  }

  async function handleShare() {
    const result = await copyText(window.location.href);
    setShareState(result ? "copied" : "failed");
    if (result) setConfirmation(t("Link copied to your clipboard."));
  }

  async function handleCopyAddress() {
    if (!opportunity) return;
    const result = await copyText(opportunity.address);
    setAddressState(result ? "copied" : "failed");
    if (result) setConfirmation("Address copied to your clipboard.");
  }

  async function handleSignUp() {
    if (!opportunity || !activeShift) return;
    try {
      await actions.registerForShift(activeShift.id, volunteer.id, effectiveRole);
      setConfirmation(
        `You're signed up for ${formatDate(activeShift.startsAt)} as ${effectiveRole.toLowerCase()}.`,
      );
    } catch (caught) {
      setConfirmation(messageOf(caught));
    }
  }

  async function handleJoinWaitlist() {
    if (!opportunity || !activeShift) return;
    try {
      await actions.joinWaitlist(activeShift.id, volunteer.id, effectiveRole);
      setConfirmation(
        `You're on the waitlist for ${formatDate(activeShift.startsAt)}. We'll notify you if a seat opens.`,
      );
    } catch (caught) {
      setConfirmation(messageOf(caught));
    }
  }

  function handleSave() {
    if (!opportunity) return;
    actions.setSaved(opportunity.id, !saved);
    setConfirmation(
      t(saved ? "Removed from saved opportunities." : "Saved to your opportunities."),
    );
  }

  function chooseShift(shiftId: string) {
    setSelectedShiftId(shiftId);
    setRole("");
    setConfirmation("");
  }

  return (
    <Page>
      <section className={styles.hero} aria-labelledby="opportunity-title">
        <img className={styles.heroImage} src={opportunity.image} alt={opportunity.imageAlt} />
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroTop}>
          <Link className={styles.backLink} to="/volunteer/discover">
            <ArrowLeft size={13} aria-hidden="true" />
            Discover
          </Link>
          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.heroAction}
              aria-pressed={saved}
              onClick={handleSave}
            >
              <Bookmark size={14} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
              {t(saved ? "Saved" : "Save")}
            </button>
            <button type="button" className={styles.heroAction} onClick={handleShare}>
              {shareState === "copied" ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Share2 size={14} aria-hidden="true" />
              )}
              {t(shareState === "copied" ? "Copied" : "Share")}
            </button>
          </div>
        </div>

        <div className={styles.heroBody}>
          <div className={styles.heroBadges}>
            <Badge tone="lime" dot onMedia>
              {CAUSE_LABELS[opportunity.cause]}
            </Badge>
            <span className={styles.verified}>
              <BadgeCheck size={13} aria-hidden="true" />
              Verified partner
            </span>
          </div>
          <h1 className={styles.heroTitle} id="opportunity-title">
            {opportunity.title}
          </h1>
          <p className={styles.heroOrg}>
            {opportunity.organization} · {opportunity.address}
          </p>
        </div>

        <div className={styles.factStrip}>
          <div className={styles.fact}>
            <CalendarDays size={14} aria-hidden="true" />
            <span>
              <span className={styles.factLabel}>Next shift</span>
              <span className={styles.factValue}>
                {activeShift
                  ? `${formatDate(activeShift.startsAt)} · ${formatTime(activeShift.startsAt)}`
                  : "No upcoming shifts"}
              </span>
            </span>
          </div>
          <div className={styles.fact}>
            <Clock3 size={14} aria-hidden="true" />
            <span>
              <span className={styles.factLabel}>Time commitment</span>
              <span className={styles.factValue}>
                {activeShift
                  ? `${Math.round(shiftMinutes(activeShift) / 60)} hours`
                  : opportunity.duration}
              </span>
            </span>
          </div>
          <div className={styles.fact}>
            <MapPin size={14} aria-hidden="true" />
            <span>
              <span className={styles.factLabel}>Distance</span>
              <span className={styles.factValue}>
                {opportunity.distanceMiles.toFixed(1)} mi from downtown
              </span>
            </span>
          </div>
          <Link className={styles.creditLink} to="/credits">
            Photo credit
          </Link>
        </div>
      </section>

      <p className={styles.liveRegion} role="status" aria-live="polite">
        {confirmation}
        {shareState === "failed" ? "Copy failed. Select the address to copy it manually." : ""}
        {addressState === "failed" ? "Copy failed. Select the address to copy it manually." : ""}
      </p>

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <Card className={styles.tabCard} padding="compact">
            <Tabs
              items={TABS}
              value={tab}
              onChange={(value) => setTab(value as TabKey)}
              label="Opportunity sections"
            />
            <div
              className={styles.tabContent}
              role="tabpanel"
              aria-label={String(
                TABS.find((item) => item.id === tab)?.label ?? t("Opportunity section"),
              )}
            >
              {tab === "overview" ? (
                <div className={styles.overview}>
                  <div>
                    <h2 className={styles.sectionHeading}>About this opportunity</h2>
                    <p className={styles.bodyCopy}>{opportunity.description}</p>
                    <p className={styles.bodyCopy}>
                      You will serve alongside {opportunity.coordinator} and a team of neighbors.
                      CivicFlow confirms your seat before you arrive, and the shift lead can see
                      only what is needed to welcome you.
                    </p>
                  </div>

                  <div className={styles.impactNote}>
                    <span className={styles.impactIcon} aria-hidden="true">
                      <Check size={15} />
                    </span>
                    <div>
                      <p className={styles.impactLabel}>Impact of this program</p>
                      <p className={styles.impactValue}>{opportunity.impactMetric}</p>
                    </div>
                  </div>

                  <div className={styles.twoColumn}>
                    <div>
                      <h3 className={styles.subheading}>What to expect</h3>
                      <ul className={styles.checkList}>
                        <li>
                          <Check size={14} aria-hidden="true" />
                          Arrive 10 minutes early for a short orientation.
                        </li>
                        <li>
                          <Check size={14} aria-hidden="true" />
                          Wear closed-toe shoes; everything else is provided on site.
                        </li>
                        <li>
                          <Check size={14} aria-hidden="true" />
                          Your shift lead confirms hours after check-out.
                        </li>
                        <li>
                          <Check size={14} aria-hidden="true" />
                          Bring water; indoor space is available for breaks.
                        </li>
                      </ul>
                    </div>
                    <div>
                      <h3 className={styles.subheading}>Requirements & training</h3>
                      <div className={styles.chipRow}>
                        {opportunity.requirements.map((requirement) => (
                          <span key={requirement} className={styles.chip}>
                            {requirement}
                          </span>
                        ))}
                        {opportunity.training.map((training) => (
                          <span key={training} className={styles.chip}>
                            {training}
                          </span>
                        ))}
                      </div>
                      <p className={styles.requirementNote}>
                        No prior experience required. Minors under 16 must be accompanied by a
                        guardian; the coordinator will confirm details by email.
                      </p>
                    </div>
                  </div>

                  <div>
                    <h3 className={styles.subheading}>Moments from this program</h3>
                    <div className={styles.gallery}>
                      {gallery.map((image, index) => (
                        <figure className={styles.galleryItem} key={image}>
                          <img
                            src={image}
                            alt={
                              [
                                t("Volunteers preparing food together at a community site"),
                                t("A volunteer reading with a student at the library"),
                                t("Garden volunteers tending raised beds"),
                              ][index]
                            }
                          />
                          <figcaption>
                            {
                              [
                                t("Food distribution"),
                                t("Library tutoring"),
                                t("Garden restoration"),
                              ][index]
                            }
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "shifts" ? (
                <div className={styles.shiftsPanel}>
                  <div className={styles.panelIntro}>
                    <div>
                      <h2 className={styles.sectionHeading}>Upcoming shifts</h2>
                      <p className={styles.panelCopy}>
                        Pick a date that works. Times are local to {workspace.organization.city}.
                        Seats update as soon as a volunteer confirms.
                      </p>
                    </div>
                    <Badge tone="neutral">{shifts.length} scheduled</Badge>
                  </div>
                  {shifts.length === 0 ? (
                    <EmptyState
                      title="No shifts on the calendar"
                      copy="This program has no upcoming dates. Save it and we will surface the next opening."
                    />
                  ) : (
                    <ul className={styles.shiftList}>
                      {shifts.map(({ shift }) => {
                        const open = shift.capacity - shift.confirmed;
                        const missing = shift.roles.filter((item) => item.filled < item.required);
                        return (
                          <li className={styles.shiftRow} key={shift.id}>
                            <div className={styles.shiftDate}>
                              <span>{formatDate(shift.startsAt)}</span>
                              <span>{relativeDayLabel(shift.startsAt, workspace.now)}</span>
                            </div>
                            <div className={styles.shiftTimes}>
                              <strong>{timeRange(shift.startsAt, shift.endsAt)}</strong>
                              <span>
                                {missing.length > 0
                                  ? t("{roles} needed", {
                                      roles: missing.map((item) => item.name).join(" · "),
                                    })
                                  : t("All roles filled")}
                              </span>
                            </div>
                            <div className={styles.shiftRoleList}>
                              {shift.roles.map((item) => (
                                <span key={item.name}>
                                  {item.name} {item.filled}/{item.required}
                                </span>
                              ))}
                            </div>
                            <div className={styles.shiftAction}>
                              <Badge tone={open > 0 ? "green" : "neutral"}>
                                {open > 0
                                  ? t(open === 1 ? "{count} seat" : "{count} seats", {
                                      count: open,
                                    })
                                  : t("Full")}
                              </Badge>
                              <Button
                                size="small"
                                variant={shift.id === activeShift?.id ? "primary" : "secondary"}
                                onClick={() => chooseShift(shift.id)}
                                disabled={open === 0}
                              >
                                {shift.id === activeShift?.id ? "Selected" : "Select"}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}

              {tab === "location" ? (
                <div className={styles.locationPanel}>
                  <div>
                    <h2 className={styles.sectionHeading}>Where to go</h2>
                    <p className={styles.panelCopy}>
                      Check in at the volunteer entrance. Parking is free in the lot behind the
                      building; local bus routes stop two blocks away.
                    </p>
                    <dl className={styles.addressList}>
                      <div>
                        <dt>Address</dt>
                        <dd>{opportunity.address}</dd>
                      </div>
                      <div>
                        <dt>Arrive by</dt>
                        <dd>
                          {activeShift ? formatTime(activeShift.startsAt) : "Shift start"} · 10
                          minutes early
                        </dd>
                      </div>
                      <div>
                        <dt>Entrance</dt>
                        <dd>Volunteer door on the east side, marked with a lime CivicFlow sign.</dd>
                      </div>
                      <div>
                        <dt>Accessibility</dt>
                        <dd>
                          Step-free entrance, accessible restroom, and quiet break room on site.
                        </dd>
                      </div>
                    </dl>
                    <div className={styles.locationActions}>
                      <Button
                        variant="secondary"
                        icon={<Copy size={14} aria-hidden="true" />}
                        onClick={handleCopyAddress}
                      >
                        {addressState === "copied" ? "Address copied" : "Copy address"}
                      </Button>
                      <a
                        className={styles.textLink}
                        href={`mailto:${workspace.organization.email}?subject=${encodeURIComponent(`Directions to ${opportunity.title}`)}`}
                      >
                        <Mail size={13} aria-hidden="true" />
                        Ask the coordinator
                      </a>
                    </div>
                  </div>
                  <div
                    className={styles.map}
                    role="img"
                    aria-label={`Stylized map showing ${opportunity.address}`}
                  >
                    <div className={styles.mapGrid} aria-hidden="true" />
                    <span className={styles.mapRoad} aria-hidden="true" />
                    <span className={styles.mapRiver} aria-hidden="true" />
                    <span className={styles.mapPin}>
                      <MapPin size={18} aria-hidden="true" />
                    </span>
                    <span className={styles.mapLabel}>{opportunity.organization}</span>
                    <span className={styles.mapCaption}>
                      <Navigation size={12} aria-hidden="true" />
                      {opportunity.distanceMiles.toFixed(1)} mi · {workspace.organization.city},{" "}
                      {workspace.organization.state}
                    </span>
                  </div>
                </div>
              ) : null}

              {tab === "organization" ? (
                <div className={styles.organizationPanel}>
                  <div className={styles.orgHeading}>
                    <span className={styles.orgMark} aria-hidden="true">
                      {workspace.organization.initials}
                    </span>
                    <div>
                      <h2 className={styles.sectionHeading}>{opportunity.organization}</h2>
                      <p className={styles.panelCopy}>
                        Verified nonprofit partner · {workspace.organization.city},{" "}
                        {workspace.organization.state}
                      </p>
                    </div>
                    <Badge tone="green" icon={<BadgeCheck size={12} aria-hidden="true" />}>
                      Verified
                    </Badge>
                  </div>
                  <p className={styles.bodyCopy}>{workspace.organization.mission}</p>
                  <dl className={styles.orgFacts}>
                    <div>
                      <dt>Website</dt>
                      <dd>{workspace.organization.website}</dd>
                    </div>
                    <div>
                      <dt>Contact</dt>
                      <dd>{workspace.organization.email}</dd>
                    </div>
                    <div>
                      <dt>Service area</dt>
                      <dd>
                        {workspace.organization.city}, {workspace.organization.state}
                      </dd>
                    </div>
                    <div>
                      <dt>Time zone</dt>
                      <dd>{workspace.organization.timezone.replace("_", " ")}</dd>
                    </div>
                  </dl>
                  <div className={styles.orgLinks}>
                    <a
                      className={styles.textLink}
                      href={`https://${workspace.organization.website}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                      Visit organization website
                    </a>
                    <Link className={styles.textLink} to="/volunteer/impact">
                      <ArrowRight size={13} aria-hidden="true" />
                      See community impact
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        </div>

        <aside className={styles.aside} aria-label="Sign up and match">
          <Card className={styles.signupCard} padding="compact">
            {isRegistered ? (
              <div className={styles.registeredBanner}>
                <CheckCircle2 size={16} aria-hidden="true" />
                <div>
                  <p className={styles.registeredTitle}>You&apos;re registered</p>
                  <p className={styles.registeredCopy}>
                    {activeShift
                      ? `${formatDate(activeShift.startsAt)} · ${timeRange(activeShift.startsAt, activeShift.endsAt)}`
                      : "Shift confirmed"}
                  </p>
                </div>
              </div>
            ) : (
              <div className={styles.signupIntro}>
                <p className={styles.eyebrow}>Sign up</p>
                <h2 className={styles.asideTitle}>Claim your seat</h2>
                <p className={styles.asideCopy}>
                  Your coordinator sees the seat immediately. You can change it from My Schedule.
                </p>
              </div>
            )}

            <SelectField
              label="Choose a shift"
              value={activeShift?.id ?? ""}
              onChange={(event) => chooseShift(event.target.value)}
              disabled={shifts.length === 0}
            >
              {shifts.length === 0 ? <option value="">No upcoming shifts</option> : null}
              {shifts.map(({ shift }) => (
                <option key={shift.id} value={shift.id}>
                  {formatDate(shift.startsAt)} · {timeRange(shift.startsAt, shift.endsAt)}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="Preferred role"
              value={effectiveRole}
              onChange={(event) => setRole(event.target.value)}
              hint={
                roles.length > 0
                  ? t("{roles} still needed", {
                      roles: roles.map((item) => item.name).join(", "),
                    })
                  : t("All roles are currently filled")
              }
            >
              {roleOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </SelectField>

            {activeShift ? (
              <div className={styles.spots}>
                <div className={styles.spotsRow}>
                  <span>
                    {t("{open} of {capacity} seats open", {
                      open: spotsOpen,
                      capacity: activeShift.capacity,
                    })}
                  </span>
                  <span>{t("{percent}% filled", { percent: fillPercent(activeShift) })}</span>
                </div>
                <ProgressBar
                  value={fillPercent(activeShift)}
                  tone={
                    spotsOpen === 0
                      ? "var(--color-red)"
                      : spotsOpen < 4
                        ? "var(--color-orange)"
                        : "var(--color-green)"
                  }
                  label="Seats filled"
                />
                <p className={styles.spotsMeta}>
                  {activeShift.waitlisted > 0
                    ? t("{count} on the waitlist · joined {date}", {
                        count: activeShift.waitlisted,
                        date: formatDate(activeShift.startsAt),
                      })
                    : t("Role needs: {roles}", {
                        roles: activeShift.roles
                          .map((item) => `${item.name} ${item.filled}/${item.required}`)
                          .join(" · "),
                      })}
                </p>
              </div>
            ) : null}

            <Button
              size="large"
              variant="primary"
              className={styles.signupButton}
              onClick={() => void handleSignUp()}
              disabled={!activeShift || isFull || isRegistered}
              icon={<ArrowRight size={15} aria-hidden="true" />}
            >
              {t(
                isRegistered ? "Seat confirmed" : isFull ? "Shift full" : "Sign up for this shift",
              )}
            </Button>

            {isFull && !isRegistered ? (
              <Button
                size="large"
                variant="secondary"
                className={styles.signupButton}
                onClick={() => void handleJoinWaitlist()}
                disabled={isWaitlisted}
              >
                {t(isWaitlisted ? "On the waitlist" : "Join the waitlist")}
              </Button>
            ) : null}

            {isRegistered ? (
              <div className={styles.registeredActions}>
                <ButtonLink to="/volunteer/schedule" size="small">
                  My schedule
                </ButtonLink>
                <ButtonLink to="/volunteer/check-in" size="small" variant="ghost">
                  Check in
                </ButtonLink>
              </div>
            ) : (
              <p className={styles.signupNote}>
                Free to cancel until 12 hours before the shift. No account fees, ever.
              </p>
            )}

            <div className={styles.contactRow}>
              <span className={styles.coordinatorAvatar} aria-hidden="true">
                {opportunity.coordinator
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <div className={styles.contactCopy}>
                <span className={styles.contactLabel}>Shift coordinator</span>
                <span className={styles.contactName}>{opportunity.coordinator}</span>
              </div>
              <a
                className={styles.contactLink}
                href={`mailto:${workspace.organization.email}?subject=${encodeURIComponent(`Question about ${opportunity.title}`)}`}
                aria-label={`Email ${opportunity.coordinator} about ${opportunity.title}`}
              >
                <Mail size={14} aria-hidden="true" />
              </a>
            </div>
          </Card>

          <Card padding="compact" className={styles.matchCard}>
            <div className={styles.matchHeader}>
              <div>
                <p className={styles.eyebrow}>Your match</p>
                <p className={styles.matchScore}>
                  {matchScore}
                  <span>%</span>
                </p>
              </div>
              <span className={styles.matchRing} aria-hidden="true">
                <Check size={16} />
              </span>
            </div>
            <p className={styles.matchCopy}>
              {t(
                matchScore >= 80
                  ? "Strong fit based on your skills, interests, and availability."
                  : "A good fit — one requirement can be learned on site.",
              )}
            </p>
            <ul className={styles.reasonList}>
              {matchReasons.map((reason) => (
                <li key={reason}>
                  <Check size={12} aria-hidden="true" />
                  {reason}
                </li>
              ))}
            </ul>
            <Link className={styles.matchLink} to="/volunteer/profile">
              Update your match profile
              <ArrowRight size={12} aria-hidden="true" />
            </Link>
            <p className={styles.matchNote}>
              Match is explainable, never automatic. You choose every shift.
            </p>
          </Card>

          <Card padding="compact" className={styles.accessCard}>
            <div className={styles.accessRow}>
              <Accessibility size={16} aria-hidden="true" />
              <div>
                <p className={styles.accessTitle}>Accessibility & support</p>
                <p className={styles.accessCopy}>
                  Step-free entrance, seated roles available, and interpreters on request. Tell us
                  what you need when you sign up.
                </p>
              </div>
            </div>
            <div className={styles.accessMeta}>
              <span>
                <Users size={12} aria-hidden="true" />
                Ages 16+
              </span>
              <span>
                <Clock3 size={12} aria-hidden="true" />
                Training included
              </span>
            </div>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

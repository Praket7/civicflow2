import { ArrowRight } from "lucide-react";
import { parseISO } from "date-fns";
import { Link } from "react-router-dom";
import type { MissionControlSummary } from "../../../types/domain";
import { t } from "../../../lib/i18n";
import { formatLongDate, formatTime, timeRange } from "../../../lib/workspace/selectors";
import { isDemoOrganization } from "../../../lib/workspace/organizationWorkspace";
import { useWorkspace } from "../../../lib/workspace/session";
import styles from "../MissionControl.module.css";

interface MissionHeroProps {
  data: MissionControlSummary;
}

function greetingFor(iso: string): string {
  const hour = parseISO(iso).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function MissionHero({ data }: MissionHeroProps) {
  const { workspace, session } = useWorkspace();
  const now = parseISO(data.now);
  const today = workspace.shifts.find(
    (shift) => shift.startsAt.slice(0, 10) === data.now.slice(0, 10),
  );
  const todayOpportunity = today
    ? [...workspace.opportunities, ...session.createdOpportunities].find(
        (row) => row.id === today.opportunityId,
      )
    : undefined;
  const greeting = t(greetingFor(data.now));
  const openToday = today ? timeRange(today.startsAt, today.endsAt) : t("No shift today");
  const organization = workspace.organization;
  const ownWorkspace = !isDemoOrganization(organization.id);
  // A real organization shows its own cover and its own name. The pantry photo
  // and its credit belong to the bundled demo, nothing else.
  const cover = ownWorkspace ? organization.image : undefined;
  const coverCaption = ownWorkspace
    ? [organization.name, [organization.city, organization.state].filter(Boolean).join(", ")]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <section className={styles.hero} aria-labelledby="mc-greeting">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>
          <span>{formatLongDate(now)}</span>
          <span className={styles.eyebrowRule} aria-hidden="true" />
          <span>Mission Control</span>
        </p>
        <h1 id="mc-greeting" className={styles.greeting}>
          {greeting}, {data.firstName}.
        </h1>
        <p className={styles.heroSub}>
          {todayOpportunity
            ? `${todayOpportunity.title} ${t("opens at")} ${formatTime(today!.startsAt)}. `
            : workspace.shifts.length === 0
              ? `${t("Nothing is scheduled yet.")} `
              : `${t("The next shift is on the schedule.")} `}
          {workspace.shifts.length === 0
            ? t("Publish a shift to start filling roles.")
            : data.attentionCount === 0
              ? t("Every role is covered this week.")
              : t(
                  data.attentionCount === 1
                    ? "{count} shift still needs people this week."
                    : "{count} shifts still need people this week.",
                  { count: data.attentionCount },
                )}
        </p>
        <p className={styles.heroMeta}>
          {data.organizationName}
          {workspace.organization.address ? ` · ${workspace.organization.address}` : null}
        </p>

        <div className={styles.heroActions}>
          <Link
            className={styles.primaryAction}
            to={data.attentionCount > 0 ? "/coordinator/autoroster" : "/coordinator/schedule"}
          >
            {data.attentionCount > 0 ? "Staff next week" : "Open the schedule"}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link className={styles.ghostAction} to="/coordinator/impact">
            See this year&rsquo;s impact
          </Link>
        </div>

        <dl className={styles.heroFacts}>
          <div>
            <dt>{t("Today")}</dt>
            <dd>{openToday}</dd>
          </div>
          <div>
            <dt>{t("Roster")}</dt>
            <dd>
              {data.activeVolunteers} {t("active volunteers")}
            </dd>
          </div>
          <div>
            <dt>{t("Coverage")}</dt>
            <dd>
              {data.coveragePercent}% {t("of role slots filled")}
            </dd>
          </div>
        </dl>
      </div>

      <figure className={styles.heroFigure}>
        <img
          className={styles.heroImage}
          src={cover ?? "/media/hero-community.jpg"}
          alt={
            ownWorkspace
              ? (organization.imageAlt ?? `${organization.name} community photo`)
              : t("Volunteers packing food boxes together at a community pantry")
          }
          width={1600}
          height={760}
          fetchPriority="high"
        />
        <figcaption className={styles.heroCaption}>
          <span>{ownWorkspace ? coverCaption : "Packing day at the Rivergate Avenue pantry"}</span>
          {ownWorkspace ? null : <span>Photo: Pexels / 6646918</span>}
        </figcaption>
      </figure>
    </section>
  );
}

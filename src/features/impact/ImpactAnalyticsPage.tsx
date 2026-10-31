import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, ChevronDown } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import { ButtonLink, Page, PageHeader } from "../../components/ui";
import { CAUSE_COLORS } from "../../lib/causes";
import { t } from "../../lib/i18n";
import { isDemoOrganization } from "../../lib/workspace/organizationWorkspace";
import { useWorkspace } from "../../lib/workspace/session";
import { WorkAreaTabs } from "../../components/navigation/WorkAreaTabs";
import { reportTabs } from "../../app/workAreas";
import {
  CAUSE_LABELS,
  formatHours,
  getCauseHours,
  getHourRows,
  getHoursTrend,
  getImpactOutcomes,
  getImpactStories,
} from "../../lib/workspace/selectors";
import type { Cause } from "../../types/domain";
import styles from "./ImpactAnalytics.module.css";

export function ImpactAnalyticsPage() {
  const { workspace, session } = useWorkspace();
  const [range, setRange] = useState("12");
  const trend = getHoursTrend(session, workspace);
  const causes = getCauseHours(session, workspace);
  const demoStories = isDemoOrganization(workspace.organization.id)
    ? [
        ...getImpactStories(workspace),
        {
          id: "story-community",
          title: "Neighborhood Mural Project",
          image: "/media/opp-community-event.jpg",
          metric: `${workspace.opportunities.length} active programs`,
        },
      ]
    : [];
  const impact = workspace.impact;
  const organization = workspace.organization;
  const ownWorkspace = !isDemoOrganization(organization.id);
  const place = [organization.city, organization.state].filter(Boolean).join(", ");
  const outcomes = getImpactOutcomes(session);
  const demoDate = format(parseISO(workspace.now), "MMM d, yyyy");
  const chartData = range === "6" ? trend.slice(-6) : trend;

  const programs = useMemo(() => {
    const totals = new Map<
      string,
      { id: string; title: string; cause: Cause; hours: number; entries: number }
    >();
    for (const row of getHourRows(session, workspace)) {
      const hours = (row.approvedMinutes ?? row.requestedMinutes) / 60;
      const current = totals.get(row.opportunity.id) ?? {
        id: row.opportunity.id,
        title: row.opportunity.title,
        cause: row.opportunity.cause,
        hours: 0,
        entries: 0,
      };
      current.hours += hours;
      current.entries += 1;
      totals.set(row.opportunity.id, current);
    }
    return [...totals.values()].sort((a, b) => b.hours - a.hours).slice(0, 4);
  }, [session, workspace]);

  // A real organization tells its own story: one card per program it actually
  // ran. The canned stories belong to the bundled demo only.
  const galleryStories = ownWorkspace
    ? programs.map((program) => ({
        id: program.id,
        title: program.title,
        image:
          workspace.opportunities.find((row) => row.id === program.id)?.image ??
          organization.image ??
          "/media/community-strip-1.jpg",
        metric: formatHours(Math.round(program.hours)),
      }))
    : demoStories;

  const causeTotal = causes.reduce((sum, cause) => sum + cause.hours, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const segments = causes.reduce<
    ((typeof causes)[number] & { color: string; dash: number; offset: number })[]
  >((accumulator, cause) => {
    const previous = accumulator[accumulator.length - 1];
    const dash = (cause.hours / Math.max(1, causeTotal)) * circumference;
    return [
      ...accumulator,
      {
        ...cause,
        color: CAUSE_COLORS[cause.cause],
        dash,
        offset: previous ? previous.offset + previous.dash : 0,
      },
    ];
  }, []);

  const chartWidth = 640;
  const chartHeight = 178;
  const padX = 6;
  const padTop = 14;
  const padBottom = 12;
  const chartMax = Math.max(...chartData.map((point) => point.hours), 1);
  const points = chartData.map((point, index) => {
    const x = padX + (index / Math.max(1, chartData.length - 1)) * (chartWidth - padX * 2);
    const y =
      chartHeight - padBottom - (point.hours / chartMax) * (chartHeight - padTop - padBottom);
    return { ...point, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${padX},${chartHeight - padBottom} ${line} ${chartWidth - padX},${chartHeight - padBottom}`;

  const metrics = [
    {
      value: impact.hoursYtd.toLocaleString(),
      label: "Volunteer hours",
      meta: `${impact.shiftsCompleted} shifts verified`,
    },
    {
      value: impact.uniqueVolunteersYtd.toString(),
      label: "People who served",
      meta: `${impact.activeVolunteers} active this month`,
    },
    {
      value: (outcomes.get("meals_packed")?.value ?? 0).toLocaleString(),
      label: "Meals packed",
      meta: ownWorkspace ? t("recorded outcomes") : "reported by the pantry",
    },
    {
      value: (outcomes.get("tutoring_sessions")?.value ?? 0).toString(),
      label: "Tutoring sessions",
      meta: ownWorkspace ? t("recorded outcomes") : "reported by the library",
    },
    {
      value: (outcomes.get("trees_planted")?.value ?? 0).toString(),
      label: "Trees planted",
      meta: ownWorkspace ? t("recorded outcomes") : "reported by the garden",
    },
  ];

  return (
    <Page width="wide" className={styles.page}>
      <WorkAreaTabs label="Reports" items={reportTabs} />
      <PageHeader
        eyebrow="Reporting"
        title="Impact"
        description="Approved service hours, counted once, and the programs they came from. Pending hours are held back until a coordinator signs them off."
        actions={
          <>
            <label className={styles.rangeControl}>
              <CalendarDays size={14} strokeWidth={1.7} aria-hidden="true" />
              <span className={styles.srOnly}>Reporting range</span>
              <select value={range} onChange={(event) => setRange(event.target.value)}>
                <option value="12">Jan 1 – {demoDate}</option>
                <option value="6">Last 6 months</option>
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
            <ButtonLink to="/coordinator/reports/preview" variant="primary">
              Open the report
            </ButtonLink>
          </>
        }
      />

      <section className={styles.hero} aria-labelledby="impact-title">
        <img
          className={styles.heroImage}
          src={
            ownWorkspace
              ? (organization.image ?? "/media/hero-community.jpg")
              : "/media/hero-community.jpg"
          }
          alt={
            ownWorkspace
              ? (organization.imageAlt ?? `${organization.name} community photo`)
              : t("Volunteers packing food boxes at a community pantry")
          }
        />
        <div className={styles.heroWash} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <p className={styles.heroPlace}>
            {ownWorkspace
              ? [organization.name, place].filter(Boolean).join(" · ")
              : "Buffalo, New York"}
            {" · "}January to {format(parseISO(workspace.now), "MMMM yyyy")}
          </p>
          <h2 className={styles.heroStatement} id="impact-title">
            <span className={styles.heroNumber}>{impact.hoursYtd.toLocaleString()}</span>
            <span>hours from {impact.uniqueVolunteersYtd.toLocaleString()} people.</span>
          </h2>
        </div>
        {ownWorkspace ? null : (
          <p className={styles.heroCaption}>
            Packing day at the Rivergate Avenue pantry. Photo: Pexels / 6646918.
          </p>
        )}
      </section>

      <ul className={styles.metrics}>
        {metrics.map((metric) => (
          <li key={metric.label} className={styles.metric}>
            <span className={styles.metricValue}>{metric.value}</span>
            <span className={styles.metricLabel}>{metric.label}</span>
            <span className={styles.metricMeta}>{metric.meta}</span>
          </li>
        ))}
      </ul>

      <div className={styles.analyticsRow}>
        <section className={styles.card} aria-labelledby="cause-heading">
          <header className={styles.cardHead}>
            <div>
              <h2 id="cause-heading" className={styles.cardTitle}>
                Hours by cause
              </h2>
              <p className={styles.cardSub}>Share of approved hours this year</p>
            </div>
          </header>
          <div className={styles.causeBody}>
            <div className={styles.donut}>
              <svg viewBox="0 0 140 140" role="img" aria-label="Approved hours by cause area">
                <circle
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke="rgba(48,39,28,0.08)"
                  strokeWidth="17"
                />
                {segments.map((segment) => (
                  <circle
                    key={segment.cause}
                    cx="70"
                    cy="70"
                    r={radius}
                    fill="none"
                    stroke={segment.color}
                    strokeWidth="17"
                    strokeDasharray={`${Math.max(0, segment.dash - 2)} ${circumference}`}
                    strokeDashoffset={-segment.offset}
                    transform="rotate(-90 70 70)"
                  />
                ))}
              </svg>
              <span className={styles.donutCenter}>
                <strong>{formatHours(impact.hoursYtd)}</strong>
                <span>verified</span>
              </span>
            </div>
            <ul className={styles.causeLegend}>
              {causes.map((cause) => (
                <li key={cause.cause}>
                  <span
                    className={styles.legendDot}
                    style={{ background: CAUSE_COLORS[cause.cause] }}
                    aria-hidden="true"
                  />
                  <span className={styles.legendLabel}>{CAUSE_LABELS[cause.cause]}</span>
                  <span className={styles.legendValue}>
                    {Math.round((cause.hours / Math.max(1, causeTotal)) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="trend-heading">
          <header className={styles.cardHead}>
            <div>
              <h2 id="trend-heading" className={styles.cardTitle}>
                Hours over time
              </h2>
              <p className={styles.cardSub}>Verified hours, month by month</p>
            </div>
            <span className={styles.trendBadge}>
              {chartData.length === 12 ? "12 months" : "6 months"}
            </span>
          </header>
          <div className={styles.trend}>
            <span className={styles.trendMax}>{chartMax}h</span>
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Approved hours over ${chartData.length} months`}
            >
              <defs>
                <linearGradient id="impact-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a64b32" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#a64b32" stopOpacity="0.01" />
                </linearGradient>
              </defs>
              {[0.18, 0.44, 0.7, 0.94].map((stop) => (
                <line
                  key={stop}
                  x1="0"
                  x2={chartWidth}
                  y1={chartHeight * stop}
                  y2={chartHeight * stop}
                  stroke="rgba(48,39,28,0.09)"
                  strokeWidth="1"
                />
              ))}
              <polygon points={area} fill="url(#impact-area)" />
              <polyline
                points={line}
                fill="none"
                stroke="var(--color-cobalt)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((point) => (
                <circle
                  key={point.label}
                  cx={point.x}
                  cy={point.y}
                  r="2.5"
                  fill="var(--surface-raised)"
                  stroke="var(--color-cobalt)"
                  strokeWidth="1.5"
                />
              ))}
            </svg>
            <div className={styles.chartLabels} aria-hidden="true">
              {points.map((point) => (
                <span key={point.label}>{point.label}</span>
              ))}
            </div>
            <table className={styles.srOnly}>
              <caption>Verified hours by month</caption>
              <tbody>
                {chartData.map((point) => (
                  <tr key={point.label}>
                    <th scope="row">{point.label}</th>
                    <td>{point.hours} hours</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="programs-heading">
          <header className={styles.cardHead}>
            <div>
              <h2 id="programs-heading" className={styles.cardTitle}>
                Programs by hours
              </h2>
              <p className={styles.cardSub}>Where the time actually went</p>
            </div>
          </header>
          <ul className={styles.programs}>
            {programs.map((program) => (
              <li key={program.id}>
                <Link className={styles.program} to={`/coordinator/opportunities/${program.id}`}>
                  <span className={styles.programMain}>
                    <span className={styles.programTop}>
                      <span className={styles.programName}>{program.title}</span>
                      <span className={styles.programHours}>
                        {formatHours(Math.round(program.hours))}
                      </span>
                    </span>
                    <span className={styles.programBar} aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(
                            6,
                            (program.hours / Math.max(1, programs[0]?.hours ?? 1)) * 100,
                          )}%`,
                          background: CAUSE_COLORS[program.cause],
                        }}
                      />
                    </span>
                    <span className={styles.programMeta}>
                      {program.entries} approved entr{program.entries === 1 ? "y" : "ies"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {galleryStories.length > 0 ? (
        <section className={styles.gallery} aria-labelledby="stories-heading">
          <header className={styles.galleryHead}>
            <div>
              <h2 id="stories-heading" className={styles.cardTitle}>
                The work behind the numbers
              </h2>
              <p className={styles.cardSub}>
                {ownWorkspace
                  ? t("Programs with approved hours this year.")
                  : "Four programs, four different Saturday mornings."}
              </p>
            </div>
            <Link className={styles.galleryLink} to="/coordinator/reports/preview">
              Read the full report
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </header>
          <div className={styles.stories}>
            {galleryStories.map((story) => (
              <Link key={story.id} className={styles.story} to="/coordinator/reports/preview">
                <img className={styles.storyImage} src={story.image} alt="" loading="lazy" />
                <div className={styles.storyCopy}>
                  <span className={styles.storyTitle}>{story.title}</span>
                  <span className={styles.storyMetric}>{story.metric}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <p className={styles.footNote}>
        Counts cover approved hours through {demoDate}. Pending and rejected submissions are
        excluded, so the report always matches the service record.
      </p>
    </Page>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  MapPin,
  Sparkles,
  Wand2,
} from "lucide-react";
import { addDays, format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  SearchField,
  Toggle,
} from "../../components/ui";
import { t } from "../../lib/i18n";
import type {
  CandidateAnswer,
  RosterEvaluation,
  RosterPlan,
  RosterPolicyView,
  Volunteer,
} from "../../types/domain";
import { useWorkspace } from "../../lib/workspace/session";
import styles from "./AutoRosterPage.module.css";
import {
  formatDate,
  getRoster,
  getUpcomingShiftRows,
  timeRange,
} from "../../lib/workspace/selectors";
import type { ShiftRow } from "../../lib/workspace/selectors";
import { messageOf } from "../../lib/errors";

interface RoleGap {
  name: string;
  required: number;
  filled: number;
  missing: number;
}

type AvailabilityState = "available" | "partial" | "unknown" | "unavailable";

interface Candidate {
  volunteer: Volunteer;
  primaryRole: string;
  eligibleRoles: string[];
  score: number;
  scores: Record<string, number>;
  breakdown: { label: string; value: number; max: number }[];
  reasons: string[];
  availability: AvailabilityState;
  weeklyShifts: number;
  conflict: string | null;
  waitlisted: boolean;
}

interface ShiftPlan {
  row: ShiftRow;
  gaps: RoleGap[];
  required: number;
  filled: number;
  rosterCount: number;
  filledByRole: Map<string, number>;
}

interface PlanRow {
  shiftId: string;
  shiftTitle: string;
  startsAt: string;
  gap: RoleGap;
  candidate: Candidate;
  backend: RosterPlan["assignments"][number];
}

interface EngineOptions {
  preferSpanish: boolean;
  includeWaitlist: boolean;
  blockConflicts: boolean;
  capWeekly: boolean;
}

const DEFAULT_OPTIONS: EngineOptions = {
  preferSpanish: true,
  includeWaitlist: true,
  blockConflicts: true,
  capWeekly: false,
};

const ROLE_COLORS = [
  "var(--color-red)",
  "var(--color-orange)",
  "var(--color-green)",
  "var(--color-cobalt)",
  "var(--color-violet)",
];

const AVAILABILITY_POINTS = 25;

function availabilityLabel(state: AvailabilityState): string {
  if (state === "available") return "Available for this shift";
  if (state === "partial") return "Partial availability this day";
  if (state === "unknown") return "Availability not confirmed";
  return "No availability listed for this day";
}

/**
 * The evidence behind one seat: every hard requirement the solver checked, the
 * score components, and the option to ask about someone else.
 */
function PlanEvidence({
  explanation,
  alternatives,
  asking,
  answer,
  onAsk,
}: {
  explanation: RosterPlan["assignments"][number]["explanation"];
  alternatives: Candidate[];
  asking: string;
  answer: { slotId: string; candidateName: string; answer: CandidateAnswer } | null;
  onAsk: (candidateId: string, candidateName: string) => void;
}) {
  const showing = answer?.slotId === explanation.slotId ? answer : null;
  const first = explanation.candidateName.split(" ")[0];
  return (
    <>
      <details className={styles.planWhy}>
        <summary>Why {first}?</summary>
        <p className={styles.whyNote}>{explanation.selectionReason}</p>
        <ul className={`${styles.reasonList} ${styles.checkList}`}>
          {explanation.checks.map((check) => (
            <li key={check.name} className={styles.checkRow}>
              <span>
                {check.name} · {check.detail}
              </span>
              <span className={check.passed ? styles.checkPass : styles.checkFail}>
                {check.passed ? "PASS" : "FAIL"}
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.breakdown}>
          {explanation.components.map((row) => (
            <div key={row.label} className={styles.breakdownRow}>
              <span>{row.label}</span>
              <div className={styles.breakdownTrack} aria-hidden="true">
                <span
                  style={{ width: `${row.maximum === 0 ? 0 : (row.awarded / row.maximum) * 100}%` }}
                />
              </div>
              <span className={styles.breakdownValue}>{row.awarded}</span>
            </div>
          ))}
        </div>
      </details>

      {alternatives.length > 0 ? (
        <div className={styles.whyNot}>
          <span className={styles.whyNotLabel}>Ask why not:</span>
          {alternatives.map((candidate) => (
            <button
              key={candidate.volunteer.id}
              type="button"
              className={styles.whyNotButton}
              onClick={() => onAsk(candidate.volunteer.id, candidate.volunteer.name)}
              disabled={asking === candidate.volunteer.id}
            >
              {asking === candidate.volunteer.id
                ? "Checking…"
                : candidate.volunteer.name.split(" ")[0]}
            </button>
          ))}
        </div>
      ) : null}

      {showing ? (
        <div className={styles.answerCard} role="status">
          <p className={styles.answerTitle}>Why not {showing.candidateName}?</p>
          {showing.answer.explanation.eligible ? (
            <p className={styles.whyNote}>
              They clear every requirement for this seat. This is what the plan would do instead:
            </p>
          ) : (
            <ul className={styles.reasonList}>
              {showing.answer.explanation.checks
                .filter((check) => !check.passed)
                .map((check) => (
                  <li key={check.name}>
                    {check.name} · {check.detail}
                  </li>
                ))}
            </ul>
          )}
          {showing.answer.comparison ? (
            <ul className={styles.reasonList}>
              {showing.answer.comparison.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function AutoRosterPage() {
  const { workspace, session, actions } = useWorkspace();
  const [scope, setScope] = useState<"week" | "shift">("week");
  const upcoming = useMemo(() => {
    const rows = getUpcomingShiftRows(workspace);
    return rows.filter((row) => row.shift.roles.some((role) => role.filled < role.required));
  }, [workspace]);
  const weekRows = useMemo(() => {
    if (upcoming.length === 0) return [];
    const end = addDays(parseISO(workspace.now), 7);
    const next = upcoming.filter((row) => parseISO(row.shift.startsAt) <= end);
    return next.length > 0 ? next : upcoming.slice(0, 4);
  }, [upcoming, workspace.now]);
  const [shiftId, setShiftId] = useState(
    () => weekRows[0]?.shift.id ?? upcoming[0]?.shift.id ?? "",
  );
  // A shift may stop having a gap while the page is open. Fall back to the
  // first at-risk shift rather than leaving an empty single-shift view behind.
  const selectedShiftId = upcoming.some((row) => row.shift.id === shiftId)
    ? shiftId
    : (weekRows[0]?.shift.id ?? upcoming[0]?.shift.id ?? "");
  const activeRows =
    scope === "week" ? weekRows : upcoming.filter((row) => row.shift.id === selectedShiftId);
  const activeIdsKey = activeRows.map((row) => row.shift.id).join("|");
  const shiftIds = useMemo(() => (activeIdsKey ? activeIdsKey.split("|") : []), [activeIdsKey]);
  const shiftKey = shiftIds.join("|");

  const [query, setQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("best");
  const [showAll, setShowAll] = useState(false);
  const [options, setOptions] = useState<EngineOptions>(DEFAULT_OPTIONS);
  const [plan, setPlan] = useState<RosterPlan | null>(null);
  // The authoritative evaluation behind the candidate browser. Fetched on load
  // so the list is ready before a plan exists.
  const [evaluation, setEvaluation] = useState<RosterEvaluation | null>(null);
  const [policyView, setPolicyView] = useState<RosterPolicyView | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  // Answers to "why not that one?", kept per seat so the plan row shows the
  // explanation next to the decision it is about.
  const [answer, setAnswer] = useState<{
    slotId: string;
    candidateName: string;
    answer: CandidateAnswer;
  } | null>(null);
  const [asking, setAsking] = useState("");
  const [answerError, setAnswerError] = useState("");

  useEffect(() => {
    if (!shiftKey) return;
    let active = true;
    void actions
      .evaluateRoster(shiftKey.split("|"), {
        preferSpanish: options.preferSpanish,
        includeWaitlist: options.includeWaitlist,
        blockConflicts: options.blockConflicts,
        capWeekly: options.capWeekly,
      })
      .then((result) => {
        if (active) setEvaluation(result);
      })
      .catch((caught) => {
        if (active) setError(messageOf(caught));
      });
    return () => {
      active = false;
    };
  }, [actions, options, shiftKey]);

  useEffect(() => {
    let active = true;
    actions
      .getRosterPolicy()
      .then((next) => {
        if (active) setPolicyView(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [actions]);

  const shiftPlans = useMemo<ShiftPlan[]>(() => {
    return activeRows.map((row) => {
      // The roster is the source of truth. A role count cached on the shift can
      // lag behind a plan that was just applied.
      const roster = getRoster(row.shift.id, session, workspace);
      const filledByRole = new Map<string, number>();
      for (const rosterRow of roster) {
        filledByRole.set(rosterRow.role, (filledByRole.get(rosterRow.role) ?? 0) + 1);
      }
      const gaps = row.shift.roles
        .map((role) => {
          const filled = filledByRole.get(role.name) ?? 0;
          return {
            name: role.name,
            required: role.required,
            filled,
            missing: Math.max(0, role.required - filled),
          };
        })
        .filter((role) => role.missing > 0);
      return {
        row,
        gaps,
        required: row.shift.roles.reduce((total, role) => total + role.required, 0),
        filled: row.shift.roles.reduce(
          (total, role) => total + (filledByRole.get(role.name) ?? 0),
          0,
        ),
        rosterCount: roster.length,
        filledByRole,
      };
    });
  }, [activeRows, session, workspace]);

  const data = useMemo(() => {
    if (!evaluation) return { candidates: [] as Candidate[] };
    const active = new Set(shiftIds);
    const candidates = evaluation.candidates
      .map((row): Candidate | null => {
        const volunteer = workspace.volunteers.find((entry) => entry.id === row.candidateId);
        if (!volunteer) return null;
        const open = row.slots.filter((slot) => active.has(slot.shiftId) && slot.eligible);
        if (open.length === 0) return null;
        const best = open.reduce((left, right) =>
          (right.score ?? 0) > (left.score ?? 0) ? right : left,
        );
        const scores: Record<string, number> = {};
        for (const slot of open) {
          scores[slot.role] = Math.max(scores[slot.role] ?? 0, slot.score ?? 0);
        }
        return {
          volunteer,
          primaryRole: best.role,
          eligibleRoles: row.eligibleRoles,
          score: row.bestScore ?? best.score ?? 0,
          scores,
          breakdown: best.components.map((component) => ({
            label: component.label,
            value: component.awarded,
            max: component.maximum,
          })),
          reasons: [
            best.selectionReason,
            availabilityLabel(row.availability),
            `${volunteer.attendanceRate}% attendance`,
          ],
          availability: row.availability,
          weeklyShifts: row.weeklyShifts,
          conflict: row.conflict,
          waitlisted: row.waitlistedShiftIds.some((id) => active.has(id)),
        };
      })
      .filter((row): row is Candidate => row !== null);
    return { candidates };
  }, [evaluation, shiftIds, workspace.volunteers]);

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = data.candidates.filter((candidate) => {
      if (skillFilter !== "all" && !candidate.eligibleRoles.includes(skillFilter)) return false;
      if (availabilityFilter !== "all" && candidate.availability !== availabilityFilter)
        return false;
      if (!normalized) return true;
      return `${candidate.volunteer.name} ${candidate.volunteer.skills.join(" ")} ${candidate.eligibleRoles.join(" ")}`
        .toLowerCase()
        .includes(normalized);
    });
    return rows.sort((a, b) => {
      if (sortBy === "name") return a.volunteer.name.localeCompare(b.volunteer.name);
      if (sortBy === "attendance") return b.volunteer.attendanceRate - a.volunteer.attendanceRate;
      return (
        b.score - a.score ||
        b.volunteer.attendanceRate - a.volunteer.attendanceRate ||
        a.volunteer.name.localeCompare(b.volunteer.name)
      );
    });
  }, [availabilityFilter, data.candidates, query, skillFilter, sortBy]);

  const visibleCandidates = showAll ? filteredCandidates : filteredCandidates.slice(0, 6);
  const skillOptions = useMemo(
    () =>
      Array.from(new Set(data.candidates.flatMap((candidate) => candidate.eligibleRoles))).sort(),
    [data.candidates],
  );

  const eligibleForPlan = useMemo(
    () =>
      data.candidates.filter(
        (candidate) =>
          !(options.blockConflicts && candidate.conflict) &&
          !(options.capWeekly && candidate.weeklyShifts >= 2),
      ),
    [data.candidates, options.blockConflicts, options.capWeekly],
  );

  // The optimizer lives in Rust. This screen renders the returned plan and
  // never invents an assignment of its own.
  const activePlan = useMemo<PlanRow[]>(() => {
    if (!plan) return [];
    return plan.assignments.flatMap((assignment) => {
      const shiftPlan = shiftPlans.find((row) => row.row.shift.id === assignment.shiftId);
      if (!shiftPlan) return [];
      const gap = shiftPlan.gaps.find((row) => row.name === assignment.role) ?? {
        name: assignment.role,
        required: 1,
        filled: 0,
        missing: 1,
      };
      const candidate = data.candidates.find((row) => row.volunteer.id === assignment.candidateId);
      if (!candidate) return [];
      return [
        {
          shiftId: assignment.shiftId,
          shiftTitle: assignment.shiftTitle,
          startsAt: assignment.startsAt,
          gap,
          candidate,
          backend: assignment,
        },
      ];
    });
  }, [data.candidates, plan, shiftPlans]);

  if (!selectedShiftId || activeRows.length === 0) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Every shift is fully staffed"
          copy="There are no role gaps in the upcoming schedule. New shifts appear here as soon as a role opens."
          action={<ButtonLink to="/coordinator/schedule">Open schedule</ButtonLink>}
        />
      </div>
    );
  }

  const requiredSlots = shiftPlans.reduce((total, row) => total + row.required, 0);
  const filledSlots = shiftPlans.reduce((total, row) => total + row.filled, 0);
  const rosterTotal = shiftPlans.reduce((total, row) => total + row.rosterCount, 0);
  const capacityTotal = shiftPlans.reduce((total, row) => total + row.row.shift.capacity, 0);
  const beforeRolePercent =
    requiredSlots === 0 ? 100 : Math.round((filledSlots / requiredSlots) * 100);
  const beforeSeatPercent =
    capacityTotal === 0 ? 0 : Math.round((rosterTotal / capacityTotal) * 100);
  const plannedCandidates = activePlan;
  const projected = applied ? 0 : plannedCandidates.length;
  const afterRolePercent =
    requiredSlots === 0
      ? 100
      : Math.min(100, Math.round(((filledSlots + projected) / requiredSlots) * 100));
  const afterSeats = Math.min(capacityTotal, rosterTotal + projected);
  const afterSeatPercent = capacityTotal === 0 ? 0 : Math.round((afterSeats / capacityTotal) * 100);
  const excludedCount = data.candidates.length - eligibleForPlan.length;
  const coverageGain = Math.max(0, afterRolePercent - beforeRolePercent);
  const distinctPeople = new Set(plannedCandidates.map((row) => row.candidate.volunteer.id)).size;
  const unfilledCount = plan?.unfilled.length ?? 0;
  const conflictCount = plannedCandidates.filter((row) =>
    row.backend.explanation.checks.some(
      (check) => check.name === "No overlapping shift" && !check.passed,
    ),
  ).length;
  const credentialCount = plannedCandidates.filter((row) =>
    row.backend.explanation.checks.some(
      (check) => check.name === "Required credential" && !check.passed,
    ),
  ).length;
  const scopeStart = activeRows[0]?.shift.startsAt;
  const scopeEnd = activeRows[activeRows.length - 1]?.shift.endsAt;
  const planGroups = activeRows
    .map((row) => ({
      row,
      rows: plannedCandidates.filter((assignment) => assignment.shiftId === row.shift.id),
    }))
    .filter((group) => group.rows.length > 0);

  function invalidatePlan() {
    setPlan(null);
    setApplied(false);
    setAppliedCount(0);
    setStale(false);
    setAnswer(null);
    setAnswerError("");
    setError("");
  }

  /**
   * Asks the solver about one seat. The answer comes from the same rules the
   * plan used: a failed hard check, or — when the person was eligible — what
   * forcing them into the seat would do to the rest of the plan.
   */
  async function askWhyNot(slotId: string, candidateId: string, candidateName: string) {
    if (!shiftKey) return;
    setAsking(candidateId);
    setAnswerError("");
    try {
      const result = await actions.explainRosterChoice(
        shiftKey.split("|"),
        {
          preferSpanish: options.preferSpanish,
          includeWaitlist: options.includeWaitlist,
          blockConflicts: options.blockConflicts,
          capWeekly: options.capWeekly,
        },
        candidateId,
        slotId,
      );
      setAnswer({ slotId, candidateName, answer: result });
    } catch (caught) {
      setAnswerError(messageOf(caught));
    } finally {
      setAsking("");
    }
  }

  /** The people who could arguably take this seat, besides the one holding it. */
  function alternativesFor(role: string, holderId: string): Candidate[] {
    return data.candidates
      .filter(
        (candidate) =>
          candidate.volunteer.id !== holderId && candidate.eligibleRoles.includes(role),
      )
      .slice(0, 4);
  }

  function updateOption(key: keyof EngineOptions, value: boolean) {
    setOptions((current) => ({ ...current, [key]: value }));
    invalidatePlan();
  }

  async function generatePlan() {
    setPlanning(true);
    setError("");
    setStale(false);
    try {
      const result = await actions.evaluateRoster(shiftKey.split("|"), {
        preferSpanish: options.preferSpanish,
        includeWaitlist: options.includeWaitlist,
        blockConflicts: options.blockConflicts,
        capWeekly: options.capWeekly,
      });
      setEvaluation(result);
      setPlan(result.plan);
      setApplied(false);
      setAppliedCount(0);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPlanning(false);
    }
  }

  async function applyPlan() {
    if (applied || applying || !plan) return;
    setApplying(true);
    setError("");
    try {
      const assignments = activePlan.map((assignment) => ({
        shiftId: assignment.shiftId,
        candidateId: assignment.candidate.volunteer.id,
        role: assignment.gap.name,
        promoteWaitlist: assignment.backend.promoteWaitlist,
      }));
      await actions.applyRosterWeek(plan.revision, plan.policyVersion, assignments);
      // Re-read the seat evaluation after the write so the candidate browser,
      // gaps, and roster count all describe the roster that now exists.
      const refreshed = await actions.evaluateRoster(shiftKey.split("|"), {
        preferSpanish: options.preferSpanish,
        includeWaitlist: options.includeWaitlist,
        blockConflicts: options.blockConflicts,
        capWeekly: options.capWeekly,
      });
      setEvaluation(refreshed);
      setAppliedCount(assignments.length);
      setApplied(true);
      setPlan(null);
      setAnswer(null);
    } catch (caught) {
      const message = messageOf(caught);
      if (/PLAN_STALE|roster changed after this plan/i.test(message)) {
        setStale(true);
        setError(
          "The roster changed after this plan was generated. Rebuild it so nobody is double-booked.",
        );
      } else {
        setError(message);
      }
    } finally {
      setApplying(false);
    }
  }

  const weights = policyView?.policy;
  const weightRows = weights
    ? [
        { label: "Skill and credential fit", value: weights.skillWeight },
        { label: "Availability", value: AVAILABILITY_POINTS },
        { label: "Cause interest", value: weights.interestWeight },
        { label: "Language preference", value: weights.languageWeight },
        { label: "Workload fairness", value: weights.fairnessWeight },
        { label: "Attendance reliability", value: weights.reliabilityWeight },
      ]
    : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <nav className={styles.crumb} aria-label="Breadcrumb">
          <Link to="/coordinator/mission-control">Home</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">AutoRoster</span>
        </nav>
        <div className={styles.titleRow}>
          <div className={styles.titleCopy}>
            <h1 className={styles.title}>AutoRoster</h1>
            <p className={styles.lede}>
              Staff the open roles across the next seven days from people already on your books. The
              optimizer weighs skills, availability, clashes, and how often someone turns up.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Button
              className={styles.optimizeButton}
              onClick={() => void generatePlan()}
              disabled={planning}
              icon={<Wand2 size={15} />}
            >
              {t(planning ? "Working…" : "Run optimizer")}
            </Button>
            <ButtonLink
              to="/coordinator/schedule"
              variant="secondary"
              className={styles.exportButton}
            >
              Schedule
            </ButtonLink>
          </div>
        </div>
      </header>

      <div className={styles.scopeBar}>
        <div className={styles.scopeOptions} role="group" aria-label="Planning scope">
          <button
            type="button"
            className={styles.scopeButton}
            data-active={scope === "week" ? "true" : "false"}
            aria-pressed={scope === "week"}
            onClick={() => {
              setScope("week");
              invalidatePlan();
            }}
          >
            Next 7 days
            <span>{weekRows.length} shifts with gaps</span>
          </button>
          <button
            type="button"
            className={styles.scopeButton}
            data-active={scope === "shift" ? "true" : "false"}
            aria-pressed={scope === "shift"}
            onClick={() => {
              setScope("shift");
              invalidatePlan();
            }}
          >
            One shift
            <span>Review a single roster</span>
          </button>
        </div>
        <div className={styles.scopeMeta}>
          {scope === "week" ? (
            <>
              <CalendarClock size={13} aria-hidden="true" />
              {scopeStart ? formatDate(scopeStart) : "No dates"} –{" "}
              {scopeEnd ? formatDate(scopeEnd) : "No dates"}
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              {requiredSlots - filledSlots} open role{requiredSlots - filledSlots === 1 ? "" : "s"}
            </>
          ) : (
            <label className={styles.shiftPicker}>
              <span className={styles.srOnly}>Shift to optimize</span>
              <select
                value={selectedShiftId}
                onChange={(event) => {
                  setShiftId(event.target.value);
                  invalidatePlan();
                }}
              >
                {upcoming.map((row) => (
                  <option key={row.shift.id} value={row.shift.id}>
                    {row.opportunity.title} · {format(parseISO(row.shift.startsAt), "MMM d")}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          )}
        </div>
      </div>

      {scope === "shift" && activeRows[0] ? (
        <div className={styles.shiftBar}>
          <div className={styles.shiftBarCopy}>
            <span className={styles.shiftBarLabel}>This shift</span>
            <h2 className={styles.shiftBarTitle}>{activeRows[0].opportunity.title}</h2>
            <p className={styles.shiftBarMeta}>
              <CalendarClock size={13} aria-hidden="true" />
              {formatDate(activeRows[0].shift.startsAt)} ·{" "}
              {timeRange(activeRows[0].shift.startsAt, activeRows[0].shift.endsAt)}
              <span className={styles.sep} aria-hidden="true">
                ·
              </span>
              <MapPin size={13} aria-hidden="true" />
              {activeRows[0].opportunity.address}
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={`${styles.pane} ${styles.available}`} aria-label="Available volunteers">
          <div className={styles.paneHead}>
            <div>
              <h2 className={styles.paneTitle}>Who can take it</h2>
              <p className={styles.paneSub}>
                {data.candidates.length} people match at least one open role
                {scope === "week" ? " this week" : ""}.
              </p>
            </div>
            <span className={styles.paneCount}>
              <strong>{filteredCandidates.length}</strong> shown
            </span>
          </div>

          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search by name or skill"
            label="Search eligible volunteers"
          />

          <div className={styles.filters}>
            <label className={styles.selectWrap}>
              <span className={styles.srOnly}>Filter by role</span>
              <select value={skillFilter} onChange={(event) => setSkillFilter(event.target.value)}>
                <option value="all">All Skills</option>
                {skillOptions.map((skill) => (
                  <option key={skill} value={skill}>
                    {skill}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
            <label className={styles.selectWrap}>
              <span className={styles.srOnly}>Filter by availability</span>
              <select
                value={availabilityFilter}
                onChange={(event) => setAvailabilityFilter(event.target.value)}
              >
                <option value="all">All Availability</option>
                <option value="available">Available</option>
                <option value="partial">Partial</option>
                <option value="unknown">Not confirmed</option>
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
            <label className={styles.selectWrap}>
              <span className={styles.srOnly}>Sort volunteers</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="best">Sort: Best Match</option>
                <option value="attendance">Sort: Attendance</option>
                <option value="name">Sort: Name</option>
              </select>
              <ChevronDown size={13} aria-hidden="true" />
            </label>
          </div>

          <ul className={styles.candidateList}>
            {visibleCandidates.map((candidate) => (
              <li key={candidate.volunteer.id} className={styles.candidate}>
                <Avatar
                  initials={candidate.volunteer.initials}
                  src={candidate.volunteer.photo}
                  tone={candidate.volunteer.tone}
                  size={38}
                  label={candidate.volunteer.name}
                />
                <div className={styles.candidateBody}>
                  <div className={styles.candidateTop}>
                    <span className={styles.candidateName}>{candidate.volunteer.name}</span>
                    <span
                      className={styles.matchScore}
                      aria-label={`${candidate.score} percent match`}
                    >
                      {candidate.score}%
                      <ArrowRight size={12} aria-hidden="true" />
                    </span>
                  </div>
                  <div className={styles.candidateMeta}>
                    {candidate.primaryRole} · {candidate.volunteer.attendanceRate}% attendance
                  </div>
                  <div className={styles.candidateTags}>
                    {Array.from(
                      new Set([...candidate.eligibleRoles, ...candidate.volunteer.skills]),
                    )
                      .slice(0, 2)
                      .map((role) => (
                        <span key={role} className={styles.skillTag}>
                          {role}
                        </span>
                      ))}
                  </div>
                  {candidate.conflict || candidate.waitlisted ? (
                    <div className={styles.candidateFlags}>
                      {candidate.waitlisted ? <Badge tone="violet">Waitlist</Badge> : null}
                      {candidate.conflict ? (
                        <Badge tone="amber" icon={<AlertTriangle size={9} />}>
                          Conflict
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  <details className={styles.why}>
                    <summary>Why this match</summary>
                    <ul className={styles.reasonList}>
                      {candidate.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    <div className={styles.breakdown}>
                      {candidate.breakdown.map((row) => (
                        <div key={row.label} className={styles.breakdownRow}>
                          <span>{row.label}</span>
                          <div className={styles.breakdownTrack} aria-hidden="true">
                            <span
                              style={{
                                width: `${row.max === 0 ? 0 : Math.min(100, (row.value / row.max) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className={styles.breakdownValue}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                    <p className={styles.whyNote}>
                      {t(
                        candidate.weeklyShifts === 1
                          ? "{count} upcoming shift in this window"
                          : "{count} upcoming shifts in this window",
                        { count: candidate.weeklyShifts },
                      )}
                      {candidate.conflict ? ` ${candidate.conflict}` : ""}
                    </p>
                  </details>
                </div>
              </li>
            ))}
          </ul>

          {filteredCandidates.length === 0 ? (
            <p className={styles.none}>No volunteer matches that search.</p>
          ) : filteredCandidates.length > 6 ? (
            <Button
              variant="ghost"
              size="small"
              className={styles.showAll}
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? t("Show fewer")
                : t("Show all {count}", { count: filteredCandidates.length })}
            </Button>
          ) : null}
        </section>

        <section className={`${styles.pane} ${styles.plan}`} aria-label="Proposed roster">
          <div className={styles.paneHead}>
            <div>
              <h2 className={styles.paneTitle}>
                {scope === "week" ? "The weekly plan" : "The plan"}
              </h2>
              <p className={styles.paneSub}>
                {planning
                  ? "Reading availability, clashes, and recent attendance."
                  : applied
                    ? `Applied ${appliedCount} assignment${appliedCount === 1 ? "" : "s"} to the live roster.`
                    : plan
                      ? plannedCandidates.length > 0
                        ? t(
                            plannedCandidates.length === 1
                              ? "{count} person would close a gap in this plan."
                              : "{count} people would close the gaps in this plan.",
                            { count: plannedCandidates.length },
                          )
                        : t("Nobody clears the current rules for this shift.")
                      : t("Run the optimizer to see who fits each open role, and why.")}
              </p>
            </div>
            <div
              className={styles.planCoverage}
              aria-label={t("Projected role coverage {percent} percent", {
                percent: afterRolePercent,
              })}
            >
              <span>{afterRolePercent}%</span>
              <small>covered</small>
            </div>
          </div>

          <div className={styles.coveragePanel}>
            <div className={styles.coverageFigures}>
              <div>
                <span className={styles.coverageLabel}>Role coverage</span>
                <p className={styles.coverageNumbers}>
                  <span>{beforeRolePercent}%</span>
                  <ArrowRight size={14} aria-hidden="true" />
                  <strong>{afterRolePercent}%</strong>
                </p>
              </div>
              <div>
                <span className={styles.coverageLabel}>Seats filled</span>
                <p className={styles.coverageNumbers}>
                  <span>{beforeSeatPercent}%</span>
                  <ArrowRight size={14} aria-hidden="true" />
                  <strong>{afterSeatPercent}%</strong>
                </p>
              </div>
            </div>
            <div
              className={styles.coverageTrackWide}
              role="img"
              aria-label={`Role coverage moves from ${beforeRolePercent} to ${afterRolePercent} percent`}
            >
              <span className={styles.coverageBefore} style={{ width: `${beforeRolePercent}%` }} />
              <span className={styles.coverageAfter} style={{ width: `${afterRolePercent}%` }} />
            </div>
            <p className={styles.coverageHint}>
              {applied
                ? t("The live roster now reflects this plan.")
                : coverageGain > 0
                  ? t("This plan adds {points} points of role coverage.", { points: coverageGain })
                  : t("No change in role coverage yet.")}
              {excludedCount > 0
                ? ` ${t(
                    excludedCount === 1
                      ? "{count} person is held back by the active rules."
                      : "{count} people are held back by the active rules.",
                    { count: excludedCount },
                  )}`
                : ""}
            </p>
          </div>

          {error ? (
            <p className={styles.errorNote} role="alert">
              {error}
            </p>
          ) : null}

          {stale ? (
            <div className={styles.stalePanel}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => void generatePlan()}
                disabled={planning}
              >
                Rebuild plan
              </Button>
            </div>
          ) : null}

          {answerError ? (
            <p className={styles.errorNote} role="alert">
              {answerError}
            </p>
          ) : null}

          {applied ? (
            <div className={styles.appliedPanel} role="status">
              <CheckCircle2 size={20} aria-hidden="true" />
              <div>
                <p className={styles.appliedTitle}>
                  {appliedCount} assignment{appliedCount === 1 ? "" : "s"} applied
                </p>
                <p className={styles.appliedBody}>
                  Written to the live roster and the audit log in one transaction.
                </p>
                <Link className={styles.textLink} to="/coordinator/schedule">
                  Review the schedule
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : plannedCandidates.length > 0 ? (
            <>
              <p className={styles.planSummary}>
                {plannedCandidates.length} assignment{plannedCandidates.length === 1 ? "" : "s"}{" "}
                across {distinctPeople} volunteer{distinctPeople === 1 ? "" : "s"}
                {unfilledCount > 0
                  ? ` · ${unfilledCount} role${unfilledCount === 1 ? "" : "s"} still open`
                  : " · every required role filled"}
              </p>
              <ul className={styles.outcomeStrip} aria-label="Plan checks">
                <li data-tone={conflictCount === 0 ? "good" : "bad"}>
                  {conflictCount === 0
                    ? "No schedule conflicts"
                    : `${conflictCount} scheduling conflict${conflictCount === 1 ? "" : "s"}`}
                </li>
                <li data-tone={credentialCount === 0 ? "good" : "bad"}>
                  {credentialCount === 0
                    ? "Credentials checked"
                    : `${credentialCount} credential issue${credentialCount === 1 ? "" : "s"}`}
                </li>
                <li data-tone="good">Load spread across {distinctPeople}</li>
              </ul>
              {planGroups.map((group) => (
                <div key={group.row.shift.id} className={styles.planGroup}>
                  <div className={styles.planGroupHead}>
                    <h3 className={styles.planGroupTitle}>{group.row.opportunity.title}</h3>
                    <p className={styles.planGroupMeta}>
                      {formatDate(group.row.shift.startsAt)} ·{" "}
                      {timeRange(group.row.shift.startsAt, group.row.shift.endsAt)}
                    </p>
                  </div>
                  <ul className={styles.planList}>
                    {group.rows.map((assignment) => {
                      const candidate = assignment.candidate;
                      return (
                        <li
                          key={`${assignment.shiftId}-${assignment.gap.name}-${candidate.volunteer.id}`}
                          className={styles.planRow}
                        >
                          <Avatar
                            initials={candidate.volunteer.initials}
                            src={candidate.volunteer.photo}
                            tone={candidate.volunteer.tone}
                            size={38}
                            label={candidate.volunteer.name}
                          />
                          <div className={styles.planPerson}>
                            <span className={styles.planName}>{candidate.volunteer.name}</span>
                            <span className={styles.planRole}>
                              {assignment.gap.name}
                              {candidate.volunteer.languages.includes("Spanish")
                                ? " · Spanish"
                                : ""}
                            </span>
                          </div>
                          <span className={styles.planReason}>
                            {candidate.reasons[0] ??
                              `${candidate.volunteer.attendanceRate}% attendance`}
                          </span>
                          <span className={styles.planScore}>{candidate.score}</span>
                          <PlanEvidence
                            explanation={assignment.backend.explanation}
                            alternatives={alternativesFor(
                              assignment.gap.name,
                              candidate.volunteer.id,
                            )}
                            asking={asking}
                            answer={answer}
                            onAsk={(candidateId, name) =>
                              void askWhyNot(
                                assignment.backend.explanation.slotId,
                                candidateId,
                                name,
                              )
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              <div className={styles.planActions}>
                <Button
                  className={styles.applyButton}
                  onClick={() => void applyPlan()}
                  disabled={applying}
                  icon={applying ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />}
                >
                  {applying
                    ? "Applying…"
                    : `Apply ${plannedCandidates.length} assignment${
                        plannedCandidates.length === 1 ? "" : "s"
                      }`}
                </Button>
                <p className={styles.applyNote}>
                  Nothing is saved until you apply. The batch is checked again before it writes.
                </p>
              </div>
            </>
          ) : plan ? (
            <div className={styles.emptyPlan}>
              <p className={styles.emptyPlanTitle}>No automatic match.</p>
              <p className={styles.emptyPlanBody}>
                The remaining people either lack the required skill, are already booked at this
                time, or have unconfirmed availability. Allow waitlisted volunteers, then run it
                again.
              </p>
            </div>
          ) : (
            <div className={styles.emptyPlan}>
              <p className={styles.emptyPlanTitle}>Nothing proposed yet.</p>
              <p className={styles.emptyPlanBody}>
                A run does not book anyone. It only suggests people for the open roles; you review
                the list before anything reaches the roster.
              </p>
              <Button
                variant="secondary"
                onClick={() => void generatePlan()}
                disabled={planning}
                icon={<Wand2 size={15} />}
              >
                {t(planning ? "Working…" : "Build the plan")}
              </Button>
            </div>
          )}

          <details className={styles.engineOptions}>
            <summary>Matching settings</summary>
            <div className={styles.toggles}>
              <Toggle
                label="Prefer Spanish speakers"
                hint="Adds up to 10 points to bilingual candidates."
                checked={options.preferSpanish}
                onChange={(value) => updateOption("preferSpanish", value)}
              />
              <Toggle
                label="Include waitlist"
                hint="Waiting volunteers can be promoted into a gap."
                checked={options.includeWaitlist}
                onChange={(value) => updateOption("includeWaitlist", value)}
              />
              <Toggle
                label="Block overlapping shifts"
                hint="Keeps anyone already booked at this time out of the plan."
                checked={options.blockConflicts}
                onChange={(value) => updateOption("blockConflicts", value)}
              />
              <Toggle
                label="Cap at 2 shifts per week"
                hint="Protects volunteers from over-scheduling."
                checked={options.capWeekly}
                onChange={(value) => updateOption("capWeekly", value)}
              />
            </div>
            {weightRows.length > 0 ? (
              <div className={styles.weights}>
                <p className={styles.miniLabel}>
                  How the match score is built · policy v{weights?.version}
                </p>
                {weightRows.map((row) => (
                  <div key={row.label} className={styles.weightRow}>
                    <span>{row.label}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </details>

          <p className={styles.engineNote}>
            Deterministic and offline. The same inputs always produce the same roster.
          </p>
        </section>

        <section
          className={`${styles.pane} ${styles.requirements}`}
          aria-label="Shift requirements"
        >
          <div className={styles.paneHead}>
            <div>
              <h2 className={styles.paneTitle}>
                {scope === "week" ? "Week brief" : "Shift brief"}
              </h2>
              <p className={styles.paneSub}>
                What each shift asks for, and what is already covered.
              </p>
            </div>
            <span className={styles.paneCount}>
              <strong>{rosterTotal}</strong> on roster
            </span>
          </div>

          <div className={styles.briefBlocks}>
            {shiftPlans.map((shiftPlan) => (
              <div key={shiftPlan.row.shift.id} className={styles.briefBlock}>
                <div className={styles.briefHead}>
                  <h3 className={styles.subhead}>{shiftPlan.row.opportunity.title}</h3>
                  <span className={styles.briefDate}>
                    {formatDate(shiftPlan.row.shift.startsAt)}
                  </span>
                </div>
                <ul className={styles.roleList}>
                  {shiftPlan.row.shift.roles.map((role, index) => {
                    const filled = shiftPlan.filledByRole.get(role.name) ?? 0;
                    return (
                      <li key={role.name} className={styles.roleRow}>
                        <span
                          className={styles.roleDot}
                          style={{ background: ROLE_COLORS[index % ROLE_COLORS.length] }}
                          aria-hidden="true"
                        />
                        <span className={styles.roleName}>{role.name}</span>
                        <span
                          className={styles.roleCount}
                          data-full={filled >= role.required ? "true" : "false"}
                        >
                          {filled}/{role.required}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className={styles.briefTotals}>
            <div>
              <span>Role slots</span>
              <strong>
                {filledSlots} of {requiredSlots}
              </strong>
            </div>
            <div>
              <span>Seats filled</span>
              <strong>
                {rosterTotal} of {capacityTotal}
              </strong>
            </div>
            <div>
              <span>People eligible</span>
              <strong>{data.candidates.length}</strong>
            </div>
          </div>

          <div className={styles.briefNote}>
            <Sparkles size={15} aria-hidden="true" />
            <p>
              Role coverage counts required slots. Seats count people, including volunteers who can
              cover more than one role.
            </p>
          </div>

          <p className={styles.requirementsFoot}>
            {requiredSlots - filledSlots} open role{requiredSlots - filledSlots === 1 ? "" : "s"} ·{" "}
            {rosterTotal} on roster now
          </p>
        </section>
      </div>
    </div>
  );
}

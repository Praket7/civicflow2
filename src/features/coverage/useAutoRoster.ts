import { useEffect, useMemo, useState } from "react";
import { addDays, parseISO } from "date-fns";
import { messageOf } from "../../lib/errors";
import { getRoster, getUpcomingShiftRows } from "../../lib/workspace/selectors";
import { useWorkspace } from "../../lib/workspace/session";
import type {
  CandidateAnswer,
  RosterEvaluation,
  RosterPlan,
  RosterPolicyView,
} from "../../types/domain";
import {
  AVAILABILITY_POINTS,
  DEFAULT_OPTIONS,
  availabilityLabel,
  type Candidate,
  type EngineOptions,
  type PlanRow,
  type ShiftPlan,
} from "./autoRosterModel";

export function useAutoRoster() {
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

  return {
    workspace,
    session,
    actions,
    scope,
    setScope,
    upcoming,
    weekRows,
    selectedShiftId,
    setShiftId,
    activeRows,
    query,
    setQuery,
    skillFilter,
    setSkillFilter,
    availabilityFilter,
    setAvailabilityFilter,
    sortBy,
    setSortBy,
    showAll,
    setShowAll,
    options,
    plan,
    policyView,
    planning,
    applying,
    applied,
    appliedCount,
    stale,
    error,
    answer,
    asking,
    answerError,
    shiftPlans,
    data,
    filteredCandidates,
    visibleCandidates,
    skillOptions,
    eligibleForPlan,
    activePlan,
    requiredSlots,
    filledSlots,
    rosterTotal,
    capacityTotal,
    beforeRolePercent,
    beforeSeatPercent,
    plannedCandidates,
    afterRolePercent,
    afterSeatPercent,
    excludedCount,
    coverageGain,
    distinctPeople,
    unfilledCount,
    conflictCount,
    credentialCount,
    scopeStart,
    scopeEnd,
    planGroups,
    invalidatePlan,
    askWhyNot,
    alternativesFor,
    updateOption,
    generatePlan,
    applyPlan,
    weights,
    weightRows,
  };
}

export type AutoRosterModel = ReturnType<typeof useAutoRoster>;

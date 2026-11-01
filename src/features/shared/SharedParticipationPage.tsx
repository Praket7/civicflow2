import { useMemo, useState } from "react";
import { Check, ClipboardCheck, LogIn, LogOut, RefreshCw, UserX, Wand2, X } from "lucide-react";
import { Button, Page, PageHeader, SelectField, TextField } from "../../components/ui";
import { isTauri } from "../../lib/platform";
import { useSharedReplica } from "../../lib/sync/sharedReplica";
import { number, text, type SharedRow } from "../../lib/sync/sharedRows";
import { planShift, planUpcoming } from "../../lib/sync/sharedPlan";
import {
  applySharedRosterPlan,
  cancelSharedRegistration,
  checkInShared,
  checkOutShared,
  markNoShowShared,
  reviewSharedHours,
  type SharedAssignment,
} from "../../lib/sync/writes";
import { DesktopOnlyNotice } from "./DesktopOnlyNotice";
import { formatWhen } from "./sharedFormat";
import { SharedNav } from "./SharedNav";
import styles from "./shared.module.css";
import { messageOf } from "../../lib/errors";

export function SharedParticipationPage() {
  const { sync, data, loading, reload } = useSharedReplica();
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; message: string } | null>(null);
  const [plan, setPlan] = useState<SharedAssignment[]>([]);
  const [planScope, setPlanScope] = useState<"shift" | "recovery">("shift");
  const [recoveryShifts, setRecoveryShifts] = useState(0);
  const [rejectReason, setRejectReason] = useState("Hours were not confirmed.");

  const shifts = useMemo(
    () =>
      [...data.shifts].sort((a, b) =>
        String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")),
      ),
    [data.shifts],
  );
  const activeId = selectedId || shifts[0]?.id || "";
  const shift = useMemo(
    () => data.shifts.find((row) => row.id === activeId) ?? null,
    [data.shifts, activeId],
  );
  const opportunity = useMemo(
    () =>
      data.opportunities.find((row) => row.id === text(shift ?? undefined, "opportunity_id")) ??
      null,
    [data.opportunities, shift],
  );
  const volunteers = useMemo(
    () => new Map(data.volunteers.map((row) => [row.id, row])),
    [data.volunteers],
  );
  const registrations = useMemo(
    () => data.registrations.filter((row) => text(row, "shift_id") === activeId),
    [data.registrations, activeId],
  );
  const attendance = useMemo(() => {
    const map = new Map<string, SharedRow>();
    for (const row of data.attendance) {
      if (text(row, "shift_id") === activeId) map.set(text(row, "volunteer_id"), row);
    }
    return map;
  }, [data.attendance, activeId]);
  const waitlist = useMemo(
    () =>
      data.waitlists
        .filter((row) => text(row, "shift_id") === activeId)
        .sort((a, b) => number(a, "position") - number(b, "position")),
    [data.waitlists, activeId],
  );
  const pendingHours = useMemo(
    () => data.hourEntries.filter((row) => text(row, "status") === "pending"),
    [data.hourEntries],
  );

  function flash(tone: "good" | "bad", message: string) {
    setNotice({ tone, message });
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      await reload();
    } catch (error) {
      flash("bad", messageOf(error));
    } finally {
      setBusy("");
    }
  }

  function buildPlan() {
    if (!shift) return;
    const next = planShift(data, shift.id);
    setPlan(next);
    setPlanScope("shift");
    setRecoveryShifts(0);
    flash(
      next.length > 0 ? "good" : "bad",
      next.length > 0
        ? `Prepared ${next.length} assignment${next.length === 1 ? "" : "s"}. The server still checks every rule before applying them.`
        : "No volunteer is free for these slots. Add availability or adjust the roster by hand.",
    );
  }

  function buildRecovery() {
    const recovery = planUpcoming(data);
    setPlan(recovery.assignments);
    setPlanScope("recovery");
    setRecoveryShifts(recovery.shifts);
    flash(
      recovery.assignments.length > 0 ? "good" : "bad",
      recovery.assignments.length > 0
        ? `Rescue plan prepared: ${recovery.assignments.length} assignments across ${recovery.shifts} upcoming shifts, with ${recovery.unfilledSeats} seats still open.`
        : `No upcoming gap can be filled from this replica. ${recovery.unfilledSeats} seats remain open.`,
    );
  }

  async function applyPlan() {
    if (plan.length === 0) {
      flash("bad", "Build a plan before applying it.");
      return;
    }
    setBusy("plan");
    try {
      await applySharedRosterPlan(plan);
      setPlan([]);
      setRecoveryShifts(0);
      flash(
        "good",
        planScope === "recovery"
          ? "Rescue plan queued. The server applies every assignment or refuses the whole plan."
          : "Roster plan queued. It applies all assignments or none.",
      );
      await reload();
    } catch (error) {
      flash("bad", messageOf(error));
    } finally {
      setBusy("");
    }
  }

  return (
    <Page width="wide">
      <div className={styles.shell}>
        <PageHeader
          eyebrow="Shared coordinator"
          title="Participation"
          description="Attendance, waitlists, hours, and roster changes for one shift. Every action is a command that the server checks against the current organization."
          backTo="/shared"
          backLabel="Hosted workspace"
          actions={
            <Button
              variant="secondary"
              icon={<RefreshCw aria-hidden size={14} />}
              disabled={busy !== "" || !isTauri()}
              onClick={() => void reload()}
            >
              Sync now
            </Button>
          }
        />

        <SharedNav conflicts={sync.conflicts} />

        {!isTauri() ? (
          <DesktopOnlyNotice>
            Participation is written through the encrypted replica on this computer.
          </DesktopOnlyNotice>
        ) : (
          <>
            {notice ? (
              <p
                role="status"
                aria-live="polite"
                className={[
                  styles.notice,
                  notice.tone === "bad" ? styles.noticeError : styles.noticeGood,
                ].join(" ")}
              >
                {notice.message}
              </p>
            ) : null}

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <div>
                  <h2 className={styles.panelTitle}>Shift</h2>
                  <p className={styles.panelCopy}>
                    Choose the shift to work on. The list comes from the same replica as the
                    schedule.
                  </p>
                </div>
              </div>
              <div className={styles.panelBody}>
                {shifts.length === 0 ? (
                  <p className={styles.panelCopy}>No shifts have reached this computer yet.</p>
                ) : (
                  <>
                    <SelectField
                      label="Working shift"
                      value={activeId}
                      onChange={(event) => {
                        setSelectedId(event.target.value);
                        setPlan([]);
                      }}
                    >
                      {shifts.map((row) => (
                        <option key={row.id} value={row.id}>
                          {formatWhen(row.starts_at)} ·{" "}
                          {text(
                            data.opportunities.find(
                              (item) => item.id === text(row, "opportunity_id"),
                            ),
                            "title",
                          ) || "Opportunity"}
                        </option>
                      ))}
                    </SelectField>
                    {shift ? (
                      <div className={styles.stats} style={{ marginTop: 14 }}>
                        {[
                          ["Opportunity", text(opportunity ?? undefined, "title") || "—"],
                          ["Starts", formatWhen(shift.starts_at)],
                          ["Seats", `${number(shift, "confirmed")} / ${number(shift, "capacity")}`],
                          ["Status", text(shift, "status") || "scheduled"],
                        ].map(([label, value]) => (
                          <div key={label} className={styles.stat}>
                            <p className={styles.statLabel}>{label}</p>
                            <p className={styles.statValue} style={{ fontSize: 15 }}>
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </section>

            {shift ? (
              <>
                <section className={styles.panel} aria-labelledby="shared-roster">
                  <div className={styles.panelHead}>
                    <div>
                      <h2 id="shared-roster" className={styles.panelTitle}>
                        Roster
                      </h2>
                      <p className={styles.panelCopy}>
                        Check-in is recorded as an event. A correction never overwrites the original
                        time.
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <Button
                        variant="secondary"
                        icon={<Wand2 aria-hidden size={14} />}
                        disabled={busy !== "" || loading}
                        onClick={buildPlan}
                      >
                        Quick plan
                      </Button>
                      <Button
                        variant="ghost"
                        icon={<RefreshCw aria-hidden size={14} />}
                        disabled={busy !== "" || loading}
                        onClick={buildRecovery}
                      >
                        Rescue upcoming gaps
                      </Button>
                    </div>
                  </div>
                  <div className={styles.panelBody}>
                    {registrations.length === 0 ? (
                      <p className={styles.panelCopy}>
                        Nobody is registered for this shift. Volunteers can register from the hosted
                        app, or a quick plan can fill the open roles.
                      </p>
                    ) : (
                      registrations
                        .slice()
                        .sort((a, b) =>
                          text(volunteers.get(text(a, "volunteer_id")), "name").localeCompare(
                            text(volunteers.get(text(b, "volunteer_id")), "name"),
                          ),
                        )
                        .map((registration) => {
                          const volunteerId = text(registration, "volunteer_id");
                          const volunteer = volunteers.get(volunteerId);
                          const record = attendance.get(volunteerId);
                          const status = text(record ?? undefined, "status");
                          const rowStatus = text(registration, "status");
                          return (
                            <div key={registration.id} className={styles.rosterRow}>
                              <div>
                                <p className={styles.rosterName}>
                                  {text(volunteer, "name") || "Volunteer"}
                                </p>
                                <p className={styles.rosterMeta}>
                                  {text(registration, "role") || "Any role"} · {rowStatus}
                                  {status ? ` · attendance ${status}` : ""}
                                </p>
                              </div>
                              <div className={styles.actions}>
                                {!["checked_in", "completed"].includes(status) &&
                                ["registered", "confirmed"].includes(rowStatus) ? (
                                  <Button
                                    variant="secondary"
                                    size="small"
                                    icon={<LogIn aria-hidden size={13} />}
                                    disabled={busy !== ""}
                                    onClick={() =>
                                      void run(`in:${registration.id}`, () =>
                                        checkInShared(shift.id, volunteerId),
                                      )
                                    }
                                  >
                                    Check in
                                  </Button>
                                ) : null}
                                {status === "checked_in" ? (
                                  <Button
                                    variant="secondary"
                                    size="small"
                                    icon={<LogOut aria-hidden size={13} />}
                                    disabled={busy !== ""}
                                    onClick={() =>
                                      void run(`out:${registration.id}`, () =>
                                        checkOutShared(shift.id, volunteerId),
                                      )
                                    }
                                  >
                                    Check out
                                  </Button>
                                ) : null}
                                {["registered", "confirmed"].includes(rowStatus) ? (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="small"
                                      icon={<UserX aria-hidden size={13} />}
                                      disabled={busy !== ""}
                                      onClick={() =>
                                        void run(`no:${registration.id}`, () =>
                                          markNoShowShared(shift.id, volunteerId),
                                        )
                                      }
                                    >
                                      No-show
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="small"
                                      disabled={busy !== ""}
                                      onClick={() =>
                                        void run(`cancel:${registration.id}`, () =>
                                          cancelSharedRegistration(shift.id, volunteerId),
                                        )
                                      }
                                    >
                                      Cancel seat
                                    </Button>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                    )}

                    {waitlist.length > 0 ? (
                      <>
                        <p className={`${styles.sectionLabel} ${styles.spaceTop}`}>Waitlist</p>
                        {waitlist.map((entry) => (
                          <div key={entry.id} className={styles.rosterRow}>
                            <div>
                              <p className={styles.rosterName}>
                                {text(volunteers.get(text(entry, "volunteer_id")), "name") ||
                                  "Volunteer"}
                              </p>
                              <p className={styles.rosterMeta}>
                                Position {number(entry, "position")} ·{" "}
                                {text(entry, "eligible_role") || "Any role"} ·{" "}
                                {text(entry, "status")}
                              </p>
                            </div>
                          </div>
                        ))}
                      </>
                    ) : null}
                  </div>
                </section>

                <section className={styles.panel} aria-labelledby="shared-quick-plan">
                  <div className={styles.panelHead}>
                    <div>
                      <h2 id="shared-quick-plan" className={styles.panelTitle}>
                        {planScope === "recovery" ? "Rescue plan" : "Quick plan"}
                      </h2>
                      <p className={styles.panelCopy}>
                        {planScope === "recovery"
                          ? `A local plan across ${recoveryShifts} upcoming shifts. It fills only open seats, puts waitlisted volunteers first, and never double-books an overlap. The server applies every assignment or refuses the whole plan.`
                          : "A greedy local plan over the replica. It runs without a network, and the server applies all assignments or refuses the whole plan if the revision moved or any rule fails."}
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      icon={<Check aria-hidden size={14} />}
                      disabled={busy !== "" || plan.length === 0}
                      onClick={() => void applyPlan()}
                    >
                      {busy === "plan" ? "Applying…" : `Apply ${plan.length} assignments`}
                    </Button>
                  </div>
                  <div className={styles.panelBody}>
                    {plan.length === 0 ? (
                      <p className={styles.panelCopy}>
                        Use Quick plan to fill the open role slots, then review the names here.
                      </p>
                    ) : (
                      <ul className={styles.planList}>
                        {plan.map((assignment) => (
                          <li
                            key={`${assignment.shiftId}:${assignment.volunteerId}`}
                            className={styles.planItem}
                          >
                            <ClipboardCheck aria-hidden size={14} />
                            <span className={styles.strong}>
                              {text(volunteers.get(assignment.volunteerId), "name") || "Volunteer"}
                            </span>
                            <span className={styles.muted}>as {assignment.role}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </>
            ) : null}

            <section className={styles.panel} aria-labelledby="shared-hours">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="shared-hours" className={styles.panelTitle}>
                    Hours waiting for review
                  </h2>
                  <p className={styles.panelCopy}>
                    Approving keeps the submitted total or a lower number. A rejection needs a
                    reason the volunteer can read.
                  </p>
                </div>
              </div>
              <div className={styles.panelBody}>
                <div style={{ maxWidth: 360, marginBottom: 12 }}>
                  <TextField
                    label="Rejection reason"
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                  />
                </div>
                {pendingHours.length === 0 ? (
                  <p className={styles.panelCopy}>No hour entries are waiting.</p>
                ) : (
                  pendingHours.map((entry) => (
                    <div key={entry.id} className={styles.rosterRow}>
                      <div>
                        <p className={styles.rosterName}>
                          {text(volunteers.get(text(entry, "volunteer_id")), "name") || "Volunteer"}
                        </p>
                        <p className={styles.rosterMeta}>
                          {text(entry, "date")} · {number(entry, "minutes")} minutes ·{" "}
                          {text(entry, "status")}
                        </p>
                      </div>
                      <div className={styles.actions}>
                        <Button
                          variant="secondary"
                          size="small"
                          icon={<Check aria-hidden size={13} />}
                          disabled={busy !== ""}
                          onClick={() =>
                            void run(`approve:${entry.id}`, () =>
                              reviewSharedHours(entry, "verified", number(entry, "minutes")),
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          icon={<X aria-hidden size={13} />}
                          disabled={busy !== ""}
                          onClick={() =>
                            void run(`reject:${entry.id}`, () =>
                              reviewSharedHours(entry, "rejected", undefined, rejectReason),
                            )
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>
              {sync.online
                ? "Connected. A refusal lands in the conflict center with both values."
                : "Offline. These actions are queued and will be sent when the organization is reachable."}
            </p>
          </>
        )}
      </div>
    </Page>
  );
}

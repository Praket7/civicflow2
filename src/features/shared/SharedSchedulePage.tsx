import { useMemo, useState } from "react";
import { CalendarDays, Pencil, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import {
  Button,
  Page,
  PageHeader,
  SearchField,
  SelectField,
  TextField,
  TextareaField,
} from "../../components/ui";
import { t } from "../../lib/i18n";
import { isTauri } from "../../lib/platform";
import { useSharedReplica } from "../../lib/sync/sharedReplica";
import { number, text, type SharedRow } from "../../lib/sync/sharedRows";
import {
  createSharedOpportunity,
  createSharedSeries,
  createSharedShift,
  updateSharedShift,
} from "../../lib/sync/writes";
import { DesktopOnlyNotice } from "./DesktopOnlyNotice";
import { filterOpportunities, filterShifts, OPPORTUNITY_PAGE, SHIFT_PAGE } from "./scheduleFilter";
import { formatWhen } from "./sharedFormat";
import { SharedNav } from "./SharedNav";
import styles from "./shared.module.css";
import { messageOf } from "../../lib/errors";

function localInput(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function defaultDay(): string {
  const date = new Date(Date.now() + 86_400_000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function rolesText(roles: SharedRow[]): string {
  return roles.map((role) => `${text(role, "name")}:${number(role, "required")}`).join(", ");
}

function parseRoles(input: string): { name: string; required: number }[] {
  return input
    .split(",")
    .map((part) => {
      const [name, required] = part.split(":");
      return { name: name.trim(), required: Number(required ?? 1) };
    })
    .filter((role) => role.name !== "");
}

interface Notice {
  tone: "good" | "bad";
  message: string;
}

export function SharedSchedulePage() {
  const { sync, data, loading, reload, rebuild } = useSharedReplica();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showOpportunity, setShowOpportunity] = useState(false);
  const [showShift, setShowShift] = useState(false);
  const [editing, setEditing] = useState<SharedRow | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllOpportunities, setShowAllOpportunities] = useState(false);
  const [showAllShifts, setShowAllShifts] = useState(false);

  const [title, setTitle] = useState("");
  const [cause, setCause] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [coordinator, setCoordinator] = useState("");
  const [opportunityCapacity, setOpportunityCapacity] = useState("8");

  const [shiftOpportunity, setShiftOpportunity] = useState("");
  const [shiftDate, setShiftDate] = useState(defaultDay());
  const [shiftTime, setShiftTime] = useState("09:00");
  const [shiftMinutes, setShiftMinutes] = useState("180");
  const [shiftCapacity, setShiftCapacity] = useState("6");
  const [shiftRoles, setShiftRoles] = useState("Greeter:2, Stocker:2");
  const [shiftRepeat, setShiftRepeat] = useState("1");

  const [editStarts, setEditStarts] = useState("");
  const [editEnds, setEditEnds] = useState("");
  const [editCapacity, setEditCapacity] = useState("1");
  const [editStatus, setEditStatus] = useState("scheduled");
  const [editRoles, setEditRoles] = useState("");

  const opportunities = useMemo(
    () => [...data.opportunities].sort((a, b) => text(a, "title").localeCompare(text(b, "title"))),
    [data.opportunities],
  );
  const shifts = useMemo(
    () =>
      [...data.shifts].sort((a, b) =>
        String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")),
      ),
    [data.shifts],
  );
  const series = useMemo(
    () => [...data.series].sort((a, b) => text(a, "starts_on").localeCompare(text(b, "starts_on"))),
    [data.series],
  );
  const roleMap = useMemo(() => {
    const map = new Map<string, SharedRow[]>();
    for (const role of data.shiftRoles) {
      const shift = text(role, "shift_id");
      map.set(shift, [...(map.get(shift) ?? []), role]);
    }
    return map;
  }, [data.shiftRoles]);
  const opportunityMap = useMemo(
    () => new Map(data.opportunities.map((row) => [row.id, row])),
    [data.opportunities],
  );
  const matchedOpportunities = useMemo(
    () => filterOpportunities(opportunities, query),
    [opportunities, query],
  );
  const matchedShifts = useMemo(
    () => filterShifts(shifts, query, (id) => text(opportunityMap.get(id), "title"), formatWhen),
    [opportunityMap, query, shifts],
  );
  const visibleOpportunities = showAllOpportunities
    ? matchedOpportunities
    : matchedOpportunities.slice(0, OPPORTUNITY_PAGE);
  const visibleShifts = showAllShifts ? matchedShifts : matchedShifts.slice(0, SHIFT_PAGE);

  const openSeats = shifts.reduce(
    (total, shift) => total + Math.max(0, number(shift, "capacity") - number(shift, "confirmed")),
    0,
  );

  function startShift(opportunityId: string) {
    setShiftOpportunity(opportunityId);
    setShowShift(true);
    setShowOpportunity(false);
    setEditing(null);
  }

  async function submitOpportunity() {
    if (!title.trim()) {
      setNotice({ tone: "bad", message: "Give the opportunity a title." });
      return;
    }
    setBusy(true);
    try {
      await createSharedOpportunity({
        title,
        cause,
        description,
        address,
        coordinator,
        capacity: Number(opportunityCapacity) || 1,
      });
      setTitle("");
      setCause("");
      setDescription("");
      setAddress("");
      setCoordinator("");
      setShowOpportunity(false);
      setNotice({ tone: "good", message: "Opportunity queued for the organization." });
      await reload();
    } catch (error) {
      setNotice({ tone: "bad", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  async function submitShift() {
    if (!shiftOpportunity) {
      setNotice({ tone: "bad", message: "Choose the opportunity this shift belongs to." });
      return;
    }
    const starts = new Date(`${shiftDate}T${shiftTime}:00`);
    if (Number.isNaN(starts.getTime())) {
      setNotice({ tone: "bad", message: "Enter a valid start date and time." });
      return;
    }
    const minutes = Number(shiftMinutes) || 0;
    if (minutes < 15) {
      setNotice({ tone: "bad", message: "A shift needs at least fifteen minutes." });
      return;
    }
    const repeat = Math.max(1, Math.min(12, Math.trunc(Number(shiftRepeat) || 1)));
    setBusy(true);
    try {
      if (repeat > 1) {
        // One command, one transaction: either every weekly occurrence is in
        // the organization or none of them is.
        await createSharedSeries({
          opportunityId: shiftOpportunity,
          startsOn: shiftDate,
          startsTime: shiftTime,
          durationMinutes: minutes,
          capacity: Number(shiftCapacity) || 1,
          roles: parseRoles(shiftRoles),
          occurrenceCount: repeat,
        });
        setNotice({
          tone: "good",
          message: `Weekly series of ${repeat} shifts queued. The server applies all occurrences or none.`,
        });
      } else {
        await createSharedShift({
          opportunityId: shiftOpportunity,
          startsAt: starts.toISOString(),
          endsAt: new Date(starts.getTime() + minutes * 60_000).toISOString(),
          capacity: Number(shiftCapacity) || 1,
          roles: parseRoles(shiftRoles),
        });
        setNotice({ tone: "good", message: "Shift queued for the organization." });
      }
      setShowShift(false);
      setShiftRepeat("1");
      await reload();
    } catch (error) {
      setNotice({ tone: "bad", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(shift: SharedRow) {
    setEditing(shift);
    setEditStarts(localInput(shift.starts_at));
    setEditEnds(localInput(shift.ends_at));
    setEditCapacity(String(number(shift, "capacity")));
    setEditStatus(text(shift, "status") || "scheduled");
    setEditRoles(rolesText(roleMap.get(shift.id) ?? []));
    setShowShift(false);
    setShowOpportunity(false);
  }

  async function saveEdit() {
    if (!editing) return;
    const starts = new Date(editStarts);
    const ends = new Date(editEnds);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      setNotice({ tone: "bad", message: "A shift has to end after it starts." });
      return;
    }
    setBusy(true);
    try {
      await updateSharedShift(editing, {
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        capacity: Number(editCapacity) || 1,
        status: editStatus,
        roles: parseRoles(editRoles),
      });
      setEditing(null);
      setNotice({ tone: "good", message: "Shift change queued. The server will confirm it." });
      await reload();
    } catch (error) {
      setNotice({ tone: "bad", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  async function cancelShift(shift: SharedRow) {
    setBusy(true);
    try {
      await updateSharedShift(shift, { status: "canceled" });
      setCanceling(null);
      setNotice({ tone: "good", message: "Shift cancellation queued." });
      await reload();
    } catch (error) {
      setNotice({ tone: "bad", message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page width="wide">
      <div className={styles.shell}>
        <PageHeader
          eyebrow="Shared coordinator"
          title="Schedule"
          description="Create opportunities and shifts in the hosted organization. Writes enter a local outbox first, so the screen keeps working offline and the server confirms them later."
          backTo="/shared"
          backLabel="Hosted workspace"
          actions={
            <div className={styles.actions}>
              <Button
                variant="secondary"
                icon={<RefreshCw aria-hidden size={14} />}
                disabled={busy || !isTauri()}
                onClick={() => void reload()}
              >
                {busy ? "Working…" : "Sync now"}
              </Button>
              <Button
                variant="ghost"
                icon={<RotateCcw aria-hidden size={14} />}
                disabled={busy || !isTauri()}
                onClick={() => void rebuild()}
              >
                Rebuild
              </Button>
            </div>
          }
        />

        <SharedNav conflicts={sync.conflicts} />

        {!isTauri() ? (
          <DesktopOnlyNotice>
            The browser build uses the hosted workspace. Open CivicFlow on this computer to write
            through the encrypted replica.
          </DesktopOnlyNotice>
        ) : (
          <>
            <section className={styles.stats} aria-label="Schedule summary">
              {[
                ["Opportunities", String(opportunities.length), "Programs in this organization"],
                ["Shifts", String(shifts.length), "Scheduled work"],
                ["Open seats", String(openSeats), "Unfilled places"],
                ["Waiting to upload", String(sync.pending), "Local commands not yet sent"],
              ].map(([label, value, hint]) => (
                <div key={label} className={styles.stat}>
                  <p className={styles.statLabel}>{label}</p>
                  <p className={styles.statValue}>{value}</p>
                  <p className={styles.statHint}>{hint}</p>
                </div>
              ))}
            </section>

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

            {loading ? (
              <p className={styles.notice}>Reading the shared schedule from this computer…</p>
            ) : null}

            <section className={styles.scheduleFilter} aria-label="Find in this schedule">
              <SearchField
                value={query}
                onChange={setQuery}
                label="Find a program or shift"
                placeholder="Find a program, cause, address, or shift status"
              />
              <p className={styles.filterNote} role="status" aria-live="polite">
                {query.trim()
                  ? `${matchedOpportunities.length} of ${opportunities.length} programs · ${matchedShifts.length} of ${shifts.length} shifts`
                  : `${opportunities.length} programs · ${shifts.length} shifts`}
              </p>
            </section>

            <section className={styles.panel} aria-labelledby="shared-opportunities">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="shared-opportunities" className={styles.panelTitle}>
                    Opportunities
                  </h2>
                  <p className={styles.panelCopy}>
                    A shift always belongs to one opportunity. The organization name and coordinator
                    are filled in by the server when they are left blank.
                  </p>
                </div>
                <div className={styles.actions}>
                  <Button
                    variant={showOpportunity ? "ghost" : "secondary"}
                    icon={
                      showOpportunity ? <X aria-hidden size={14} /> : <Plus aria-hidden size={14} />
                    }
                    disabled={busy}
                    onClick={() => {
                      setShowOpportunity((open) => !open);
                      setShowShift(false);
                      setEditing(null);
                    }}
                  >
                    {showOpportunity ? "Close" : "New opportunity"}
                  </Button>
                </div>
              </div>
              <div className={styles.panelBody}>
                {showOpportunity ? (
                  <form
                    className={styles.formGrid}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitOpportunity();
                    }}
                  >
                    <TextField
                      label="Title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      required
                    />
                    <TextField
                      label="Cause"
                      value={cause}
                      onChange={(event) => setCause(event.target.value)}
                      placeholder="Food security"
                    />
                    <TextField
                      label="Address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                    <TextField
                      label="Coordinator"
                      value={coordinator}
                      onChange={(event) => setCoordinator(event.target.value)}
                    />
                    <TextField
                      label="Capacity"
                      type="number"
                      min={1}
                      value={opportunityCapacity}
                      onChange={(event) => setOpportunityCapacity(event.target.value)}
                    />
                    <div />
                    <div className={styles.spanTwo}>
                      <TextareaField
                        label="Description"
                        rows={3}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>
                    <div className={`${styles.actions} ${styles.spanTwo}`}>
                      <Button type="submit" variant="primary" disabled={busy}>
                        Queue opportunity
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setShowOpportunity(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : opportunities.length === 0 ? (
                  <p className={styles.panelCopy}>
                    This organization has no opportunities yet. Create one, then add its first
                    shift.
                  </p>
                ) : matchedOpportunities.length === 0 ? (
                  <p className={styles.panelCopy}>{t("No programs match those filters")}</p>
                ) : (
                  <>
                    <div className={styles.opportunityList}>
                      {visibleOpportunities.map((opportunity) => (
                        <article key={opportunity.id} className={styles.opportunity}>
                          <div>
                            <h3 className={styles.opportunityTitle}>
                              {text(opportunity, "title")}
                            </h3>
                            <p className={styles.opportunityMeta}>
                              {text(opportunity, "cause") || "General volunteering"}
                              {text(opportunity, "address")
                                ? ` · ${text(opportunity, "address")}`
                                : ""}
                            </p>
                            {text(opportunity, "description") ? (
                              <p className={styles.opportunityMeta}>
                                {text(opportunity, "description")}
                              </p>
                            ) : null}
                          </div>
                          <div className={styles.actions}>
                            <Button
                              variant="secondary"
                              size="small"
                              icon={<Plus aria-hidden size={13} />}
                              disabled={busy}
                              onClick={() => startShift(opportunity.id)}
                            >
                              Add shift
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                    {visibleOpportunities.length < matchedOpportunities.length ? (
                      <div className={styles.listMore}>
                        <p className={styles.filterNote}>
                          {`Showing ${visibleOpportunities.length} of ${matchedOpportunities.length} programs.`}
                        </p>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => setShowAllOpportunities(true)}
                        >
                          {t("Show all {count}", { count: matchedOpportunities.length })}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </section>

            {showShift ? (
              <section className={styles.panel} aria-labelledby="new-shared-shift">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="new-shared-shift" className={styles.panelTitle}>
                      New shift
                    </h2>
                    <p className={styles.panelCopy}>
                      Times are entered in this computer&apos;s timezone and stored as an absolute
                      instant.
                    </p>
                  </div>
                </div>
                <div className={styles.panelBody}>
                  <form
                    className={styles.formGrid}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitShift();
                    }}
                  >
                    <SelectField
                      label="Opportunity"
                      value={shiftOpportunity}
                      onChange={(event) => setShiftOpportunity(event.target.value)}
                      required
                    >
                      <option value="">Choose an opportunity</option>
                      {opportunities.map((opportunity) => (
                        <option key={opportunity.id} value={opportunity.id}>
                          {text(opportunity, "title")}
                        </option>
                      ))}
                    </SelectField>
                    <TextField
                      label="Date"
                      type="date"
                      value={shiftDate}
                      onChange={(event) => setShiftDate(event.target.value)}
                      required
                    />
                    <TextField
                      label="Starts"
                      type="time"
                      value={shiftTime}
                      onChange={(event) => setShiftTime(event.target.value)}
                      required
                    />
                    <TextField
                      label="Minutes"
                      type="number"
                      min={15}
                      step={15}
                      value={shiftMinutes}
                      onChange={(event) => setShiftMinutes(event.target.value)}
                    />
                    <TextField
                      label="Seats"
                      type="number"
                      min={1}
                      value={shiftCapacity}
                      onChange={(event) => setShiftCapacity(event.target.value)}
                    />
                    <TextField
                      label="Repeats"
                      type="number"
                      min={1}
                      max={12}
                      value={shiftRepeat}
                      onChange={(event) => setShiftRepeat(event.target.value)}
                      hint="Weekly occurrences. One publishes a single shift; two to twelve publish an atomic series."
                    />
                    <div className={styles.spanTwo}>
                      <TextField
                        label="Roles"
                        value={shiftRoles}
                        onChange={(event) => setShiftRoles(event.target.value)}
                        hint="Comma-separated role:seats, for example Greeter:2, Stocker:2"
                      />
                    </div>
                    <div className={`${styles.actions} ${styles.spanTwo}`}>
                      <Button type="submit" variant="primary" disabled={busy}>
                        {Math.max(1, Math.trunc(Number(shiftRepeat) || 1)) > 1
                          ? "Queue series"
                          : "Queue shift"}
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setShowShift(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </div>
              </section>
            ) : null}

            {editing ? (
              <section className={styles.panel} aria-labelledby="edit-shared-shift">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="edit-shared-shift" className={styles.panelTitle}>
                      Edit shift
                    </h2>
                    <p className={styles.panelCopy}>
                      The command carries the version this form was opened at. If someone else
                      changed the shift first, the server refuses it and the conflict center
                      explains both values.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    icon={<X aria-hidden size={14} />}
                    onClick={() => setEditing(null)}
                  >
                    Close
                  </Button>
                </div>
                <div className={styles.panelBody}>
                  <form
                    className={styles.formGrid}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit();
                    }}
                  >
                    <TextField
                      label="Starts"
                      type="datetime-local"
                      value={editStarts}
                      onChange={(event) => setEditStarts(event.target.value)}
                      required
                    />
                    <TextField
                      label="Ends"
                      type="datetime-local"
                      value={editEnds}
                      onChange={(event) => setEditEnds(event.target.value)}
                      required
                    />
                    <TextField
                      label="Seats"
                      type="number"
                      min={1}
                      value={editCapacity}
                      onChange={(event) => setEditCapacity(event.target.value)}
                    />
                    <SelectField
                      label="Status"
                      value={editStatus}
                      onChange={(event) => setEditStatus(event.target.value)}
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="canceled">Canceled</option>
                    </SelectField>
                    <div className={styles.spanTwo}>
                      <TextField
                        label="Roles"
                        value={editRoles}
                        onChange={(event) => setEditRoles(event.target.value)}
                        hint="Removing a role that still has volunteers is refused."
                      />
                    </div>
                    <div className={`${styles.actions} ${styles.spanTwo}`}>
                      <Button type="submit" variant="primary" disabled={busy}>
                        Queue change
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </div>
              </section>
            ) : null}

            {series.length > 0 ? (
              <section className={styles.panel} aria-labelledby="shared-series">
                <div className={styles.panelHead}>
                  <div>
                    <h2 id="shared-series" className={styles.panelTitle}>
                      Repeating series
                    </h2>
                    <p className={styles.panelCopy}>
                      Each series was published as one command. Editing one occurrence never moves
                      the others.
                    </p>
                  </div>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <caption className="visually-hidden">Repeating shift series</caption>
                      <thead>
                        <tr>
                          <th scope="col">Opportunity</th>
                          <th scope="col">First day</th>
                          <th scope="col">Local start</th>
                          <th scope="col">Occurrences</th>
                          <th scope="col">Every</th>
                        </tr>
                      </thead>
                      <tbody>
                        {series.map((row) => (
                          <tr key={row.id}>
                            <td className={styles.strong}>
                              {text(opportunityMap.get(text(row, "opportunity_id")), "title") ||
                                "Opportunity"}
                            </td>
                            <td>{text(row, "starts_on") || "—"}</td>
                            <td className={styles.muted}>
                              {text(row, "starts_local_time") || "—"} ·{" "}
                              {number(row, "duration_minutes")} minutes
                            </td>
                            <td>{number(row, "occurrence_count") || "Open-ended"}</td>
                            <td className={styles.muted}>
                              {number(row, "interval_weeks") === 1
                                ? "Week"
                                : `${number(row, "interval_weeks")} weeks`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            <section className={styles.panel} aria-labelledby="shared-shifts">
              <div className={styles.panelHead}>
                <div>
                  <h2 id="shared-shifts" className={styles.panelTitle}>
                    Shifts
                  </h2>
                  <p className={styles.panelCopy}>
                    Confirmed seats come from the organization&apos;s registrations, not from this
                    screen.
                  </p>
                </div>
                <Button
                  variant={showShift ? "ghost" : "secondary"}
                  icon={
                    showShift ? <X aria-hidden size={14} /> : <CalendarDays aria-hidden size={14} />
                  }
                  disabled={busy || opportunities.length === 0}
                  onClick={() => {
                    setShowShift((open) => !open);
                    setShowOpportunity(false);
                    setEditing(null);
                    if (!shiftOpportunity && opportunities[0]) {
                      setShiftOpportunity(opportunities[0].id);
                    }
                  }}
                >
                  {showShift ? "Close" : "New shift"}
                </Button>
              </div>
              <div className={styles.panelBody}>
                {shifts.length === 0 ? (
                  <p className={styles.panelCopy}>
                    No shifts have reached this computer yet. If the organization has some, use
                    Rebuild to take a fresh copy.
                  </p>
                ) : matchedShifts.length === 0 ? (
                  <p className={styles.panelCopy}>{t("No shift in this filter")}</p>
                ) : (
                  <>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <caption className="visually-hidden">
                          Shifts in the shared organization
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Starts</th>
                            <th scope="col">Opportunity</th>
                            <th scope="col">Roles</th>
                            <th scope="col">Seats</th>
                            <th scope="col">Status</th>
                            <th scope="col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleShifts.map((shift) => {
                            const roles = roleMap.get(shift.id) ?? [];
                            const status = text(shift, "status") || "scheduled";
                            return (
                              <tr key={shift.id}>
                                <td className={styles.strong}>{formatWhen(shift.starts_at)}</td>
                                <td>
                                  {text(
                                    opportunityMap.get(text(shift, "opportunity_id")),
                                    "title",
                                  ) || "Opportunity"}
                                </td>
                                <td className={styles.muted}>
                                  {roles.length === 0
                                    ? "No roles"
                                    : roles
                                        .map(
                                          (role) =>
                                            `${text(role, "name")} ${number(role, "filled")}/${number(
                                              role,
                                              "required",
                                            )}`,
                                        )
                                        .join(", ")}
                                </td>
                                <td>
                                  {number(shift, "confirmed")} / {number(shift, "capacity")}
                                </td>
                                <td>
                                  <span
                                    className={[
                                      styles.pill,
                                      status === "canceled" ? styles.pillBad : styles.pillGood,
                                    ].join(" ")}
                                  >
                                    {status}
                                  </span>
                                </td>
                                <td>
                                  <div className={styles.actions}>
                                    <Button
                                      variant="ghost"
                                      size="small"
                                      icon={<Pencil aria-hidden size={13} />}
                                      disabled={busy}
                                      onClick={() => startEdit(shift)}
                                    >
                                      Edit
                                    </Button>
                                    {status === "canceled" ? null : canceling === shift.id ? (
                                      <>
                                        <Button
                                          variant="danger"
                                          size="small"
                                          disabled={busy}
                                          onClick={() => void cancelShift(shift)}
                                        >
                                          Confirm cancel
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="small"
                                          disabled={busy}
                                          onClick={() => setCanceling(null)}
                                        >
                                          Keep
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        variant="ghost"
                                        size="small"
                                        disabled={busy}
                                        onClick={() => setCanceling(shift.id)}
                                      >
                                        Cancel shift
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {visibleShifts.length < matchedShifts.length ? (
                      <div className={styles.listMore}>
                        <p className={styles.filterNote}>
                          {`Showing ${visibleShifts.length} of ${matchedShifts.length} shifts.`}
                        </p>{" "}
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => setShowAllShifts(true)}
                        >
                          {t("Show all {count}", { count: matchedShifts.length })}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </section>

            <p className={styles.muted} style={{ margin: 0, fontSize: 12.5 }}>
              {sync.online
                ? "Connected. Changes upload in creation order and the server decides what is accepted."
                : "Working from this computer. Queued changes stay here until the organization is reachable."}
            </p>
          </>
        )}
      </div>
    </Page>
  );
}

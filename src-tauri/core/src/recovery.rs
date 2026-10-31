//! Coverage rescue: what a coordinator needs when the roster breaks the morning
//! of a shift.
//!
//! Detection is a read: which required seats on upcoming shifts are open, and
//! which assignments are about to fail a requirement. Planning reuses the same
//! eligibility gates and score components as AutoRoster, but it solves a
//! different objective. A recovery plan is judged on how little it disturbs the
//! roster it is repairing, so the costs are explicit: a seat filled by an
//! unassigned volunteer costs nothing, moving somebody who is already assigned on
//! an affected shift costs [`MOVE_COST`], and a locked assignment is never moved
//! at all. Coverage comes first: a move is only offered when the seat it vacates
//! can be refilled, so a recovery plan never leaves the roster worse than it found
//! it.
//!
//! Nothing here writes unless a coordinator approves it. `plan` returns the
//! changes and `apply` performs the ones that were selected, in one transaction
//! with one audit event per change.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::auth::Account;
use crate::error::{CoreError, Result};
use crate::matching::{
    explain_selection, is_eligible_explained, Candidate, MatchExplanation, RosterOptions, Slot,
    TimeBlock,
};
use crate::models::WorkspaceSnapshot;
use crate::roster;
use crate::services::now;
use crate::workflows::{append_actor_audit, snapshot};

/// Larger than any score component: one move beats two better-scoring switches.
pub const MOVE_COST: i32 = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisruptedRole {
    pub role: String,
    pub required: i64,
    pub filled: i64,
    /// Required seats with nobody in them.
    pub open: i64,
}

/// One shift that cannot start fully staffed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisruptedShift {
    pub shift_id: String,
    pub opportunity_id: String,
    pub title: String,
    pub starts_at: String,
    pub capacity: i64,
    pub confirmed: i64,
    /// Only the roles that are short.
    pub roles: Vec<DisruptedRole>,
    /// What went wrong here, in the coordinator's words: who canceled, who did
    /// not show, and how many people are waiting.
    pub reasons: Vec<String>,
}

/// A required credential that will not be valid when the shift starts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AtRiskAssignment {
    pub shift_id: String,
    pub shift_title: String,
    pub starts_at: String,
    pub volunteer_id: String,
    pub volunteer_name: String,
    pub role: String,
    pub credential: String,
    pub valid_through: Option<String>,
    pub expired: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DisruptionReport {
    pub now: String,
    pub shifts: Vec<DisruptedShift>,
    pub open_required: i64,
    pub at_risk: Vec<AtRiskAssignment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryChangeKind {
    /// An unassigned volunteer takes an open seat.
    Assign,
    /// A waitlisted volunteer is promoted into it.
    Promote,
    /// A volunteer already assigned on an affected shift moves to a required seat.
    Move,
}

impl RecoveryChangeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Assign => "assign",
            Self::Promote => "promote",
            Self::Move => "move",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryChange {
    pub kind: RecoveryChangeKind,
    pub shift_id: String,
    pub shift_title: String,
    pub starts_at: String,
    pub role: String,
    /// The seat a move leaves behind, so the screen can name both ends.
    pub from_role: Option<String>,
    pub volunteer_id: String,
    pub volunteer_name: String,
    pub volunteer_initials: String,
    pub score: i32,
    pub cost: i32,
    pub reason: String,
}

/// A required seat the plan could not fill, with the reason it could not.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySeat {
    pub shift_id: String,
    pub role: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPlan {
    pub shifts: Vec<DisruptedShift>,
    pub changes: Vec<RecoveryChange>,
    pub remaining: Vec<RecoverySeat>,
    pub open_before: i64,
    pub open_after: i64,
    /// Assignments the plan disturbs, which is the number a coordinator weighs.
    pub moved_assignments: i64,
    pub policy_version: i64,
}

/// Which required seats are open, and what happened to them.
pub fn detect(conn: &Connection) -> Result<DisruptionReport> {
    let now = now(conn)?;
    // Recovery reads a whole roster and names people, so it refuses to run
    // without a chosen organization instead of guessing one.
    let organization = crate::scope::require(conn)?;
    let mut statement = conn.prepare(
        "SELECT s.id, s.opportunity_id, o.title, s.starts_at, s.capacity, s.confirmed,
                sr.name, sr.required, sr.filled
         FROM shifts s
         JOIN opportunities o ON o.id = s.opportunity_id
         JOIN shift_roles sr ON sr.shift_id = s.id
         WHERE s.status = 'scheduled' AND sr.required > sr.filled
           AND o.organization_id = ?1
         ORDER BY s.starts_at, s.id, sr.rowid",
    )?;
    let mut rows = statement.query(params![organization])?;
    let mut shifts: Vec<DisruptedShift> = Vec::new();
    while let Some(row) = rows.next()? {
        let starts_raw: String = row.get(3)?;
        let Some(starts_at) = parse_datetime(&starts_raw) else {
            continue;
        };
        if starts_at <= now {
            continue;
        }
        let required: i64 = row.get(7)?;
        let filled: i64 = row.get(8)?;
        let shift_id: String = row.get(0)?;
        let role = DisruptedRole {
            role: row.get(6)?,
            required,
            filled,
            open: required - filled,
        };
        match shifts.iter_mut().find(|item| item.shift_id == shift_id) {
            Some(existing) => existing.roles.push(role),
            None => shifts.push(DisruptedShift {
                shift_id,
                opportunity_id: row.get(1)?,
                title: row.get(2)?,
                starts_at: starts_raw,
                capacity: row.get(4)?,
                confirmed: row.get(5)?,
                roles: vec![role],
                reasons: Vec::new(),
            }),
        }
    }
    drop(rows);
    drop(statement);

    for shift in &mut shifts {
        shift.reasons = shift_reasons(conn, &shift.shift_id)?;
    }

    let open_required = shifts
        .iter()
        .flat_map(|shift| shift.roles.iter())
        .map(|role| role.open)
        .sum();

    Ok(DisruptionReport {
        now: now.to_rfc3339(),
        shifts,
        open_required,
        at_risk: at_risk_assignments(conn, now, &organization)?,
    })
}

fn parse_datetime(raw: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(raw).ok()
}

/// Why this shift is short, from the records rather than from a guess.
fn shift_reasons(conn: &Connection, shift_id: &str) -> Result<Vec<String>> {
    let mut reasons = Vec::new();
    let canceled: i64 = conn.query_row(
        "SELECT COUNT(*) FROM registrations WHERE shift_id = ?1 AND status = 'canceled'",
        params![shift_id],
        |row| row.get(0),
    )?;
    if canceled > 0 {
        reasons.push(format!(
            "{canceled} volunteer{} canceled",
            if canceled == 1 { "" } else { "s" }
        ));
    }
    let no_shows: i64 = conn.query_row(
        "SELECT COUNT(*) FROM attendance_events
         WHERE shift_id = ?1 AND status = 'no_show'",
        params![shift_id],
        |row| row.get(0),
    )?;
    if no_shows > 0 {
        reasons.push(format!("{no_shows} did not attend a previous shift"));
    }
    let waiting: i64 = conn.query_row(
        "SELECT COUNT(*) FROM waitlist_entries WHERE shift_id = ?1 AND status = 'waiting'",
        params![shift_id],
        |row| row.get(0),
    )?;
    if waiting > 0 {
        reasons.push(format!("{waiting} waiting on the waitlist",));
    }
    if reasons.is_empty() {
        reasons.push("nobody has taken these seats yet".into());
    }
    Ok(reasons)
}

/// Still registered, so these are not open seats; a coordinator decides.
fn at_risk_assignments(
    conn: &Connection,
    now: chrono::DateTime<chrono::FixedOffset>,
    organization: &str,
) -> Result<Vec<AtRiskAssignment>> {
    // The credential risk list names volunteers and the requirement they will
    // miss, so it follows the same organization boundary as the shift list.
    let mut statement = conn.prepare(
        "SELECT s.id, o.title, s.starts_at, r.volunteer_id, v.name, r.role,
                ct.name, vc.valid_through
         FROM registrations r
         JOIN shifts s ON s.id = r.shift_id
         JOIN opportunities o ON o.id = s.opportunity_id
         JOIN volunteers v ON v.id = r.volunteer_id
         JOIN role_requirements rr ON rr.shift_id = s.id AND rr.role_name = r.role
         JOIN credential_types ct ON ct.id = rr.credential_type_id
         LEFT JOIN volunteer_credentials vc
                ON vc.volunteer_id = r.volunteer_id AND vc.credential_type_id = ct.id
         WHERE r.status = 'registered' AND s.status = 'scheduled'
           AND o.organization_id = ?1
         ORDER BY s.starts_at, v.name",
    )?;
    let mut rows = statement.query(params![organization])?;
    let mut at_risk = Vec::new();
    while let Some(row) = rows.next()? {
        let starts_raw: String = row.get(2)?;
        let Some(starts_at) = parse_datetime(&starts_raw) else {
            continue;
        };
        if starts_at <= now {
            continue;
        }
        let valid_through: Option<String> = row.get(7)?;
        let expires = valid_through
            .as_deref()
            .and_then(|raw| chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok());
        let expired = match expires {
            Some(date) => date < starts_at.date_naive(),
            None => true,
        };
        if !expired {
            continue;
        }
        at_risk.push(AtRiskAssignment {
            shift_id: row.get(0)?,
            shift_title: row.get(1)?,
            starts_at: starts_raw,
            volunteer_id: row.get(3)?,
            volunteer_name: row.get(4)?,
            role: row.get(5)?,
            credential: row.get(6)?,
            valid_through,
            expired: expires.is_some(),
        });
    }
    Ok(at_risk)
}

/// The seats a recovery plan may work with.
type Seat = Slot;

/// A candidate for one seat, before the plan commits to it.
struct SeatOption {
    candidate: Candidate,
    score: i32,
    cost: i32,
    kind: RecoveryChangeKind,
    from_role: Option<String>,
    explanation: MatchExplanation,
}

/// The same person without this shift's commitment; a role change is not a
/// double booking.
fn as_mover(candidate: &Candidate, slot: &Slot) -> Candidate {
    let mut mover = candidate.clone();
    mover.assigned_shift_ids.remove(&slot.shift_id);
    mover.assigned_blocks.retain(|block: &TimeBlock| {
        !(block.starts_at == slot.starts_at && block.ends_at == slot.ends_at)
    });
    mover
}

fn reason_for(
    explanation: &MatchExplanation,
    kind: RecoveryChangeKind,
    from_role: Option<&str>,
) -> String {
    let components = explanation
        .components
        .iter()
        .filter(|component| component.awarded > 0)
        .map(|component| {
            format!(
                "{} {}/{}",
                component.label, component.awarded, component.maximum
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let lead = match kind {
        RecoveryChangeKind::Assign => "Free at this time and meets every requirement".to_string(),
        RecoveryChangeKind::Promote => "Already waiting for this shift".to_string(),
        RecoveryChangeKind::Move => format!(
            "Moves from {} to cover a required seat",
            from_role.unwrap_or("another role")
        ),
    };
    if components.is_empty() {
        lead
    } else {
        format!("{lead}: {components}")
    }
}

fn option_for(
    candidate: &Candidate,
    slot: &Seat,
    policy: &crate::policy::RosterPolicy,
    options: &RosterOptions,
    kind: RecoveryChangeKind,
    cost: i32,
    from_role: Option<String>,
) -> Option<SeatOption> {
    let evaluated = match kind {
        RecoveryChangeKind::Move => as_mover(candidate, slot),
        _ => candidate.clone(),
    };
    if !is_eligible_explained(&evaluated, slot, policy, options) {
        return None;
    }
    let explanation = explain_selection(&evaluated, slot, policy, options, false);
    let score = explanation.total_score.unwrap_or(0);
    Some(SeatOption {
        candidate: candidate.clone(),
        score,
        cost,
        kind,
        from_role,
        explanation,
    })
}

/// The best option for a seat: cheapest change first, then match quality, then a
/// stable tiebreak so the same roster always produces the same plan.
fn best(options: Vec<SeatOption>) -> Option<SeatOption> {
    options.into_iter().min_by(|left, right| {
        left.cost
            .cmp(&right.cost)
            .then(right.score.cmp(&left.score))
            .then(left.candidate.id.cmp(&right.candidate.id))
    })
}

/// The sentence for a seat nobody can take.
fn unfilled_reason(
    candidates: &[Candidate],
    slot: &Seat,
    policy: &crate::policy::RosterPolicy,
    options: &RosterOptions,
) -> String {
    let mut best_failure: Option<(usize, String)> = None;
    for candidate in candidates {
        let explanation = explain_selection(candidate, slot, policy, options, false);
        let passed = explanation
            .checks
            .iter()
            .filter(|check| check.passed)
            .count();
        let failed = explanation.checks.iter().find(|check| !check.passed);
        if let Some(check) = failed {
            let sentence = format!("{}: {}", check.name, check.detail);
            match &best_failure {
                Some((best_passed, _)) if *best_passed >= passed => {}
                _ => best_failure = Some((passed, sentence)),
            }
        }
    }
    best_failure
        .map(|(_, sentence)| sentence)
        .unwrap_or_else(|| "No volunteer meets this role's requirements".into())
}

/// A recovery plan for the requested shifts: what to add, who to move, what
/// cannot be fixed, and what it costs.
pub fn plan(
    conn: &Connection,
    shift_ids: &[String],
    options: &RosterOptions,
) -> Result<RecoveryPlan> {
    if shift_ids.is_empty() {
        return Err(CoreError::Validation(
            "Choose at least one shift to recover".into(),
        ));
    }
    let now = now(conn)?;
    let policy = roster::policy_for_workspace(conn)?;
    let report = detect(conn)?;
    let affected: Vec<DisruptedShift> = report
        .shifts
        .into_iter()
        .filter(|shift| shift_ids.contains(&shift.shift_id))
        .collect();

    let seats: Vec<Seat> = roster::load_open_slots(conn, shift_ids, now)?;
    let open_before = seats.len() as i64;
    let candidates = roster::load_candidates(conn, now, options)?;
    let assignments = roster::current_assignments(conn)?;
    let declined = roster::declined_on(conn, shift_ids)?;
    let affected_shifts: HashSet<String> = shift_ids.iter().cloned().collect();

    let mut used: HashSet<String> = HashSet::new();
    let mut changes: Vec<RecoveryChange> = Vec::new();
    let mut unsolved: Vec<Seat> = Vec::new();

    // Pass one: seats that can be covered without touching anybody. An unassigned
    // volunteer or a promoted waitlist entry costs nothing, so those are taken
    // first even when a move would score higher.
    for slot in &seats {
        let mut options_here = Vec::new();
        for candidate in &candidates {
            if used.contains(&candidate.id) || declined.contains(&candidate.id) {
                continue;
            }
            if candidate.assigned_shift_ids.contains(&slot.shift_id) {
                continue;
            }
            let waiting = candidate.waitlisted_shift_ids.contains(&slot.shift_id);
            if waiting && !options.include_waitlist {
                continue;
            }
            let kind = if waiting {
                RecoveryChangeKind::Promote
            } else {
                RecoveryChangeKind::Assign
            };
            if let Some(found) = option_for(candidate, slot, &policy, options, kind, 0, None) {
                options_here.push(found);
            }
        }
        match best(options_here) {
            Some(choice) => {
                used.insert(choice.candidate.id.clone());
                changes.push(change_from(&choice, slot));
            }
            None => unsolved.push(slot.clone()),
        }
    }
    let mut remaining: Vec<RecoverySeat> = Vec::new();

    // Pass two: for the seats still open, offer a move — but only when the seat
    // the volunteer leaves can be refilled in the same plan, so coverage never
    // drops. A locked assignment is not a candidate at all.
    for slot in &unsolved {
        let mut accepted: Option<(SeatOption, RecoveryChange)> = None;
        for assignment in &assignments {
            if !affected_shifts.contains(&assignment.shift_id) || assignment.locked {
                continue;
            }
            if used.contains(&assignment.volunteer_id) {
                continue;
            }
            let Some(candidate) = candidates
                .iter()
                .find(|row| row.id == assignment.volunteer_id)
            else {
                continue;
            };
            let Some(choice) = option_for(
                candidate,
                slot,
                &policy,
                options,
                RecoveryChangeKind::Move,
                MOVE_COST,
                Some(assignment.role.clone()),
            ) else {
                continue;
            };
            let Some(vacated) =
                roster::find_role_slot(conn, &assignment.shift_id, &assignment.role, now)?
            else {
                continue;
            };
            let replacement = candidates.iter().find_map(|spare| {
                if spare.id == candidate.id
                    || used.contains(&spare.id)
                    || declined.contains(&spare.id)
                {
                    return None;
                }
                if spare.assigned_shift_ids.contains(&vacated.shift_id) {
                    return None;
                }
                option_for(
                    spare,
                    &vacated,
                    &policy,
                    options,
                    if spare.waitlisted_shift_ids.contains(&vacated.shift_id)
                        && options.include_waitlist
                    {
                        RecoveryChangeKind::Promote
                    } else {
                        RecoveryChangeKind::Assign
                    },
                    0,
                    None,
                )
            });
            let Some(replacement) = replacement else {
                continue;
            };
            let better = match &accepted {
                Some((current, _)) => {
                    choice.cost < current.cost
                        || (choice.cost == current.cost && choice.score > current.score)
                }
                None => true,
            };
            if better {
                accepted = Some((choice, change_from(&replacement, &vacated)));
            }
        }

        match accepted {
            Some((choice, replacement)) => {
                used.insert(choice.candidate.id.clone());
                used.insert(replacement.volunteer_id.clone());
                changes.push(change_from(&choice, slot));
                changes.push(replacement);
            }
            None => remaining.push(RecoverySeat {
                shift_id: slot.shift_id.clone(),
                role: slot.role.clone(),
                reason: unfilled_reason(&candidates, slot, &policy, options),
            }),
        }
    }

    let moved_assignments = changes
        .iter()
        .filter(|change| change.kind == RecoveryChangeKind::Move)
        .count() as i64;
    let open_after = remaining.len() as i64;

    Ok(RecoveryPlan {
        shifts: affected,
        changes,
        remaining,
        open_before,
        open_after,
        moved_assignments,
        policy_version: policy.version,
    })
}

fn change_from(choice: &SeatOption, slot: &Seat) -> RecoveryChange {
    RecoveryChange {
        kind: choice.kind,
        shift_id: slot.shift_id.clone(),
        shift_title: slot.shift_title.clone(),
        starts_at: slot.starts_at.to_rfc3339(),
        role: slot.role.clone(),
        from_role: choice.from_role.clone(),
        volunteer_id: choice.candidate.id.clone(),
        volunteer_name: choice.candidate.name.clone(),
        volunteer_initials: choice.candidate.initials.clone(),
        score: choice.score,
        cost: choice.cost,
        reason: reason_for(
            &choice.explanation,
            choice.kind,
            choice.from_role.as_deref(),
        ),
    }
}

/// The request a coordinator approves: one seat, one volunteer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryChangeRequest {
    pub volunteer_id: String,
    pub role: String,
    pub from_role: Option<String>,
    #[serde(default)]
    pub promote_waitlist: bool,
}

/// One transaction; any broken rule refuses the whole batch.
pub fn apply(
    conn: &Connection,
    actor: &Account,
    shift_id: &str,
    changes: &[RecoveryChangeRequest],
) -> Result<WorkspaceSnapshot> {
    if changes.is_empty() {
        return Err(CoreError::Validation(
            "Select at least one change to apply".into(),
        ));
    }
    let (status, capacity, confirmed): (String, i64, i64) = conn.query_row(
        "SELECT status, capacity, confirmed FROM shifts WHERE id = ?1",
        params![shift_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if status != "scheduled" {
        return Err(CoreError::rule(
            "SHIFT_CLOSED",
            "This shift is no longer accepting assignments.",
            Some("shiftId".into()),
            None,
        ));
    }

    let additions = changes
        .iter()
        .filter(|change| change.from_role.is_none())
        .count() as i64;
    if confirmed + additions > capacity {
        return Err(CoreError::rule(
            "SHIFT_FULL",
            "That recovery fills more seats than the shift has.",
            Some("shiftId".into()),
            Some("REPLAN".into()),
        ));
    }

    let mut seen = HashSet::new();
    for change in changes {
        if !seen.insert(change.volunteer_id.clone()) {
            return Err(CoreError::Validation(
                "A volunteer appears twice in the same recovery plan".into(),
            ));
        }
    }

    for change in changes {
        let role_exists: Option<(i64, i64)> = conn
            .query_row(
                "SELECT required, filled FROM shift_roles WHERE shift_id = ?1 AND name = ?2",
                params![shift_id, change.role],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((required, filled)) = role_exists else {
            return Err(CoreError::Validation(format!(
                "{} is not part of this shift",
                change.role
            )));
        };
        if filled >= required && change.from_role.as_deref() != Some(change.role.as_str()) {
            return Err(CoreError::rule(
                "ROLE_FULL",
                format!(
                    "{} is already covered, so nobody else can take it.",
                    change.role
                ),
                Some("role".into()),
                Some("REPLAN".into()),
            ));
        }
        match change.from_role.as_deref() {
            Some(from_role) => {
                let current: Option<(String, i64, String)> = conn
                    .query_row(
                        "SELECT role, locked, status FROM registrations
                         WHERE shift_id = ?1 AND volunteer_id = ?2",
                        params![shift_id, &change.volunteer_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .optional()?;
                let Some((role, locked, status)) = current else {
                    return Err(CoreError::Validation(
                        "That volunteer is not assigned to this shift".into(),
                    ));
                };
                if status != "registered" {
                    return Err(CoreError::Validation(
                        "That volunteer is no longer on this shift, so there is nothing to move"
                            .into(),
                    ));
                }
                if role != from_role {
                    return Err(CoreError::Validation(format!(
                        "That volunteer is assigned as {role}, not {from_role}"
                    )));
                }
                if locked == 1 {
                    return Err(CoreError::rule(
                        "ASSIGNMENT_LOCKED",
                        "That assignment is locked. Unlock it first.",
                        Some("role".into()),
                        None,
                    ));
                }
            }
            None => {
                crate::workflows::validate_registration(
                    conn,
                    shift_id,
                    &change.volunteer_id,
                    &change.role,
                )?;
            }
        }
    }

    let now = now(conn)?.to_rfc3339();
    let mut names = std::collections::HashMap::new();
    for change in changes {
        let name: String = conn.query_row(
            "SELECT name FROM volunteers WHERE id = ?1",
            params![change.volunteer_id],
            |row| row.get(0),
        )?;
        names.insert(change.volunteer_id.clone(), name);
    }

    let transaction = conn.unchecked_transaction()?;
    for change in changes {
        let name = &names[&change.volunteer_id];
        match change.from_role.as_deref() {
            Some(from_role) => {
                transaction.execute(
                    "UPDATE registrations SET role = ?1, updated_at = ?2
                     WHERE shift_id = ?3 AND volunteer_id = ?4",
                    params![change.role, now, shift_id, change.volunteer_id],
                )?;
                transaction.execute(
                    "UPDATE shift_roles SET filled = filled - 1
                     WHERE shift_id = ?1 AND name = ?2 AND filled > 0",
                    params![shift_id, from_role],
                )?;
                transaction.execute(
                    "UPDATE shift_roles SET filled = filled + 1
                     WHERE shift_id = ?1 AND name = ?2 AND filled < required",
                    params![shift_id, change.role],
                )?;
            }
            None => {
                if change.promote_waitlist {
                    transaction.execute(
                        "UPDATE waitlist_entries SET status = 'promoted'
                         WHERE shift_id = ?1 AND volunteer_id = ?2 AND status = 'waiting'",
                        params![shift_id, change.volunteer_id],
                    )?;
                }
                transaction.execute(
                    "INSERT INTO registrations (shift_id, volunteer_id, role, created_at, status, updated_at)
                     VALUES (?1, ?2, ?3, ?4, 'registered', ?4)
                     ON CONFLICT(shift_id, volunteer_id) DO UPDATE SET
                       role = excluded.role, status = 'registered', updated_at = excluded.updated_at",
                    params![shift_id, change.volunteer_id, change.role, now],
                )?;
                transaction.execute(
                    "UPDATE shifts SET confirmed = confirmed + 1 WHERE id = ?1",
                    params![shift_id],
                )?;
                transaction.execute(
                    "UPDATE shift_roles SET filled = filled + 1
                     WHERE shift_id = ?1 AND name = ?2 AND filled < required",
                    params![shift_id, change.role],
                )?;
            }
        }
        let summary = match change.from_role.as_deref() {
            Some(from_role) => format!("Recovery moved {name} from {from_role} to {}", change.role),
            None if change.promote_waitlist => format!(
                "Recovery promoted {name} from the waitlist to {}",
                change.role
            ),
            None => format!("Recovery assigned {name} as {}", change.role),
        };
        append_actor_audit(
            &transaction,
            "coordinator",
            &actor.name,
            "recovery.apply",
            "shift",
            shift_id,
            summary,
            Some("Approved from a coverage recovery plan".into()),
        )?;
    }
    transaction.commit()?;
    snapshot(conn)
}

/// Holds one assignment still, or releases it. A coordinator's lock is what makes
/// the optimizer's output safe to hand to a room of volunteers.
pub fn set_lock(
    conn: &Connection,
    actor: &Account,
    shift_id: &str,
    volunteer_id: &str,
    locked: bool,
) -> Result<WorkspaceSnapshot> {
    let current: Option<(String, i64)> = conn
        .query_row(
            "SELECT status, locked FROM registrations WHERE shift_id = ?1 AND volunteer_id = ?2",
            params![shift_id, volunteer_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((status, already)) = current else {
        return Err(CoreError::NotFound("that assignment".into()));
    };
    if status != "registered" {
        return Err(CoreError::Validation(
            "Only a live assignment can be locked".into(),
        ));
    }
    if (already == 1) == locked {
        return snapshot(conn);
    }
    let name: String = conn.query_row(
        "SELECT name FROM volunteers WHERE id = ?1",
        params![volunteer_id],
        |row| row.get(0),
    )?;
    let now = now(conn)?.to_rfc3339();
    let transaction = conn.unchecked_transaction()?;
    transaction.execute(
        "UPDATE registrations SET locked = ?1, locked_by = ?2, locked_at = ?3
         WHERE shift_id = ?4 AND volunteer_id = ?5",
        params![
            i64::from(locked),
            if locked {
                Some(actor.name.clone())
            } else {
                None
            },
            if locked { Some(now.clone()) } else { None },
            shift_id,
            volunteer_id
        ],
    )?;
    append_actor_audit(
        &transaction,
        "coordinator",
        &actor.name,
        if locked {
            "assignment.lock"
        } else {
            "assignment.unlock"
        },
        "shift",
        shift_id,
        format!(
            "{} {name}'s assignment",
            if locked { "Locked" } else { "Unlocked" }
        ),
        Some(if locked {
            "Recovery and AutoRoster will not move a locked assignment".into()
        } else {
            "The assignment can be replanned again".into()
        }),
    )?;
    transaction.commit()?;
    snapshot(conn)
}

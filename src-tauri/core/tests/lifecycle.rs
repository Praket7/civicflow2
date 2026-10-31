use civicflow_core::matching::RosterOptions;
use civicflow_core::roster::{
    apply_roster_plan, apply_roster_week, evaluate_roster_candidates, plan_roster,
    workspace_revision, RosterApplyAssignment, WeeklyAssignment,
};
use civicflow_core::workflows::{
    cancel_registration, check_out, join_waitlist, manual_check_in, review_hours, snapshot,
};
use civicflow_core::Database;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

#[test]
fn cancellation_promotes_the_first_eligible_waitlist_candidate() {
    let database = seeded();
    join_waitlist(
        database.connection(),
        "sh-tue-pantry",
        "vol-055",
        "Donation sorter",
    )
    .expect("join waitlist");

    let state = cancel_registration(
        database.connection(),
        "sh-tue-pantry",
        "vol-maya",
        "Family emergency",
    )
    .expect("cancel registration");

    let maya = state
        .registrations
        .iter()
        .find(|row| row.shift_id == "sh-tue-pantry" && row.volunteer_id == "vol-maya")
        .expect("Maya registration");
    assert_eq!(maya.status, "canceled");
    let promoted = state
        .registrations
        .iter()
        .find(|row| row.shift_id == "sh-tue-pantry" && row.volunteer_id == "vol-055")
        .expect("promoted registration");
    assert_eq!(promoted.status, "registered");
    assert!(state.waitlist.iter().any(|row| {
        row.shift_id == "sh-tue-pantry" && row.volunteer_id == "vol-055" && row.status == "promoted"
    }));
    assert!(state
        .audit
        .iter()
        .any(|event| event.action == "waitlist.promote"));
    let notification: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM notifications WHERE kind = 'WAITLIST_PROMOTED'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(notification, 1);
}

#[test]
fn an_approved_auto_roster_plan_applies_as_one_audited_write() {
    let database = seeded();
    let options = RosterOptions {
        prefer_spanish: true,
        block_conflicts: true,
        cap_weekly: false,
        include_waitlist: false,
    };
    let plan = plan_roster(
        database.connection(),
        &["sh-sat-food".to_string()],
        &options,
    )
    .expect("plan the shift");
    assert!(
        plan.assignments.len() > 1,
        "expected a multi-seat plan, got {}",
        plan.assignments.len()
    );

    let requests: Vec<RosterApplyAssignment> = plan
        .assignments
        .iter()
        .map(|assignment| RosterApplyAssignment {
            candidate_id: assignment.candidate_id.clone(),
            role: assignment.role.clone(),
            promote_waitlist: assignment.promote_waitlist,
        })
        .collect();
    let state =
        apply_roster_plan(database.connection(), "sh-sat-food", &requests).expect("apply the plan");

    for assignment in &plan.assignments {
        assert!(state.registrations.iter().any(|row| {
            row.shift_id == "sh-sat-food"
                && row.volunteer_id == assignment.candidate_id
                && row.role == assignment.role
                && row.status == "registered"
        }));
    }
    assert_eq!(
        state
            .audit
            .iter()
            .filter(|event| event.action == "autoroster.apply")
            .count(),
        plan.assignments.len()
    );
    let confirmed: i64 = database
        .connection()
        .query_row(
            "SELECT confirmed FROM shifts WHERE id = 'sh-sat-food'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(confirmed, 10 + plan.assignments.len() as i64);
}

#[test]
fn every_displayed_candidate_score_matches_the_solver() {
    let database = seeded();
    let options = RosterOptions {
        prefer_spanish: true,
        block_conflicts: true,
        cap_weekly: false,
        include_waitlist: false,
    };
    let evaluation = evaluate_roster_candidates(
        database.connection(),
        &["sh-sat-food".to_string()],
        &options,
    )
    .expect("evaluate the shift");

    assert!(!evaluation.candidates.is_empty());
    assert!(!evaluation.plan.assignments.is_empty());

    for assignment in &evaluation.plan.assignments {
        let candidate = evaluation
            .candidates
            .iter()
            .find(|row| row.candidate_id == assignment.candidate_id)
            .expect("the chosen volunteer is in the evaluation");
        let seat = candidate
            .slots
            .iter()
            .find(|slot| slot.slot_id == assignment.explanation.slot_id)
            .expect("the chosen seat is in the evaluation");
        assert!(seat.selected);
        assert!(seat.eligible);
        // The browser shows the solver's score, not a second approximation of it.
        assert_eq!(seat.score, Some(assignment.score));
        assert_eq!(seat.components, assignment.explanation.components);
        assert_eq!(
            seat.selection_reason,
            assignment.explanation.selection_reason
        );
    }

    // A volunteer who fails a hard gate is shown as ineligible rather than with
    // an optimistic score of their own.
    for candidate in &evaluation.candidates {
        for slot in &candidate.slots {
            if !slot.eligible {
                assert!(slot.score.is_none());
                assert!(slot.checks.iter().any(|check| !check.passed));
            }
        }
    }
}

#[test]
fn a_stale_plan_is_refused_without_writing_anything() {
    let database = seeded();
    let options = RosterOptions {
        prefer_spanish: true,
        block_conflicts: true,
        cap_weekly: false,
        include_waitlist: false,
    };
    let plan = plan_roster(
        database.connection(),
        &["sh-sat-food".to_string()],
        &options,
    )
    .expect("plan the shift");
    assert!(plan.revision > 0);
    assert!(!plan.generated_at.is_empty());

    let assignments: Vec<WeeklyAssignment> = plan
        .assignments
        .iter()
        .map(|assignment| WeeklyAssignment {
            shift_id: assignment.shift_id.clone(),
            candidate_id: assignment.candidate_id.clone(),
            role: assignment.role.clone(),
            promote_waitlist: assignment.promote_waitlist,
        })
        .collect();

    // Somebody changes the roster between planning and applying.
    database
        .connection()
        .execute(
            "UPDATE shifts SET capacity = capacity + 1 WHERE id = 'sh-sat-food'",
            [],
        )
        .unwrap();
    assert!(workspace_revision(database.connection()).unwrap() > plan.revision);

    let before: i64 = database
        .connection()
        .query_row(
            "SELECT confirmed FROM shifts WHERE id = 'sh-sat-food'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let error = apply_roster_week(
        database.connection(),
        Some(plan.revision),
        Some(plan.policy_version),
        &assignments,
    )
    .expect_err("the stale plan is refused");
    match error {
        civicflow_core::CoreError::Rule { code, .. } => assert_eq!(code, "PLAN_STALE"),
        other => panic!("expected a rule error, got {other:?}"),
    }
    let after: i64 = database
        .connection()
        .query_row(
            "SELECT confirmed FROM shifts WHERE id = 'sh-sat-food'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, after, "a refused plan writes nothing");
}

#[test]
fn a_weekly_plan_applies_across_shifts_in_one_transaction() {
    let database = seeded();
    let options = RosterOptions {
        prefer_spanish: false,
        block_conflicts: true,
        cap_weekly: false,
        include_waitlist: false,
    };
    let shifts = vec!["sh-sat-food".to_string(), "sh-sun-library".to_string()];
    let evaluation = evaluate_roster_candidates(database.connection(), &shifts, &options)
        .expect("evaluate the week");
    let assignments: Vec<WeeklyAssignment> = evaluation
        .plan
        .assignments
        .iter()
        .map(|assignment| WeeklyAssignment {
            shift_id: assignment.shift_id.clone(),
            candidate_id: assignment.candidate_id.clone(),
            role: assignment.role.clone(),
            promote_waitlist: assignment.promote_waitlist,
        })
        .collect();
    assert!(assignments.len() > 1);
    let touched: std::collections::HashSet<&str> = assignments
        .iter()
        .map(|row| row.shift_id.as_str())
        .collect();
    assert!(touched.len() > 1, "the plan spans more than one shift");

    let state = apply_roster_week(
        database.connection(),
        Some(evaluation.plan.revision),
        Some(evaluation.plan.policy_version),
        &assignments,
    )
    .expect("apply the week");
    for assignment in &assignments {
        assert!(state.registrations.iter().any(|row| {
            row.shift_id == assignment.shift_id
                && row.volunteer_id == assignment.candidate_id
                && row.status == "registered"
        }));
    }
    let summaries = state
        .audit
        .iter()
        .filter(|event| event.action == "autoroster.apply_week")
        .count();
    assert_eq!(summaries, 1, "one plan summary records the whole week");
}

#[test]
fn maya_iris_lifecycle_produces_hours_and_a_verification_record() {
    let database = seeded();
    join_waitlist(
        database.connection(),
        "sh-tue-pantry",
        "vol-055",
        "Donation sorter",
    )
    .expect("join waitlist");
    cancel_registration(
        database.connection(),
        "sh-tue-pantry",
        "vol-maya",
        "Schedule conflict",
    )
    .expect("cancel Maya");

    let checked_in = manual_check_in(
        database.connection(),
        "sh-tue-pantry",
        "vol-055",
        "Recorded at the door",
    )
    .expect("Iris checks in");
    let row = checked_in.attendance["sh-tue-pantry"]
        .iter()
        .find(|row| row.volunteer_id == "vol-055")
        .expect("Iris attendance");
    assert_eq!(row.status, "checked_in");

    let checked_out =
        check_out(database.connection(), "sh-tue-pantry", "vol-055").expect("Iris checks out");
    let hours: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM hour_entries
             WHERE volunteer_id = 'vol-055' AND source_shift_id = 'sh-tue-pantry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(hours, 1);
    assert!(checked_out
        .audit
        .iter()
        .any(|event| event.action == "shift.checkout"));

    let entry_id: String = database
        .connection()
        .query_row(
            "SELECT id FROM hour_entries
             WHERE volunteer_id = 'vol-055' AND source_shift_id = 'sh-tue-pantry'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let reviewed = review_hours(
        database.connection(),
        &entry_id,
        "verified",
        Some(1),
        "Confirmed with the shift lead",
    )
    .expect("approve hours");

    let decision = &reviewed.hours_decisions[&entry_id];
    assert_eq!(decision.status, "verified");
    assert_eq!(decision.approved_minutes, Some(1));
    let verification = reviewed
        .verifications
        .iter()
        .find(|record| record.volunteer_id == "vol-055" && record.date_start == "2026-10-13")
        .expect("verification record");
    assert!(verification.code.starts_with("CFV-2026-"));
    assert_eq!(verification.total_minutes, 1);
    let entry_code: String = database
        .connection()
        .query_row(
            "SELECT verification_id FROM hour_entries WHERE id = ?1",
            [&entry_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(entry_code, verification.code);
    let notification: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM notifications WHERE kind = 'HOURS_APPROVED'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(notification >= 1);
    let reopened = snapshot(database.connection()).expect("snapshot after lifecycle");
    assert!(reopened
        .verifications
        .iter()
        .any(|row| row.code == entry_code));
}

#[test]
fn changing_the_matching_policy_invalidates_a_plan_built_on_the_old_rules() {
    let database = seeded();
    let connection = database.connection();
    let options = RosterOptions {
        prefer_spanish: false,
        block_conflicts: true,
        cap_weekly: false,
        include_waitlist: false,
    };
    let plan =
        plan_roster(connection, &["sh-sat-food".to_string()], &options).expect("plan the shift");
    let assignments: Vec<WeeklyAssignment> = plan
        .assignments
        .iter()
        .map(|assignment| WeeklyAssignment {
            shift_id: assignment.shift_id.clone(),
            candidate_id: assignment.candidate_id.clone(),
            role: assignment.role.clone(),
            promote_waitlist: assignment.promote_waitlist,
        })
        .collect();

    // A coordinator tightens the weekly cap after the plan was reviewed. The
    // workspace revision does not move, so only the policy version can reveal
    // that this plan followed rules nobody approved any more.
    let organization = civicflow_core::roster::workspace_organization_id(connection)
        .unwrap()
        .expect("the seeded organization");
    let mut policy = civicflow_core::policy::current_policy(connection, &organization).unwrap();
    policy.max_shifts_per_week = Some(3);
    let coordinator_id: String = connection
        .query_row(
            "SELECT id FROM users WHERE email = 'praket@rivergate.example'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let actor = civicflow_core::auth::Account {
        id: coordinator_id,
        name: "Praket Gauri".into(),
        email: "praket@rivergate.example".into(),
        role: "coordinator".into(),
        volunteer_id: None,
    };
    let saved =
        civicflow_core::policy::save_policy(connection, &actor, &organization, &policy).unwrap();
    assert!(saved.version > plan.policy_version);
    let revision: i64 = workspace_revision(connection).unwrap();
    assert_eq!(revision, plan.revision, "only the rules changed");

    let error = apply_roster_week(
        connection,
        Some(plan.revision),
        Some(plan.policy_version),
        &assignments,
    )
    .expect_err("the plan followed an older policy");
    match error {
        civicflow_core::CoreError::Rule { code, .. } => assert_eq!(code, "POLICY_STALE"),
        other => panic!("expected a rule error, got {other:?}"),
    }
}

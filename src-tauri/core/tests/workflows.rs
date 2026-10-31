use civicflow_core::models::{
    AvailabilitySlot, NewOpportunityInput, SettingsPatch, VolunteerProfilePatch,
};
use civicflow_core::workflows::{
    check_in, check_out, create_opportunity, get_checkin_code, join_waitlist, manual_check_in,
    mark_no_show, promote_waitlist, register_for_shift, review_hours, save_volunteer_profile,
    set_application_stage, set_saved_opportunity, snapshot, update_settings,
};
use civicflow_core::Database;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

fn audit_count(database: &Database, action: &str) -> i64 {
    database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE action = ?1",
            [action],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn snapshot_seeds_every_workflow_owner() {
    let database = seeded();
    let state = snapshot(database.connection()).unwrap();

    assert_eq!(state.saved_opportunity_ids.len(), 4);
    assert_eq!(state.applications.len(), 7);
    assert_eq!(state.waitlist.len(), 4);
    assert!(state.audit.len() >= 10);
    assert_eq!(state.settings.organization_name, "Rivergate Kitchen");
    assert_eq!(state.settings.default_shift_length, 180);
    assert_eq!(state.volunteer_profile.skills[0], "Spanish");
    assert!(!state.volunteer_profile.availability.is_empty());
    assert_eq!(state.attendance["sh-tue-pantry"].len(), 2);
    assert!(state.attendance["sh-tue-pantry"]
        .iter()
        .all(|row| row.status == "checked_in"));
    assert_eq!(state.registrations.len(), 140);
}

#[test]
fn saved_opportunities_toggle_and_audit() {
    let database = seeded();
    let unsaved = set_saved_opportunity(database.connection(), "opp-garden", false).unwrap();
    assert!(!unsaved.saved_opportunity_ids.contains(&"opp-garden".into()));
    assert_eq!(audit_count(&database, "opportunity.unsave"), 1);

    let saved = set_saved_opportunity(database.connection(), "opp-garden", true).unwrap();
    assert!(saved.saved_opportunity_ids.contains(&"opp-garden".into()));
    assert_eq!(audit_count(&database, "opportunity.save"), 1);

    let unchanged = set_saved_opportunity(database.connection(), "opp-garden", true).unwrap();
    assert_eq!(unchanged.audit.len(), saved.audit.len());
}

#[test]
fn applicants_move_stage_and_audit_their_name() {
    let database = seeded();
    let state = set_application_stage(database.connection(), "app-001", "review").unwrap();
    let applicant = state
        .applications
        .iter()
        .find(|row| row.id == "app-001")
        .unwrap();
    assert_eq!(applicant.stage, "review");
    let event = state
        .audit
        .iter()
        .find(|event| event.action == "application.stage")
        .unwrap();
    assert!(event.summary.contains("Renée Alvarez"));
    assert_eq!(audit_count(&database, "application.stage"), 1);

    assert!(set_application_stage(database.connection(), "app-001", "hired").is_err());
    assert!(set_application_stage(database.connection(), "missing", "review").is_err());
}

#[test]
fn attendance_check_in_check_out_and_no_show_share_one_ledger() {
    let database = seeded();
    let state = manual_check_in(
        database.connection(),
        "sh-tue-pantry",
        "vol-maya",
        "Recorded at the door",
    )
    .unwrap();
    let row = state.attendance["sh-tue-pantry"]
        .iter()
        .find(|row| row.volunteer_id == "vol-maya")
        .unwrap();
    assert_eq!(row.status, "checked_in");
    assert_eq!(
        row.checked_in_at.as_deref(),
        Some("2026-10-13T07:45:00-04:00")
    );
    assert_eq!(audit_count(&database, "shift.checkin"), 1);

    let state = check_out(database.connection(), "sh-tue-pantry", "vol-maya").unwrap();
    let row = state.attendance["sh-tue-pantry"]
        .iter()
        .find(|row| row.volunteer_id == "vol-maya")
        .unwrap();
    assert_eq!(row.status, "completed");
    assert!(row.checked_out_at.is_some());
    assert_eq!(audit_count(&database, "shift.checkout"), 1);
}

#[test]
fn marking_a_no_show_reopens_the_seat_exactly_once() {
    let database = seeded();
    let connection = database.connection();
    let counters = |role: &str| -> (i64, i64) {
        let confirmed = connection
            .query_row(
                "SELECT confirmed FROM shifts WHERE id = 'sh-tue-pantry'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let filled = connection
            .query_row(
                "SELECT filled FROM shift_roles WHERE shift_id = 'sh-tue-pantry' AND name = ?1",
                [role],
                |row| row.get(0),
            )
            .unwrap();
        (confirmed, filled)
    };

    let (confirmed_before, filled_before) = counters("Shelf stocker");
    let state = mark_no_show(connection, "sh-tue-pantry", "vol-maya").unwrap();
    let row = state.attendance["sh-tue-pantry"]
        .iter()
        .find(|row| row.volunteer_id == "vol-maya")
        .unwrap();
    assert_eq!(row.status, "no_show");
    assert_eq!(row.checked_in_at, None);
    let seat = state
        .registrations
        .iter()
        .find(|row| row.shift_id == "sh-tue-pantry" && row.volunteer_id == "vol-maya")
        .unwrap();
    assert_eq!(seat.status, "no_show");
    assert_eq!(
        counters("Shelf stocker"),
        (confirmed_before - 1, filled_before - 1),
        "the seat returns to coverage"
    );
    assert_eq!(audit_count(&database, "shift.no_show"), 1);

    // The same transition twice must not return the seat twice.
    let repeated = mark_no_show(connection, "sh-tue-pantry", "vol-maya").unwrap();
    assert_eq!(
        counters("Shelf stocker"),
        (confirmed_before - 1, filled_before - 1)
    );
    assert_eq!(
        repeated
            .registrations
            .iter()
            .find(|row| row.shift_id == "sh-tue-pantry" && row.volunteer_id == "vol-maya")
            .unwrap()
            .status,
        "no_show"
    );
    assert_eq!(audit_count(&database, "shift.no_show"), 1);

    // Somebody who did arrive is a correction, not a no-show.
    assert!(mark_no_show(connection, "sh-tue-pantry", "vol-015").is_err());
}

#[test]
fn waitlist_promotion_registers_the_volunteer_once() {
    let database = seeded();
    let entry = snapshot(database.connection())
        .unwrap()
        .waitlist
        .into_iter()
        .find(|entry| entry.shift_id == "sh-sat-food")
        .unwrap();

    let state =
        promote_waitlist(database.connection(), &entry.shift_id, &entry.volunteer_id).unwrap();
    let promoted = state
        .waitlist
        .iter()
        .find(|row| row.id == entry.id)
        .unwrap();
    assert_eq!(promoted.status, "promoted");
    let registration = state
        .registrations
        .iter()
        .find(|row| row.shift_id == entry.shift_id && row.volunteer_id == entry.volunteer_id)
        .unwrap();
    assert!(!registration.role.is_empty());
    assert_eq!(audit_count(&database, "waitlist.promote"), 2);

    let repeated =
        promote_waitlist(database.connection(), &entry.shift_id, &entry.volunteer_id).unwrap();
    assert_eq!(repeated.registrations.len(), state.registrations.len());
    assert_eq!(audit_count(&database, "waitlist.promote"), 2);
}

#[test]
fn hours_review_updates_the_entry_and_records_the_note() {
    let database = seeded();
    let state = review_hours(
        database.connection(),
        "hours-maya-4",
        "verified",
        Some(480),
        "Trimmed travel time",
    )
    .unwrap();
    let decision = &state.hours_decisions["hours-maya-4"];
    assert_eq!(decision.status, "verified");
    assert_eq!(decision.approved_minutes, Some(480));
    assert_eq!(decision.reason, "Trimmed travel time");
    assert_eq!(audit_count(&database, "hours.approve"), 2);

    let pending: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM hour_entries WHERE id = 'hours-maya-4' AND status = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(pending, 0);

    assert!(review_hours(
        database.connection(),
        "hours-maya-4",
        "rejected",
        None,
        "Already reviewed",
    )
    .is_err());
    assert!(review_hours(
        database.connection(),
        "hours-001",
        "verified",
        Some(0),
        "Zero is impossible",
    )
    .is_err());
    assert!(review_hours(database.connection(), "hours-001", "rejected", None, "",).is_err());
}

#[test]
fn settings_are_validated_persisted_and_audited() {
    let database = seeded();
    let state = update_settings(
        database.connection(),
        SettingsPatch {
            organization_name: Some("Rivergate Kitchen".into()),
            default_shift_length: Some(240),
            text_scale: Some("large".into()),
            auto_promote_waitlist: Some(false),
            ..SettingsPatch::default()
        },
    )
    .unwrap();
    assert_eq!(state.settings.default_shift_length, 240);
    assert_eq!(state.settings.text_scale, "large");
    assert!(!state.settings.auto_promote_waitlist);
    assert_eq!(audit_count(&database, "settings.update"), 2);

    let stored: String = database
        .connection()
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'setting.default_shift_length@org-rivergate-kitchen'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, "240");

    assert!(update_settings(
        database.connection(),
        SettingsPatch {
            default_shift_length: Some(5),
            ..SettingsPatch::default()
        },
    )
    .is_err());
    assert!(update_settings(
        database.connection(),
        SettingsPatch {
            text_scale: Some("huge".into()),
            ..SettingsPatch::default()
        },
    )
    .is_err());
}

#[test]
fn created_programs_are_queryable_after_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("civicflow.db");
    let id;
    {
        let mut database = Database::open(&path).unwrap();
        database.seed_demo_if_empty().unwrap();
        let result = create_opportunity(
            database.connection(),
            NewOpportunityInput {
                title: "Weekend Pantry Restock".into(),
                cause: "food".into(),
                description: "Restock shelves and load delivery boxes for Saturday routes.".into(),
                address: "214 Rivergate Avenue, Buffalo, NY".into(),
                capacity: 12,
                duration: "2 hours".into(),
                requirements: vec!["Driver".into(), "Food handling".into()],
            },
        )
        .unwrap();
        id = result.opportunity.id.clone();
        assert!(result
            .opportunity
            .slug
            .starts_with("weekend-pantry-restock"));
        assert_eq!(result.snapshot.created_opportunities.len(), 1);
        assert_eq!(audit_count(&database, "opportunity.create"), 1);
    }

    let reopened = Database::open(&path).unwrap();
    // A reopened connection has no organization until one is chosen; the app
    // establishes it from the signed-in account, and these tests want the
    // workspace they wrote as.
    civicflow_core::scope::select(reopened.connection(), Some("org-rivergate-kitchen")).unwrap();
    let state = snapshot(reopened.connection()).unwrap();
    assert!(state.created_opportunities.iter().any(|row| row.id == id));
}

#[test]
fn registrations_and_profiles_are_owned_by_the_database() {
    let database = seeded();
    let state = register_for_shift(
        database.connection(),
        "sh-sat-food",
        "vol-maya",
        "Spanish Support",
    )
    .unwrap();
    assert!(state.registrations.iter().any(|row| {
        row.shift_id == "sh-sat-food"
            && row.volunteer_id == "vol-maya"
            && row.role == "Spanish Support"
    }));
    assert_eq!(audit_count(&database, "shift.register"), 1);

    let profile = save_volunteer_profile(
        database.connection(),
        VolunteerProfilePatch {
            skills: vec!["Tutoring".into(), "Spanish".into()],
            availability: vec![AvailabilitySlot {
                day: "wed".into(),
                period: "morning".into(),
            }],
            completed_onboarding: true,
            phone: "(716) 555-0199".into(),
            interests: "Weekend food distribution".into(),
            causes: vec!["food".into()],
            photo: "data:image/jpeg;base64,abc".into(),
        },
    )
    .unwrap();
    assert_eq!(
        profile.volunteer_profile.skills,
        vec!["Tutoring", "Spanish"]
    );
    assert_eq!(profile.volunteer_profile.availability.len(), 1);
    assert_eq!(profile.volunteer_profile.phone, "(716) 555-0199");
    assert_eq!(profile.volunteer_profile.causes, vec!["food"]);
    assert_eq!(
        profile.volunteer_profile.photo,
        "data:image/jpeg;base64,abc"
    );
    assert_eq!(audit_count(&database, "volunteer.profile_update"), 1);

    assert!(save_volunteer_profile(
        database.connection(),
        VolunteerProfilePatch {
            completed_onboarding: true,
            ..VolunteerProfilePatch::default()
        },
    )
    .is_err());
}

#[test]
fn every_workflow_write_survives_reopen() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("civicflow.db");
    {
        let mut database = Database::open(&path).unwrap();
        database.seed_demo_if_empty().unwrap();
        set_saved_opportunity(database.connection(), "opp-garden", false).unwrap();
        set_application_stage(database.connection(), "app-001", "review").unwrap();
        manual_check_in(
            database.connection(),
            "sh-tue-pantry",
            "vol-maya",
            "Recorded at the door",
        )
        .unwrap();
        promote_waitlist(database.connection(), "sh-sat-food", "vol-014").unwrap();
        review_hours(
            database.connection(),
            "hours-maya-4",
            "verified",
            Some(480),
            "Trimmed travel time",
        )
        .unwrap();
        update_settings(
            database.connection(),
            SettingsPatch {
                default_shift_length: Some(240),
                ..SettingsPatch::default()
            },
        )
        .unwrap();
        register_for_shift(
            database.connection(),
            "sh-sat-food",
            "vol-maya",
            "Spanish Support",
        )
        .unwrap();
        save_volunteer_profile(
            database.connection(),
            VolunteerProfilePatch {
                skills: vec!["Tutoring".into(), "Spanish".into()],
                availability: vec![AvailabilitySlot {
                    day: "wed".into(),
                    period: "morning".into(),
                }],
                completed_onboarding: true,
                ..VolunteerProfilePatch::default()
            },
        )
        .unwrap();
    }

    let reopened = Database::open(&path).unwrap();
    // A reopened connection has no organization until one is chosen; the app
    // establishes it from the signed-in account, and these tests want the
    // workspace they wrote as.
    civicflow_core::scope::select(reopened.connection(), Some("org-rivergate-kitchen")).unwrap();
    let state = snapshot(reopened.connection()).unwrap();
    assert!(!state.saved_opportunity_ids.contains(&"opp-garden".into()));
    assert_eq!(
        state
            .applications
            .iter()
            .find(|row| row.id == "app-001")
            .unwrap()
            .stage,
        "review"
    );
    assert_eq!(
        state.attendance["sh-tue-pantry"]
            .iter()
            .find(|row| row.volunteer_id == "vol-maya")
            .unwrap()
            .status,
        "checked_in"
    );
    assert!(state
        .waitlist
        .iter()
        .any(|row| row.id == "wait-sh-sat-food-vol-014" && row.status == "promoted"));
    assert_eq!(
        state.hours_decisions["hours-maya-4"].approved_minutes,
        Some(480)
    );
    assert_eq!(state.settings.default_shift_length, 240);
    assert!(state
        .registrations
        .iter()
        .any(|row| row.shift_id == "sh-sat-food" && row.volunteer_id == "vol-maya"));
    assert_eq!(state.volunteer_profile.skills, vec!["Tutoring", "Spanish"]);
    for (action, entity) in [
        ("opportunity.unsave", "opp-garden"),
        ("application.stage", "app-001"),
        ("shift.manual_checkin", "sh-tue-pantry"),
        ("waitlist.promote", "sh-sat-food"),
        ("hours.approve", "hours-maya-4"),
        ("settings.update", "workspace"),
        ("shift.register", "sh-sat-food"),
        ("volunteer.profile_update", "vol-maya"),
    ] {
        assert!(
            state
                .audit
                .iter()
                .any(|event| event.action == action && event.entity_id == entity),
            "missing audit event {action} for {entity}"
        );
    }
}

#[test]
fn reset_restores_the_seed_and_drops_user_writes() {
    let mut database = seeded();
    manual_check_in(
        database.connection(),
        "sh-tue-pantry",
        "vol-maya",
        "Recorded at the door",
    )
    .unwrap();
    update_settings(
        database.connection(),
        SettingsPatch {
            default_shift_length: Some(240),
            ..SettingsPatch::default()
        },
    )
    .unwrap();
    database.reset_demo().unwrap();

    let state = snapshot(database.connection()).unwrap();
    assert_eq!(state.attendance["sh-tue-pantry"].len(), 2);
    assert!(state.attendance["sh-tue-pantry"]
        .iter()
        .all(|row| row.volunteer_id != "vol-maya"));
    assert_eq!(state.settings.default_shift_length, 180);
    assert_eq!(state.saved_opportunity_ids.len(), 4);
    assert_eq!(state.waitlist.len(), 4);
    assert!(!state
        .audit
        .iter()
        .any(|event| event.action == "shift.checkin" && event.entity_id == "sh-tue-pantry"));
}

fn rule_code(error: civicflow_core::CoreError) -> String {
    match error {
        civicflow_core::CoreError::Rule { code, .. } => code,
        other => panic!("expected a rule error, got {other:?}"),
    }
}

#[test]
fn self_checkin_needs_the_code_that_is_active_for_the_shift() {
    let database = seeded();
    let connection = database.connection();
    let code = get_checkin_code(connection, "sh-tue-pantry").expect("issue a code");
    assert_eq!(code.code.len(), 6);
    assert!(code.token.len() > 10);

    // No code, and a code from somewhere else, are both refused.
    assert_eq!(
        rule_code(check_in(connection, "sh-tue-pantry", "vol-maya", "").unwrap_err()),
        "INVALID_CHECKIN_CODE"
    );
    assert_eq!(
        rule_code(check_in(connection, "sh-tue-pantry", "vol-maya", "000000x").unwrap_err()),
        "INVALID_CHECKIN_CODE"
    );
    let still_expected: String = connection
        .query_row(
            "SELECT status FROM attendance_events
             WHERE shift_id = 'sh-tue-pantry' AND volunteer_id = 'vol-maya'",
            [],
            |row| row.get(0),
        )
        .map(|status: String| status)
        .unwrap_or_else(|_| "expected".into());
    assert_eq!(still_expected, "expected");

    let state = check_in(connection, "sh-tue-pantry", "vol-maya", &code.code).unwrap();
    let row = state.attendance["sh-tue-pantry"]
        .iter()
        .find(|row| row.volunteer_id == "vol-maya")
        .unwrap();
    assert_eq!(row.status, "checked_in");
    assert_eq!(audit_count(&database, "shift.checkin"), 2);

    // The QR payload is the same gate in another shape.
    let scanned = format!("civicflow://checkin/{}", code.token);
    let repeated = check_in(connection, "sh-tue-pantry", "vol-maya", &scanned).unwrap();
    assert_eq!(
        repeated.attendance["sh-tue-pantry"]
            .iter()
            .find(|row| row.volunteer_id == "vol-maya")
            .unwrap()
            .status,
        "checked_in"
    );
    assert_eq!(audit_count(&database, "shift.checkin"), 2);
}

#[test]
fn an_expired_checkin_code_is_refused() {
    let database = seeded();
    let connection = database.connection();
    let code = get_checkin_code(connection, "sh-tue-pantry").unwrap();
    connection
        .execute(
            "UPDATE checkin_codes SET expires_at = '2026-10-13T07:00:00-04:00'
             WHERE shift_id = 'sh-tue-pantry' AND active = 1",
            [],
        )
        .unwrap();

    assert_eq!(
        rule_code(check_in(connection, "sh-tue-pantry", "vol-maya", &code.code).unwrap_err()),
        "INVALID_CHECKIN_CODE"
    );
}

#[test]
fn manual_checkin_needs_a_reason_and_records_it() {
    let database = seeded();
    let connection = database.connection();

    assert_eq!(
        rule_code(manual_check_in(connection, "sh-tue-pantry", "vol-maya", "ok").unwrap_err()),
        "MANUAL_REASON_REQUIRED"
    );

    manual_check_in(
        connection,
        "sh-tue-pantry",
        "vol-maya",
        "Phone battery died at the door",
    )
    .unwrap();
    let note: String = connection
        .query_row(
            "SELECT COALESCE(note, '') FROM attendance_ledger
             WHERE shift_id = 'sh-tue-pantry' AND volunteer_id = 'vol-maya'
               AND event_type = 'manual_check_in'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(note, "Phone battery died at the door");
    assert_eq!(audit_count(&database, "shift.manual_checkin"), 1);
}

#[test]
fn joining_the_same_waitlist_twice_keeps_the_place_in_line() {
    let database = seeded();
    let connection = database.connection();
    let (shift_id, volunteer_id, position, role): (String, String, i64, String) = connection
        .query_row(
            "SELECT shift_id, volunteer_id, position, eligible_role
             FROM waitlist_entries WHERE status = 'waiting'
             ORDER BY shift_id, position LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();

    let first = join_waitlist(connection, &shift_id, &volunteer_id, &role).unwrap();
    let joined = first
        .waitlist
        .iter()
        .find(|row| row.shift_id == shift_id && row.volunteer_id == volunteer_id)
        .unwrap();
    assert_eq!(
        joined.position, position,
        "a refresh does not demote anyone"
    );

    let again = join_waitlist(connection, &shift_id, &volunteer_id, &role).unwrap();
    assert_eq!(again.waitlist.len(), first.waitlist.len());
    assert_eq!(
        again
            .waitlist
            .iter()
            .find(|row| row.shift_id == shift_id && row.volunteer_id == volunteer_id)
            .unwrap()
            .position,
        position
    );
}

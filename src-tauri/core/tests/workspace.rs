use std::path::PathBuf;

use civicflow_core::db::DEMO_SEED;
use civicflow_core::models::SeedWorkspace;
use civicflow_core::services::{get_mission_control, list_notifications, mark_notification_read};
use civicflow_core::workflows::set_saved_opportunity;
use civicflow_core::Database;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    let loaded = database.seed_demo_if_empty().expect("seed");
    assert!(loaded);
    database
}

fn temp_database() -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::tempdir().expect("temp dir");
    let path = directory.path().join("civicflow.db");
    (directory, path)
}

#[test]
fn seed_matches_the_authored_demo_workspace() {
    let seed = SeedWorkspace::parse(DEMO_SEED).expect("seed parses");
    let database = seeded();
    let health = database.health().expect("health");

    assert_eq!(health.integrity, "ok");
    assert_eq!(health.volunteer_count as usize, seed.volunteers.len());
    assert_eq!(health.opportunity_count as usize, seed.opportunities.len());
    assert_eq!(health.shift_count as usize, seed.shifts.len());
    assert_eq!(database.foreign_key_violations().unwrap(), 0);
}

#[test]
fn seed_is_idempotent() {
    let mut database = Database::in_memory().unwrap();
    assert!(database.seed_demo_if_empty().unwrap());
    assert!(!database.seed_demo_if_empty().unwrap());
    let count: i64 = database
        .connection()
        .query_row("SELECT COUNT(*) FROM volunteers", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 82);
}

#[test]
fn mission_control_metrics_derive_from_records() {
    let database = seeded();
    let summary = get_mission_control(database.connection(), "coordinator").unwrap();

    assert_eq!(summary.active_volunteers, 77);
    assert_eq!(summary.coverage_percent, 91);
    assert_eq!(summary.hours_this_month, 418);
    assert_eq!(summary.upcoming_shifts, 14);
    assert_eq!(summary.attention_count, 3);
    assert_eq!(summary.unread_notifications, 3);
    assert_eq!(summary.organization_name, "FeedMore WNY");
    assert_eq!(summary.impact.meals_packed, 24_320);
}

#[test]
fn weekly_coverage_matches_the_schedule() {
    let database = seeded();
    let summary = get_mission_control(database.connection(), "coordinator").unwrap();
    let percentages: Vec<u8> = summary
        .coverage_days
        .iter()
        .map(|day| day.percent)
        .collect();

    assert_eq!(percentages, vec![100, 92, 100, 83, 76, 62, 90]);
    assert_eq!(summary.coverage_days[5].label, "Sat 17");
}

#[test]
fn attention_items_explain_real_gaps_in_date_order() {
    let database = seeded();
    let summary = get_mission_control(database.connection(), "coordinator").unwrap();
    let details: Vec<&str> = summary
        .attention
        .iter()
        .map(|item| item.detail.as_str())
        .collect();

    assert_eq!(
        details,
        vec![
            "Driver missing · Sat 9:00 AM",
            "2 spots open · Sat 1:00 PM",
            "Math tutor missing · Sun 2:00 PM",
        ]
    );
    assert_eq!(summary.attention[0].severity, "critical");
}

#[test]
fn an_unnamed_workspace_attributes_work_to_the_role_not_a_person() {
    let database = seeded();
    let connection = database.connection();
    connection
        .execute(
            "DELETE FROM app_settings WHERE key LIKE 'coordinator_name%'",
            [],
        )
        .unwrap();
    set_saved_opportunity(connection, "opp-garden", false).expect("a recorded action");

    // The seeded audit names the person who authored the demo. The event this
    // test just wrote is the fallback case, and it names the role.
    let actor: String = connection
        .query_row(
            "SELECT actor_id FROM audit_events
             WHERE action = 'opportunity.unsave' ORDER BY rowid DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("the new audit event");
    assert_eq!(actor, "Coordinator");
}

#[test]
fn marking_a_notification_read_is_persisted_and_audited() {
    let database = seeded();
    let before = list_notifications(database.connection(), "coordinator", None).unwrap();
    assert_eq!(before.len(), 3);
    assert!(before.iter().all(|item| item.read_at.is_none()));

    assert!(mark_notification_read(
        database.connection(),
        "n-1",
        "coordinator",
        None,
        "coordinator",
        "Praket Gauri"
    )
    .unwrap());
    assert!(!mark_notification_read(
        database.connection(),
        "n-1",
        "coordinator",
        None,
        "coordinator",
        "Praket Gauri"
    )
    .unwrap());
    assert!(!mark_notification_read(
        database.connection(),
        "missing",
        "coordinator",
        None,
        "coordinator",
        "Praket Gauri"
    )
    .unwrap());

    let after = list_notifications(database.connection(), "coordinator", None).unwrap();
    assert!(after[0].read_at.is_some());

    let audit_count: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM audit_events WHERE action = 'notification_read'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(audit_count, 1);

    let summary = get_mission_control(database.connection(), "coordinator").unwrap();
    assert_eq!(summary.unread_notifications, 2);
}

#[test]
fn data_survives_close_and_reopen() {
    let (_directory, path) = temp_database();
    {
        let mut database = Database::open(&path).unwrap();
        database.seed_demo_if_empty().unwrap();
    }
    let reopened = Database::open(&path).unwrap();
    // A reopened connection has no organization until one is chosen; the app
    // does that from the signed-in account.
    civicflow_core::scope::select(reopened.connection(), Some("org-feedmore-wny")).unwrap();
    let summary = get_mission_control(reopened.connection(), "coordinator").unwrap();
    assert_eq!(summary.active_volunteers, 77);
    assert_eq!(summary.hours_this_month, 418);
}

#[test]
fn database_rejects_impossible_writes() {
    let database = seeded();
    let conn = database.connection();

    let duplicate_shift_role = conn.execute(
        "INSERT INTO shift_roles (shift_id, name, required, filled) VALUES ('sh-sat-food', 'Driver', 1, 0)",
        [],
    );
    assert!(duplicate_shift_role.is_err());

    let negative_hours = conn.execute(
        "INSERT INTO hour_entries (id, volunteer_id, opportunity_id, date, minutes, status)
         VALUES ('bad-hours', 'vol-maya', 'opp-food', '2026-10-01', -30, 'pending')",
        [],
    );
    assert!(negative_hours.is_err());

    let orphan_shift = conn.execute(
        "INSERT INTO shifts (id, opportunity_id, starts_at, ends_at, capacity, confirmed, waitlisted, status)
         VALUES ('bad-shift', 'missing-opportunity', '2026-10-20T09:00:00-04:00', '2026-10-20T12:00:00-04:00', 5, 0, 0, 'scheduled')",
        [],
    );
    assert!(orphan_shift.is_err());
}

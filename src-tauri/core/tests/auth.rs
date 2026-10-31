//! Account, session and role tests at the core boundary. The Tauri command
//! layer calls these functions after resolving the session token, so a failure
//! here is a failure of the actual access control, not of a hidden button.

use civicflow_core::auth::{
    current_user, list_accounts, require_coordinator, reset_password, sign_in, sign_out,
};
use civicflow_core::db::DEMO_SEED;
use civicflow_core::models::SeedWorkspace;
use civicflow_core::services::{list_notifications, mark_notification_read};
use civicflow_core::workflows::snapshot_for;
use civicflow_core::Database;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    database.seed_demo_if_empty().expect("seed");
    database
}

fn error_code(result: civicflow_core::Result<()>) -> String {
    match result.expect_err("expected the call to be refused") {
        civicflow_core::CoreError::Rule { code, .. } => code,
        other => panic!("expected a rule error, got {other:?}"),
    }
}

#[test]
fn coordinator_sign_in_creates_a_session_and_sign_out_revokes_it() {
    let database = seeded();
    let refused = sign_in(
        database.connection(),
        "praket@rivergate.example",
        "wrong-password",
        false,
    )
    .expect_err("wrong password");
    assert!(matches!(
        refused,
        civicflow_core::CoreError::Rule { ref code, .. } if code == "INVALID_CREDENTIALS"
    ));

    let session = sign_in(
        database.connection(),
        "PRAKET@rivergate.example",
        "civicflow-demo",
        true,
    )
    .expect("sign in");
    assert_eq!(session.user.role, "coordinator");
    assert!(!session.token.is_empty());

    let account = current_user(database.connection(), &session.token)
        .expect("current user")
        .expect("session resolves");
    assert_eq!(account.email, "praket@rivergate.example");

    assert!(sign_out(database.connection(), &session.token, &account).expect("sign out"));
    assert!(current_user(database.connection(), &session.token)
        .expect("current user")
        .is_none());
}

#[test]
fn volunteer_cannot_use_coordinator_capabilities() {
    let database = seeded();
    let session = sign_in(
        database.connection(),
        "maya.chen@example.org",
        "civicflow-demo",
        false,
    )
    .expect("volunteer sign in");
    assert_eq!(session.user.role, "volunteer");
    assert!(session.user.volunteer_id.is_some());

    assert_eq!(
        error_code(list_accounts(database.connection(), &session.token).map(|_| ())),
        "FORBIDDEN"
    );
    assert_eq!(
        error_code(require_coordinator(database.connection(), &session.token).map(|_| ())),
        "FORBIDDEN"
    );
    assert_eq!(
        error_code(reset_password(
            database.connection(),
            &session.token,
            "user-maya",
            "another-password",
        )),
        "FORBIDDEN"
    );
    assert!(current_user(database.connection(), "not-a-real-token")
        .expect("lookup")
        .is_none());
    assert_eq!(
        error_code(require_coordinator(database.connection(), "not-a-real-token").map(|_| ())),
        "AUTH_REQUIRED"
    );
}

#[test]
fn a_coordinator_reset_revokes_the_old_session_and_accepts_the_new_password() {
    let database = seeded();
    let coordinator = sign_in(
        database.connection(),
        "praket@rivergate.example",
        "civicflow-demo",
        false,
    )
    .expect("coordinator sign in");

    reset_password(
        database.connection(),
        &coordinator.token,
        "user-maya",
        "pantry-shift-2026",
    )
    .expect("reset volunteer password");

    assert!(current_user(database.connection(), "not-maya")
        .expect("lookup")
        .is_none());
    assert!(sign_in(
        database.connection(),
        "maya.chen@example.org",
        "civicflow-demo",
        false
    )
    .is_err());

    let session = sign_in(
        database.connection(),
        "maya.chen@example.org",
        "pantry-shift-2026",
        false,
    )
    .expect("new password works");
    assert_eq!(session.user.role, "volunteer");
}

#[test]
fn volunteer_snapshot_contains_only_their_own_records() {
    let seed = SeedWorkspace::parse(DEMO_SEED).expect("seed parses");
    let maya = seed.current_volunteer_id.clone();
    let database = seeded();

    let full = snapshot_for(database.connection(), None).expect("coordinator snapshot");
    let scoped = snapshot_for(database.connection(), Some(&maya)).expect("volunteer snapshot");

    assert!(!full.applications.is_empty());
    assert!(!full.audit.is_empty());
    assert!(scoped.applications.is_empty());
    assert!(scoped.audit.is_empty());
    assert!(scoped.impact_metrics.is_empty());
    assert!(scoped.saved_views.is_empty());
    assert!(scoped.retention.is_empty());

    assert!(scoped
        .credentials
        .iter()
        .all(|credential| credential.volunteer_id == maya));
    assert!(scoped
        .verifications
        .iter()
        .all(|record| record.volunteer_id == maya));
    assert!(scoped
        .registrations
        .iter()
        .all(|row| row.volunteer_id == maya));
    assert!(scoped.waitlist.iter().all(|row| row.volunteer_id == maya));
    assert!(scoped
        .attendance
        .values()
        .flatten()
        .all(|row| row.volunteer_id == maya));

    let scoped_hours: Vec<String> = database
        .connection()
        .prepare("SELECT id FROM hour_entries WHERE volunteer_id = ?1")
        .unwrap()
        .query_map([&maya], |row| row.get::<_, String>(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(!scoped_hours.is_empty());
    assert!(scoped
        .hours_decisions
        .keys()
        .all(|id| scoped_hours.contains(id)));

    // Nothing the coordinator needs was accidentally removed from their view.
    assert!(full
        .registrations
        .iter()
        .any(|row| row.volunteer_id != maya));
}

#[test]
fn notifications_are_scoped_to_the_audience_and_volunteer() {
    let seed = SeedWorkspace::parse(DEMO_SEED).expect("seed parses");
    let maya = seed.current_volunteer_id.clone();
    let database = seeded();

    // Approving Maya's pending hours writes a volunteer-addressed alert. Other
    // volunteers must never receive it, and the coordinator feed must not either.
    civicflow_core::workflows::review_hours(
        database.connection(),
        "hours-maya-4",
        "verified",
        Some(150),
        "Approved as submitted",
    )
    .expect("approve hours");

    let coordinator = list_notifications(database.connection(), "coordinator", None)
        .expect("coordinator notifications");
    let volunteer = list_notifications(database.connection(), "volunteer", Some(&maya))
        .expect("volunteer notifications");
    let other = list_notifications(database.connection(), "volunteer", Some("vol-iris"))
        .expect("other volunteer notifications");
    assert!(!coordinator.is_empty());
    assert_eq!(volunteer.len(), 1);
    assert!(other.is_empty());
    assert!(coordinator
        .iter()
        .all(|item| !item.href.starts_with("/volunteer")));
    assert!(volunteer
        .iter()
        .all(|item| !item.href.starts_with("/coordinator")));

    let volunteer_only = &volunteer[0];
    assert!(!mark_notification_read(
        database.connection(),
        &volunteer_only.id,
        "coordinator",
        None,
        "coordinator",
        "Praket Gauri"
    )
    .expect("refused read returns false"));
    assert!(!mark_notification_read(
        database.connection(),
        &volunteer_only.id,
        "volunteer",
        Some("vol-iris"),
        "volunteer",
        "Iris Chen"
    )
    .expect("another volunteer cannot read it"));
    assert!(mark_notification_read(
        database.connection(),
        &volunteer_only.id,
        "volunteer",
        Some(&maya),
        "volunteer",
        "Maya Chen"
    )
    .expect("volunteer read"));
}

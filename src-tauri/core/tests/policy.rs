//! The organization's matching policy: what a workspace follows before anyone
//! changes anything, what a change does, and what it refuses.

use civicflow_core::auth::{require_coordinator, sign_in, Account};
use civicflow_core::matching::RosterOptions;
use civicflow_core::policy::{current_policy, save_policy, RosterPolicy};
use civicflow_core::roster::{plan_roster, policy_for_workspace};
use civicflow_core::Database;

const ORGANIZATION: &str = "org-rivergate-kitchen";

/// Two seats on the same Saturday, so a daily cap has something to bite on.
fn saturday() -> Vec<String> {
    vec!["sh-sat-food".to_string(), "sh-sat-garden".to_string()]
}

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

fn coordinator(database: &Database) -> Account {
    let session = sign_in(
        database.connection(),
        "praket@rivergate.example",
        "civicflow-demo",
        false,
    )
    .expect("the seeded owner signs in");
    require_coordinator(database.connection(), &session.token).expect("the account coordinates")
}

fn count(database: &Database, sql: &str) -> i64 {
    database
        .connection()
        .query_row(sql, [], |row| row.get(0))
        .expect("the count runs")
}

#[test]
fn a_workspace_that_never_changed_anything_follows_the_shipped_defaults() {
    let database = seeded();
    let policy = policy_for_workspace(database.connection()).expect("the workspace has a policy");
    assert_eq!(policy, RosterPolicy::default());
    assert_eq!(policy.version, 1);
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM organization_roster_policies"
        ),
        0
    );
}

#[test]
fn saving_a_policy_appends_a_version_and_audits_it() {
    let database = seeded();
    let actor = coordinator(&database);
    let wanted = RosterPolicy {
        max_shifts_per_day: Some(2),
        minimum_gap_minutes: 90,
        ..RosterPolicy::default()
    };

    let saved = save_policy(database.connection(), &actor, ORGANIZATION, &wanted)
        .expect("the policy is saved");
    assert_eq!(saved.version, 2);
    assert_eq!(saved.max_shifts_per_day, Some(2));
    assert_eq!(saved.minimum_gap_minutes, 90);

    // The saved version is what both the workspace and the planner now read.
    assert_eq!(
        current_policy(database.connection(), ORGANIZATION).expect("current policy"),
        saved
    );
    assert_eq!(
        policy_for_workspace(database.connection()).expect("workspace policy"),
        saved
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM organization_roster_policies"
        ),
        1
    );

    let (action, detail): (String, Option<String>) = database
        .connection()
        .query_row(
            "SELECT action, detail FROM audit_events WHERE action = 'policy.updated'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the change is audited");
    assert_eq!(action, "policy.updated");
    let detail = detail.expect("the audit line describes the policy");
    assert!(detail.contains("2/day"), "{detail}");
    assert!(detail.contains("gap 90 min"), "{detail}");
}

#[test]
fn a_second_change_becomes_the_next_version() {
    let database = seeded();
    let actor = coordinator(&database);

    save_policy(
        database.connection(),
        &actor,
        ORGANIZATION,
        &RosterPolicy {
            max_shifts_per_week: Some(3),
            ..RosterPolicy::default()
        },
    )
    .expect("first change");

    let saved = save_policy(
        database.connection(),
        &actor,
        ORGANIZATION,
        &RosterPolicy {
            max_shifts_per_week: Some(4),
            ..RosterPolicy::default()
        },
    )
    .expect("second change");

    assert_eq!(saved.version, 3);
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM organization_roster_policies"
        ),
        2
    );
    // History is kept, so the version a plan names can still be read back.
    let oldest: i64 = database
        .connection()
        .query_row(
            "SELECT MIN(version) FROM organization_roster_policies",
            [],
            |row| row.get(0),
        )
        .expect("a version exists");
    assert_eq!(oldest, 2);
}

#[test]
fn a_policy_a_coordinator_could_not_have_meant_is_refused_and_writes_nothing() {
    let database = seeded();
    let actor = coordinator(&database);
    let impossible = RosterPolicy {
        max_shifts_per_week: Some(99),
        ..RosterPolicy::default()
    };

    save_policy(database.connection(), &actor, ORGANIZATION, &impossible)
        .expect_err("a week does not hold ninety-nine shifts");

    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM organization_roster_policies"
        ),
        0
    );
    assert_eq!(
        current_policy(database.connection(), ORGANIZATION)
            .expect("current policy")
            .version,
        1
    );
    assert_eq!(
        count(
            &database,
            "SELECT COUNT(*) FROM audit_events WHERE action = 'policy.updated'"
        ),
        0
    );
}

#[test]
fn a_plan_records_the_policy_version_it_followed() {
    let database = seeded();
    let actor = coordinator(&database);
    save_policy(
        database.connection(),
        &actor,
        ORGANIZATION,
        &RosterPolicy {
            max_shifts_per_day: Some(2),
            ..RosterPolicy::default()
        },
    )
    .expect("the policy is saved");

    let plan = plan_roster(
        database.connection(),
        &saturday(),
        &RosterOptions::default(),
    )
    .expect("a plan is produced");
    assert_eq!(plan.policy_version, 2);
    assert!(!plan.assignments.is_empty());
    assert!(plan
        .assignments
        .iter()
        .all(|assignment| assignment.explanation.eligible));
}

#[test]
fn a_tighter_daily_cap_never_fills_more_seats_than_a_looser_one() {
    let database = seeded();
    let actor = coordinator(&database);

    let loose = plan_roster(
        database.connection(),
        &saturday(),
        &RosterOptions::default(),
    )
    .expect("the shipped policy plans");

    save_policy(
        database.connection(),
        &actor,
        ORGANIZATION,
        &RosterPolicy {
            max_shifts_per_day: Some(1),
            ..RosterPolicy::default()
        },
    )
    .expect("the policy is saved");

    let tight = plan_roster(
        database.connection(),
        &saturday(),
        &RosterOptions::default(),
    )
    .expect("the capped policy plans");

    assert!(!tight.assignments.is_empty());
    assert!(tight.assignments.len() <= loose.assignments.len());
    // One shift a day per volunteer is the promise the cap makes.
    let mut seen = std::collections::HashSet::new();
    for assignment in &tight.assignments {
        let day = assignment.starts_at[..10].to_string();
        assert!(
            seen.insert((assignment.candidate_id.clone(), day)),
            "{} was given two shifts on one day",
            assignment.candidate_name
        );
    }
}

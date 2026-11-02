use civicflow_core::matching::RosterOptions;
use civicflow_core::policy::RosterPolicy;
use civicflow_core::sync::replica;
use civicflow_core::sync::shared_roster;
use civicflow_core::Database;
use serde_json::json;

const ORG: &str = "11111111-1111-4111-8111-111111111111";
const USER: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const SHIFT: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const VOLUNTEER: &str = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPPORTUNITY: &str = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

fn replica_with_plan_inputs() -> Database {
    let database = Database::in_memory().expect("in-memory database");
    replica::configure(database.connection(), ORG, USER, 1).expect("configure");
    let policy = json!({
        "version": 1,
        "maxShiftsPerDay": null,
        "maxMinutesPerDay": null,
        "maxShiftsPerWeek": null,
        "maxMinutesPerWeek": null,
        "minimumGapMinutes": 0,
        "unknownAgeBehavior": "block",
        "unknownCredentialBehavior": "block",
        "skillWeight": 35,
        "interestWeight": 15,
        "languageWeight": 10,
        "fairnessWeight": 10,
        "reliabilityWeight": 5,
        "waitlistPreference": false
    });
    let payload = json!({
        "status": "ok",
        "cursor": 9,
        "revision": 4,
        "entities": {
            "organization": [{ "id": ORG, "name": "Rivergate Kitchen" }],
            "opportunity": [{ "id": OPPORTUNITY, "title": "Pantry", "cause": "food" }],
            "shift": [{
                "id": SHIFT,
                "opportunity_id": OPPORTUNITY,
                "starts_at": "2030-06-01T09:00:00+00:00",
                "ends_at": "2030-06-01T12:00:00+00:00",
                "capacity": 2,
                "confirmed": 0,
                "status": "scheduled"
            }],
            "shift_role": [{
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
                "shift_id": SHIFT,
                "name": "Greeter",
                "required": 1,
                "filled": 0
            }],
            "role_requirement": [{
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
                "shift_id": SHIFT,
                "role_name": "Greeter",
                "skill": "Welcoming",
                "minimum_age": 16
            }],
            "volunteer": [{
                "id": VOLUNTEER,
                "name": "Vera Volunteer",
                "initials": "VV",
                "status": "active",
                "birthdate": "1990-01-01",
                "attendance_rate": 100,
                "events_completed": 5,
                "languages": ["Spanish"],
                "causes": ["food"],
                "availability": []
            }],
            "volunteer_skill": [{
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
                "volunteer_id": VOLUNTEER,
                "skill": "Welcoming"
            }],
            "availability_rule": [{
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
                "volunteer_id": VOLUNTEER,
                "day": "sat",
                "period": "morning"
            }],
            "roster_policy": [{
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5",
                "version": 7,
                "policy": policy
            }]
        }
    });
    replica::apply_bootstrap(database.connection(), ORG, USER, 1, &payload).expect("bootstrap");
    database
}

#[test]
fn the_shared_screen_uses_the_same_solver_and_policy() {
    let database = replica_with_plan_inputs();
    let evaluation = shared_roster::evaluate_roster(
        database.connection(),
        ORG,
        &[SHIFT.to_string()],
        &RosterOptions::default(),
    )
    .expect("evaluate");

    assert_eq!(evaluation.revision, 4);
    assert_eq!(evaluation.policy_version, 7);
    assert_eq!(evaluation.plan.assignments.len(), 1);
    let assignment = &evaluation.plan.assignments[0];
    assert_eq!(assignment.candidate_id, VOLUNTEER);
    assert_eq!(assignment.role, "Greeter");
    assert!(assignment
        .explanation
        .checks
        .iter()
        .any(|check| check.name == "Required skill" && check.passed));
    assert!(!assignment.explanation.selection_reason.is_empty());
    assert_eq!(
        RosterPolicy::default().version,
        1,
        "the default policy is still the documented one"
    );
}

#[test]
fn an_empty_shift_list_plans_every_upcoming_gap_for_recovery() {
    let database = replica_with_plan_inputs();
    let plan =
        shared_roster::plan_roster(database.connection(), ORG, &[], &RosterOptions::default())
            .expect("plan");
    assert_eq!(plan.assignments.len(), 1);
    assert_eq!(plan.unfilled.len(), 0);
}

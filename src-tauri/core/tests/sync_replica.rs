use civicflow_core::error::CoreError;
use civicflow_core::sync::protocol::{Change, CommandEnvelope, CommandType};
use civicflow_core::sync::replica;
use civicflow_core::Database;
use serde_json::{json, Value};

const ORG: &str = "11111111-1111-4111-8111-111111111111";
const USER: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OTHER_USER: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const SHIFT: &str = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const VOLUNTEER: &str = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const VOLUNTEER_TWO: &str = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const OP: &str = "10000000-0000-4000-8000-000000000001";
const REPLICA: &str = "00000000-0000-4000-8000-0000000000a1";

fn database() -> Database {
    Database::in_memory().expect("in-memory database")
}

fn bootstrap(cursor: i64, revision: i64) -> Value {
    json!({
        "status": "ok",
        "cursor": cursor,
        "revision": revision,
        "entities": {
            "organization": [{
                "id": ORG,
                "name": "Rivergate Kitchen",
                "row_version": 1
            }],
            "shift": [{
                "id": SHIFT,
                "organization_id": ORG,
                "capacity": 4,
                "starts_at": "2026-11-01T12:00:00+00:00",
                "row_version": 1
            }],
            "volunteer": [{
                "id": VOLUNTEER,
                "organization_id": ORG,
                "name": "Vera Volunteer",
                "row_version": 1
            }]
        }
    })
}

fn envelope(command: CommandType) -> CommandEnvelope {
    CommandEnvelope {
        operation_id: OP.into(),
        replica_id: REPLICA.into(),
        user_id: USER.into(),
        organization_id: ORG.into(),
        command,
        membership_epoch: 3,
        base_workspace_revision: 4,
        entity_versions: Default::default(),
        payload: json!({ "shiftId": SHIFT, "membershipEpoch": 3 }),
        client_created_at: "2026-11-01T09:00:00.000Z".into(),
    }
}

fn error_code(error: CoreError) -> String {
    match error {
        CoreError::Rule { code, .. } => code,
        other => panic!("expected a rule error, got {other:?}"),
    }
}

#[test]
fn bootstrap_replaces_the_replica_and_sets_the_cursor() {
    let database = database();
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");

    let status =
        replica::apply_bootstrap(conn, ORG, USER, 3, &bootstrap(10, 4)).expect("bootstrap");
    assert!(status.configured);
    assert_eq!(status.cursor, 10);
    assert_eq!(status.revision, 4);
    assert_eq!(status.entities, 3);
    assert_eq!(replica::read_cursor(conn, ORG).unwrap(), 10);
    assert_eq!(replica::read_revision(conn, ORG).unwrap(), 4);

    let shifts = replica::read_entities(conn, ORG, "shift", None).unwrap();
    assert_eq!(shifts.len(), 1);
    assert_eq!(shifts[0]["capacity"], 4);

    // A second bootstrap replaces, not merges: a row the server no longer
    // returns must disappear.
    let mut second = bootstrap(20, 5);
    second["entities"]["shift"] = json!([]);
    replica::apply_bootstrap(conn, ORG, USER, 3, &second).expect("second bootstrap");
    assert!(replica::read_entities(conn, ORG, "shift", None)
        .unwrap()
        .is_empty());
    assert_eq!(replica::read_cursor(conn, ORG).unwrap(), 20);
}

#[test]
fn changes_apply_atomically_and_tombstones_hide_rows() {
    let database = database();
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");
    replica::apply_bootstrap(conn, ORG, USER, 3, &bootstrap(10, 4)).expect("bootstrap");

    let changes = vec![
        Change {
            sequence: 11,
            entity: "shift".into(),
            id: SHIFT.into(),
            operation: civicflow_core::sync::protocol::ChangeOperation::Update,
            row_version: Some(2),
            payload: Some(json!({
                "id": SHIFT,
                "organization_id": ORG,
                "capacity": 6,
                "starts_at": "2026-11-01T12:00:00+00:00",
                "row_version": 2
            })),
        },
        Change {
            sequence: 12,
            entity: "volunteer".into(),
            id: VOLUNTEER_TWO.into(),
            operation: civicflow_core::sync::protocol::ChangeOperation::Insert,
            row_version: Some(1),
            payload: Some(json!({
                "id": VOLUNTEER_TWO,
                "organization_id": ORG,
                "name": "Vince Volunteer",
                "row_version": 1
            })),
        },
        Change {
            sequence: 13,
            entity: "volunteer".into(),
            id: VOLUNTEER_TWO.into(),
            operation: civicflow_core::sync::protocol::ChangeOperation::Delete,
            row_version: None,
            payload: None,
        },
    ];

    let status = replica::apply_changes(conn, ORG, &changes, 13, 5).expect("apply");
    assert_eq!(status.cursor, 13);
    assert_eq!(status.revision, 5);

    let shifts = replica::read_entities(conn, ORG, "shift", None).unwrap();
    assert_eq!(shifts[0]["capacity"], 6);
    let volunteers = replica::read_entities(conn, ORG, "volunteer", None).unwrap();
    assert_eq!(volunteers.len(), 1);

    // A batch with no visible rows still moves the cursor. Otherwise a device
    // would re-read the same invisible changes on every poll.
    let status = replica::apply_changes(conn, ORG, &[], 20, 5).expect("empty batch");
    assert_eq!(status.cursor, 20);

    let stale = replica::apply_changes(conn, ORG, &changes, 19, 5).unwrap_err();
    assert_eq!(error_code(stale), "STALE_CURSOR");
    assert_eq!(replica::read_cursor(conn, ORG).unwrap(), 20);

    // A malformed batch cannot advance the cursor past a change it contains.
    let ahead = vec![Change {
        sequence: 25,
        entity: "shift".into(),
        id: SHIFT.into(),
        operation: civicflow_core::sync::protocol::ChangeOperation::Update,
        row_version: Some(3),
        payload: Some(json!({
            "id": SHIFT,
            "organization_id": ORG,
            "capacity": 7,
            "starts_at": "2026-11-01T12:00:00+00:00",
            "row_version": 3
        })),
    }];
    let skipped = replica::apply_changes(conn, ORG, &ahead, 20, 5).unwrap_err();
    assert!(matches!(skipped, CoreError::Data(_)));
    assert_eq!(replica::read_cursor(conn, ORG).unwrap(), 20);
    assert_eq!(
        replica::read_entities(conn, ORG, "shift", None).unwrap()[0]["capacity"],
        6
    );
    assert_eq!(
        replica::read_entities(conn, ORG, "shift", None).unwrap()[0]["capacity"],
        6
    );
}

#[test]
fn a_failed_batch_leaves_the_cursor_and_rows_untouched() {
    let database = database();
    const OTHER_ORG: &str = "22222222-2222-4222-8222-222222222222";
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");
    replica::apply_bootstrap(conn, ORG, USER, 3, &bootstrap(10, 4)).expect("bootstrap");

    // The first change is valid; the second belongs to another organization.
    // Applying the first before discovering the second would leave the replica
    // half updated and the cursor behind, so the whole batch must roll back.
    let changes = vec![
        Change {
            sequence: 11,
            entity: "shift".into(),
            id: SHIFT.into(),
            operation: civicflow_core::sync::protocol::ChangeOperation::Update,
            row_version: Some(2),
            payload: Some(json!({
                "id": SHIFT,
                "organization_id": ORG,
                "capacity": 9,
                "starts_at": "2026-11-01T12:00:00+00:00",
                "row_version": 2
            })),
        },
        Change {
            sequence: 12,
            entity: "shift".into(),
            id: SHIFT.into(),
            operation: civicflow_core::sync::protocol::ChangeOperation::Update,
            row_version: Some(3),
            payload: Some(json!({
                "id": SHIFT,
                "organization_id": OTHER_ORG,
                "capacity": 10,
                "starts_at": "2026-11-01T12:00:00+00:00",
                "row_version": 3
            })),
        },
    ];

    let error = replica::apply_changes(conn, ORG, &changes, 12, 5).unwrap_err();
    assert!(matches!(error, CoreError::Data(_)));
    assert_eq!(replica::read_cursor(conn, ORG).unwrap(), 10);
    assert_eq!(replica::read_revision(conn, ORG).unwrap(), 4);
    let shifts = replica::read_entities(conn, ORG, "shift", None).unwrap();
    assert_eq!(shifts[0]["capacity"], 4);
}

#[test]
fn the_replica_survives_a_restart_without_a_network() {
    let directory = tempfile::tempdir().expect("temporary directory");
    let path = directory.path().join("replica.db");
    {
        let database = Database::open(&path).expect("open workspace");
        replica::configure(database.connection(), ORG, USER, 3).expect("configure");
        replica::apply_bootstrap(database.connection(), ORG, USER, 3, &bootstrap(10, 4))
            .expect("bootstrap");
    }

    // A new process opens the same encrypted-capable file. No server call is
    // made here, which is the offline restart the shared workspace promises.
    let database = Database::open(&path).expect("reopen workspace");
    let status = replica::status(database.connection(), ORG).expect("status");
    assert_eq!(status.cursor, 10);
    assert_eq!(status.entities, 3);
    let shifts = replica::read_entities(database.connection(), ORG, "shift", None).unwrap();
    assert_eq!(shifts.len(), 1);
    assert_eq!(shifts[0]["capacity"], 4);
}

#[test]
fn a_bootstrap_from_another_organization_is_refused_atomically() {
    let database = database();
    const OTHER_ORG: &str = "22222222-2222-4222-8222-222222222222";
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");
    replica::apply_bootstrap(conn, ORG, USER, 3, &bootstrap(10, 4)).expect("bootstrap");

    let mut foreign = bootstrap(20, 5);
    foreign["entities"]["shift"][0]["organization_id"] = json!(OTHER_ORG);
    let error = replica::apply_bootstrap(conn, ORG, USER, 3, &foreign).unwrap_err();
    assert!(matches!(error, CoreError::Data(_)));

    // The failed replacement changed nothing.
    assert_eq!(replica::read_cursor(conn, ORG).unwrap(), 10);
    assert_eq!(
        replica::read_entities(conn, ORG, "shift", None)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn switching_accounts_clears_the_previous_replica() {
    let database = database();
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");
    replica::apply_bootstrap(conn, ORG, USER, 3, &bootstrap(10, 4)).expect("bootstrap");

    let status = replica::configure(conn, ORG, OTHER_USER, 1).expect("switch");
    assert_eq!(status.user_id.as_deref(), Some(OTHER_USER));
    assert_eq!(status.cursor, 0);
    assert_eq!(status.entities, 0);
    assert!(replica::read_entities(conn, ORG, "shift", None)
        .unwrap()
        .is_empty());
}

#[test]
fn outbox_survives_a_lost_upload_and_records_a_conflict() {
    let database = database();
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");

    let queued = envelope(CommandType::UpdateShift);
    let id = replica::enqueue(conn, USER, ORG, 1, &queued).expect("enqueue");
    assert_eq!(replica::pending_count(conn, USER, ORG).unwrap(), 1);

    let ready = replica::next_ready(conn, USER, ORG, 0)
        .unwrap()
        .expect("ready");
    assert_eq!(ready.id, id);
    assert_eq!(ready.command, CommandType::UpdateShift);
    assert_eq!(ready.user_id, USER);

    replica::mark_sending(conn, id, 1_000).expect("sending");
    assert_eq!(
        replica::recover_stale_sending(conn, 2_000, 3_000).unwrap(),
        1
    );
    let ready = replica::next_ready(conn, USER, ORG, 3_000)
        .unwrap()
        .expect("retry");
    replica::mark_retry(conn, ready.id, "network down", 4_000).expect("retry");
    assert!(replica::next_ready(conn, USER, ORG, 3_500)
        .unwrap()
        .is_none());

    let ready = replica::next_ready(conn, USER, ORG, 4_000)
        .unwrap()
        .expect("ready");
    let conflict = json!({
        "id": "30000000-0000-4000-8000-000000000001",
        "organizationId": ORG,
        "operationId": OP,
        "command": "UPDATE_SHIFT",
        "entity": SHIFT,
        "code": "version_conflict",
        "message": "Jordan changed this shift after your copy was loaded.",
        "classification": "field",
        "localPayload": { "capacity": 6 },
        "authoritative": { "capacity": 5 },
        "status": "open",
        "createdAt": "2026-11-01T09:05:00.000Z"
    });
    replica::mark_refused(conn, ready.id, &json!({ "status": "conflict" }), &conflict)
        .expect("refused");

    assert_eq!(replica::pending_count(conn, USER, ORG).unwrap(), 0);
    assert_eq!(replica::open_conflict_count(conn, ORG).unwrap(), 1);
    assert!(replica::next_ready(conn, USER, ORG, 10_000)
        .unwrap()
        .is_none());
}

#[test]
fn a_command_is_never_queued_for_another_account() {
    let database = database();
    let conn = database.connection();
    replica::configure(conn, ORG, USER, 3).expect("configure");

    let mut wrong = envelope(CommandType::UpdateShift);
    wrong.user_id = OTHER_USER.into();
    let error = replica::enqueue(conn, USER, ORG, 1, &wrong).unwrap_err();
    assert!(matches!(error, CoreError::Validation(_)));
    assert_eq!(replica::pending_count(conn, USER, ORG).unwrap(), 0);
}

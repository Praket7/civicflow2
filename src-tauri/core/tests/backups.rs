//! Contract for snapshot, restore, and refusal of artifacts that are not
//! complete CivicFlow databases.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use civicflow_core::models::{NewOpportunityInput, SettingsPatch};
use civicflow_core::organizations::{create_organization, join_as_volunteer, NewOrganization};
use civicflow_core::workflows::{
    create_opportunity, manual_check_in, set_application_stage, set_saved_opportunity, snapshot,
    update_settings,
};
use civicflow_core::{backups, Database};
use rusqlite::Connection;

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("civicflow-backup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn seeded(path: &Path) -> Database {
    let mut database = Database::open(path).expect("file database");
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
fn restore_returns_every_workflow_to_the_snapshot_point_and_is_audited() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let mut database = seeded(&temp.path().join("civicflow.db"));

    let before = snapshot(database.connection()).unwrap();
    let backup = backups::create(
        database.connection(),
        &backup_dir,
        "manual",
        "Contract backup",
    )
    .expect("create backup");
    assert_eq!(backup.counts.audit, before.audit.len() as i64);
    assert!(backup.rows > 0 && backup.bytes > 0);

    set_saved_opportunity(database.connection(), "opp-garden", false).unwrap();
    set_application_stage(database.connection(), "app-001", "review").unwrap();
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
    create_opportunity(
        database.connection(),
        NewOpportunityInput {
            title: "Weekend Pantry Restock".into(),
            cause: "food".into(),
            description: "Restock shelves for Saturday routes.".into(),
            address: "214 Rivergate Avenue, Buffalo, NY".into(),
            capacity: 12,
            duration: "2 hours".into(),
            requirements: vec!["Driver".into()],
        },
    )
    .unwrap();

    let mutated = snapshot(database.connection()).unwrap();
    assert_ne!(mutated.saved_opportunity_ids, before.saved_opportunity_ids);
    assert_eq!(
        mutated.attendance["sh-tue-pantry"].len(),
        before.attendance["sh-tue-pantry"].len() + 1
    );
    assert_eq!(mutated.created_opportunities.len(), 1);

    let result = backups::restore(database.connection_mut(), &backup_dir, &backup.id)
        .expect("restore backup");
    let restored = result.snapshot;

    assert_eq!(restored.saved_opportunity_ids, before.saved_opportunity_ids);
    assert_eq!(restored.applications, before.applications);
    assert_eq!(restored.waitlist, before.waitlist);
    assert_eq!(restored.settings, before.settings);
    assert_eq!(restored.created_opportunities, before.created_opportunities);
    assert_eq!(restored.registrations, before.registrations);
    assert_eq!(restored.attendance, before.attendance);
    assert_eq!(restored.volunteer_profile, before.volunteer_profile);
    assert_eq!(restored.hours_decisions, before.hours_decisions);
    assert_eq!(restored.audit.len(), before.audit.len() + 1);
    assert_eq!(audit_count(&database, "backup.restore"), 1);

    let event = restored
        .audit
        .iter()
        .find(|event| event.action == "backup.restore")
        .expect("restore audit event");
    assert_eq!(event.entity_id, backup.id);
    assert_eq!(event.actor, "Praket Gauri");
    assert!(event.summary.contains(&backup.id));

    let safety = result
        .backups
        .iter()
        .find(|snapshot| snapshot.note == format!("Before restoring {}", backup.id))
        .expect("safety snapshot");
    assert!(event.detail.as_deref().unwrap().contains(&safety.id));
    assert!(result
        .backups
        .iter()
        .any(|snapshot| snapshot.id == backup.id));
}

#[test]
fn a_snapshot_covers_every_organization_on_the_installation() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let database = seeded(&temp.path().join("civicflow.db"));
    let connection = database.connection();

    let owner = civicflow_core::auth::create_account(
        connection,
        "Dana Whitfield",
        "dana@example.org",
        "kitchen-table-2026",
    )
    .unwrap()
    .user;
    let second = create_organization(
        connection,
        &owner,
        &NewOrganization {
            name: "Lakeside Kitchen".into(),
            description: String::new(),
            website: String::new(),
            address: String::new(),
            city: "Buffalo".into(),
            state: "NY".into(),
            contact_emails: vec!["hello@lakeside.example.org".into()],
            image: None,
            image_alt: None,
            visibility: "public".into(),
        },
    )
    .expect("a second organization");
    let volunteer = civicflow_core::auth::create_account(
        connection,
        "Sam Ortiz",
        "sam@example.org",
        "kitchen-table-2026",
    )
    .unwrap()
    .user;
    join_as_volunteer(connection, &volunteer.id, &second.id).expect("a public roster");

    let installation_volunteers: i64 = connection
        .query_row("SELECT COUNT(*) FROM volunteers", [], |row| row.get(0))
        .unwrap();
    let first_organization_volunteers: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM volunteers WHERE organization_id = (
               SELECT id FROM organizations ORDER BY created_at, id LIMIT 1)",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let backup =
        backups::create(connection, &backup_dir, "manual", "Two workspaces").expect("a snapshot");
    assert_eq!(
        backup.counts.volunteers, installation_volunteers,
        "the snapshot counts every workspace on the device, not the open one"
    );
    assert!(
        backup.counts.volunteers > first_organization_volunteers,
        "the second workspace's volunteer is inside the snapshot"
    );
}

#[test]
fn restore_refuses_foreign_or_damaged_artifacts_without_changing_the_workspace() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let mut database = seeded(&temp.path().join("civicflow.db"));
    let pristine = snapshot(database.connection()).unwrap();
    let backup = backups::create(database.connection(), &backup_dir, "manual", "Valid backup")
        .expect("create backup");

    let junk = backup_dir.join("civicflow-backup-1-manual-junk.db");
    fs::write(&junk, b"this is not a database").unwrap();

    let foreign = backup_dir.join("civicflow-backup-2-manual-foreign.db");
    Connection::open(&foreign)
        .unwrap()
        .execute_batch("CREATE TABLE notes (body TEXT);")
        .unwrap();

    let damaged = backup_dir.join("civicflow-backup-3-manual-damaged.db");
    fs::copy(backup_dir.join(&backup.id), &damaged).unwrap();
    Connection::open(&damaged)
        .unwrap()
        .execute_batch("DROP TABLE attendance_events;")
        .unwrap();

    let future = backup_dir.join("civicflow-backup-4-manual-future.db");
    fs::copy(backup_dir.join(&backup.id), &future).unwrap();
    Connection::open(&future)
        .unwrap()
        .execute_batch("DELETE FROM schema_migrations;")
        .unwrap();

    let cases = [
        (junk, "not a readable SQLite backup"),
        (foreign, "not a CivicFlow backup"),
        (damaged, "incomplete (missing attendance_events)"),
        (future, "unsupported CivicFlow schema version"),
    ];

    for (path, expected) in cases {
        let id = path.file_name().unwrap().to_str().unwrap();
        let error = backups::restore(database.connection_mut(), &backup_dir, id)
            .expect_err("artifact must be refused");
        assert!(
            error.to_string().contains(expected),
            "expected {expected:?} for {id}, got {error}"
        );
        assert_eq!(snapshot(database.connection()).unwrap(), pristine);
        assert_eq!(audit_count(&database, "backup.restore"), 0);
    }

    assert_eq!(backups::list(&backup_dir).unwrap().len(), 1);
}

#[test]
fn retention_keeps_the_newest_snapshots_and_restore_keeps_its_safety_copy() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let mut database = seeded(&temp.path().join("civicflow.db"));

    let mut created = Vec::new();
    for index in 0..(backups::RETENTION_LIMIT + 2) {
        created.push(
            backups::create(
                database.connection(),
                &backup_dir,
                "manual",
                &format!("Retention snapshot {index}"),
            )
            .expect("create snapshot"),
        );
        std::thread::sleep(Duration::from_millis(2));
    }

    let listed = backups::list(&backup_dir).expect("list snapshots");
    assert_eq!(listed.len(), backups::RETENTION_LIMIT);
    assert_eq!(listed[0].id, created.last().unwrap().id);
    assert!(!backup_dir.join(&created[0].id).exists());
    assert!(!backup_dir.join(&created[1].id).exists());
    assert_eq!(
        fs::read_dir(&backup_dir)
            .unwrap()
            .filter(|entry| entry
                .as_ref()
                .unwrap()
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                == Some("db"))
            .count(),
        backups::RETENTION_LIMIT
    );

    // Restoring the oldest retained snapshot still writes its safety copy even
    // though that push briefly exceeds the retention limit.
    let target = listed.last().expect("oldest retained snapshot").id.clone();
    let result = backups::restore(database.connection_mut(), &backup_dir, &target)
        .expect("restore oldest snapshot");
    assert_eq!(result.backups.len(), backups::RETENTION_LIMIT);
    assert!(result
        .backups
        .iter()
        .any(|snapshot| snapshot.note == format!("Before restoring {target}")));
    assert_eq!(audit_count(&database, "backup.restore"), 1);
}

#[test]
fn restore_refuses_unknown_ids_and_traversal_names() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let mut database = seeded(&temp.path().join("civicflow.db"));
    backups::create(database.connection(), &backup_dir, "manual", "Valid backup").unwrap();

    for id in [
        "missing.db",
        "../civicflow.db",
        "civicflow-backup-1-manual-x.txt",
    ] {
        assert!(backups::restore(database.connection_mut(), &backup_dir, id).is_err());
    }
}

#[test]
fn a_snapshot_from_an_older_schema_is_migrated_instead_of_refused() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let mut database = seeded(&temp.path().join("civicflow.db"));
    let snapshot = backups::create(database.connection(), &backup_dir, "manual", "Older build")
        .expect("snapshot");

    // Rewind the copy to the schema of the release before this one, which is
    // what an existing snapshot on a real device looks like after an update.
    let path = backup_dir.join(&snapshot.id);
    {
        let conn = Connection::open(&path).expect("open the snapshot");
        conn.execute("DELETE FROM schema_migrations WHERE version = 6", [])
            .unwrap();
        conn.execute("DROP TABLE auth_attempts", []).unwrap();
    }
    backups::validate(&path).expect("an older snapshot is still readable");

    let restored =
        backups::restore(database.connection_mut(), &backup_dir, &snapshot.id).expect("restore");
    assert!(
        !restored.backups.is_empty(),
        "the restored list is not empty"
    );

    let version: i64 = database
        .connection()
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(version, civicflow_core::db::SCHEMA_VERSION);
    let throttled: i64 = database
        .connection()
        .query_row("SELECT COUNT(*) FROM auth_attempts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(throttled, 0, "the restored copy has the new table");
}

#[test]
fn a_snapshot_from_a_newer_build_is_refused() {
    let temp = TempDir::new();
    let backup_dir = temp.path().join("backups");
    let mut database = seeded(&temp.path().join("civicflow.db"));
    let snapshot = backups::create(database.connection(), &backup_dir, "manual", "Future build")
        .expect("snapshot");

    {
        let conn = Connection::open(backup_dir.join(&snapshot.id)).expect("open the snapshot");
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![
                civicflow_core::db::SCHEMA_VERSION + 1,
                "2030-01-01T00:00:00Z"
            ],
        )
        .unwrap();
    }

    assert!(backups::validate(&backup_dir.join(&snapshot.id)).is_err());
    assert!(backups::restore(database.connection_mut(), &backup_dir, &snapshot.id).is_err());
}

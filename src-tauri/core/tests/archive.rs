//! Contract for encrypted backups: a sealed archive is the only thing that
//! leaves the machine, and a wrong passphrase never reaches the live database.

use std::fs;
use std::path::{Path, PathBuf};

use civicflow_core::{archive, backups, Database};

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("civicflow-archive-{}", uuid::Uuid::new_v4()));
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

const PASSPHRASE: &str = "open-shift-on-the-river";

#[test]
fn a_sealed_archive_restores_into_an_empty_workspace() {
    let dir = TempDir::new();
    let source = seeded(&dir.path().join("source.db"));
    let target = dir.path().join("monday.civicflow");

    let receipt =
        archive::export(source.connection(), &target, PASSPHRASE, "Monday").expect("export");
    assert!(receipt.bytes > 0);
    assert!(target.is_file());

    // The archive is not a SQLite file: that is the whole point.
    let head = fs::read(&target).expect("read archive");
    assert_eq!(&head[..12], b"CIVICFLOW-AR");
    assert_ne!(&head[..16], b"SQLite format 3\0");

    let mut restored = Database::open(dir.path().join("restored.db")).expect("fresh database");
    let result = archive::import(
        restored.connection_mut(),
        &dir.path().join("backups"),
        &target,
        PASSPHRASE,
    )
    .expect("import");
    // The restored workspace is the demo organization, with its people intact.
    assert_eq!(result.snapshot.settings.organization_name, "FeedMore WNY");
    let restored_counts = result
        .backups
        .iter()
        .map(|snapshot| snapshot.counts.volunteers)
        .max()
        .unwrap_or(0);
    assert!(restored_counts > 0);
}

#[test]
fn the_wrong_passphrase_is_refused_before_anything_is_written() {
    let dir = TempDir::new();
    let source = seeded(&dir.path().join("source.db"));
    let target = dir.path().join("monday.civicflow");
    archive::export(source.connection(), &target, PASSPHRASE, "").expect("export");

    let mut restored = Database::open(dir.path().join("restored.db")).expect("fresh database");
    let backup_dir = dir.path().join("backups");
    let error = archive::import(
        restored.connection_mut(),
        &backup_dir,
        &target,
        "open-shift-on-the-lake",
    )
    .expect_err("wrong passphrase");
    assert!(
        error.to_string().contains("passphrase"),
        "unexpected error: {error}"
    );
    // No staged copy and no snapshot appeared, so the workspace is untouched.
    let listing = fs::read_dir(&backup_dir)
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(listing, 0);
}

#[test]
fn a_changed_byte_fails_the_same_way_a_wrong_passphrase_does() {
    let dir = TempDir::new();
    let source = seeded(&dir.path().join("source.db"));
    let target = dir.path().join("monday.civicflow");
    archive::export(source.connection(), &target, PASSPHRASE, "").expect("export");

    let mut bytes = fs::read(&target).expect("read");
    let last = bytes.len() - 1;
    bytes[last] ^= 0b0000_0001;
    let damaged = dir.path().join("damaged.civicflow");
    fs::write(&damaged, &bytes).expect("write");

    let mut restored = Database::open(dir.path().join("restored.db")).expect("fresh database");
    let error = archive::import(
        restored.connection_mut(),
        &dir.path().join("backups"),
        &damaged,
        PASSPHRASE,
    )
    .expect_err("damaged archive");
    assert!(
        error.to_string().contains("changed"),
        "unexpected error: {error}"
    );
}

#[test]
fn a_plain_snapshot_cannot_be_passed_off_as_an_archive() {
    let dir = TempDir::new();
    let source = seeded(&dir.path().join("source.db"));
    let backups_dir = dir.path().join("backups");
    let snapshot =
        backups::create(source.connection(), &backups_dir, "manual", "Plain").expect("snapshot");
    let plain = backups_dir.join(&snapshot.id);

    let mut restored = Database::open(dir.path().join("restored.db")).expect("fresh database");
    let error = archive::import(
        restored.connection_mut(),
        &dir.path().join("other"),
        &plain,
        PASSPHRASE,
    )
    .expect_err("plain snapshot");
    assert!(error
        .to_string()
        .contains("not a CivicFlow encrypted backup"));
}

#[test]
fn a_short_passphrase_is_refused_rather_than_stretched() {
    let dir = TempDir::new();
    let source = seeded(&dir.path().join("source.db"));
    let target = dir.path().join("monday.civicflow");
    let error =
        archive::export(source.connection(), &target, "short", "").expect_err("short passphrase");
    assert!(error.to_string().contains("at least 12 characters"));
    assert!(!target.exists());
}

#[test]
fn the_sealed_archive_does_not_contain_the_volunteer_names() {
    let dir = TempDir::new();
    let source = seeded(&dir.path().join("source.db"));
    let target = dir.path().join("monday.civicflow");
    archive::export(source.connection(), &target, PASSPHRASE, "").expect("export");

    let bytes = fs::read(&target).expect("read");
    let haystack = String::from_utf8_lossy(&bytes).to_lowercase();
    assert!(!haystack.contains("feedmore"));
    assert!(!haystack.contains("buffalo"));
}

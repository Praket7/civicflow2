//! The workspace file is unreadable without the key this machine holds, and a
//! plaintext workspace from an earlier build is sealed on the way in.

use std::fs;
use std::path::Path;

use civicflow_core::{archive, backups, Database};
use rusqlite::Connection;

const KEY: [u8; 32] = [0x42; 32];

fn is_plaintext(path: &Path) -> bool {
    fs::read(path)
        .map(|bytes| bytes.starts_with(b"SQLite format 3\0"))
        .unwrap_or(false)
}

#[test]
fn an_encrypted_workspace_needs_its_key_for_every_copy() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("civicflow.db");

    // Written by a build that did not encrypt. Opening it with a key must keep
    // the records and leave ciphertext behind.
    {
        let mut plain = Database::open(&path).expect("open plaintext workspace");
        assert!(plain.seed_demo().expect("seed demo"));
        assert!(is_plaintext(&path));
    }

    {
        let database = Database::open_with_key(&path, KEY).expect("open encrypted workspace");
        assert!(
            database.cipher_version().is_some(),
            "the workspace should be opened by SQLCipher"
        );
    }
    assert!(
        !is_plaintext(&path),
        "the workspace file should be ciphertext"
    );

    // The point of the exercise: a copy of the file is not a workspace.
    let outsider = Connection::open(&path).expect("open the file itself");
    assert!(
        outsider
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| row
                .get::<_, i64>(0))
            .is_err(),
        "a reader without the key must not see the schema"
    );
    drop(outsider);

    let mut database = Database::open_with_key(&path, KEY).expect("reopen with the key");
    let backup_dir = dir.path().join("backups");

    // Snapshots are copies of the live file, so they inherit the encryption.
    let snapshot = backups::create(
        database.connection(),
        &backup_dir,
        "manual",
        "Encryption test",
    )
    .expect("create snapshot");
    let snapshot_path = backup_dir.join(&snapshot.id);
    assert!(
        !is_plaintext(&snapshot_path),
        "a snapshot should be ciphertext"
    );
    backups::validate(&snapshot_path).expect("validate snapshot");
    assert_eq!(backups::list(&backup_dir).expect("list").len(), 1);

    // And the portable archive is sealed a second time with a passphrase.
    let target = dir.path().join("off-device.civicflow");
    let receipt = archive::export(
        database.connection(),
        &target,
        "correct horse battery",
        "Off-device copy",
    )
    .expect("export archive");
    assert!(receipt.bytes > 0);
    let sealed = fs::read(&target).expect("read archive");
    assert!(!is_plaintext(&target));
    assert!(archive::open(&sealed, "not the passphrase").is_err());
    assert!(archive::open(&sealed[..sealed.len() / 2], "correct horse battery").is_err());

    let restored = archive::import(
        database.connection_mut(),
        &backup_dir,
        &target,
        "correct horse battery",
    )
    .expect("import archive");
    assert!(!restored.backups.is_empty());
}

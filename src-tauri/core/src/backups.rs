//! Local SQLite snapshots and restore.
//!
//! A snapshot is written with SQLite's online backup API, so it is a
//! transactionally consistent copy rather than a byte copy taken mid-write.
//! Restore is deliberately narrow: only a file in the workspace backup
//! directory whose application id, schema, integrity, and foreign keys all
//! check out can replace the live database.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::db::APPLICATION_ID;
use crate::error::{CoreError, Result};
use crate::models::{BackupCounts, BackupRestoreResult, BackupSnapshot};
use crate::workflows;

/// Snapshots beyond this count are pruned oldest-first. The limit covers
/// manual and automatic snapshots together so the directory stays bounded.
pub const RETENTION_LIMIT: usize = 20;

/// Every table any build has created; older snapshots are migrated after copying.
const REQUIRED_TABLES: [&str; 32] = [
    "organizations",
    "app_settings",
    "volunteers",
    "volunteer_skills",
    "opportunities",
    "shifts",
    "shift_roles",
    "hour_entries",
    "notifications",
    "auth_sessions",
    "activity_events",
    "audit_events",
    "impact_totals",
    "saved_opportunities",
    "applications",
    "waitlist_entries",
    "registrations",
    "attendance_events",
    "users",
    "availability_rules",
    "credential_types",
    "volunteer_credentials",
    "role_requirements",
    "attendance_ledger",
    "checkin_codes",
    "service_verifications",
    "impact_metric_definitions",
    "impact_results",
    "report_saved_views",
    "volunteer_stage_history",
    "backup_snapshots",
    "schema_migrations",
];

fn validation(message: impl Into<String>) -> CoreError {
    CoreError::Validation(message.into())
}

fn open_read_only(path: &Path) -> Result<Connection> {
    // Through the workspace opener so an encrypted snapshot is keyed exactly
    // like the database it came from.
    crate::db::open_read_only(path)
        .map_err(|_| validation("That file is not a readable SQLite backup."))
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// Runs before a restore and while listing, so a damaged file is never offered.
pub fn validate(path: &Path) -> Result<()> {
    let conn = open_read_only(path)?;
    let application_id: i64 = conn
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(|_| validation("That file is not a readable SQLite backup."))?;
    if application_id != APPLICATION_ID {
        return Err(validation("That file is not a CivicFlow backup."));
    }

    for table in REQUIRED_TABLES {
        if !table_exists(&conn, table)? {
            return Err(validation(format!(
                "This CivicFlow backup is incomplete (missing {table})."
            )));
        }
    }

    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    // Older snapshots are the normal case after an update, and the restore
    // step migrates them forward. Only a snapshot from a newer build is
    // unreadable here, because this build cannot know what it is missing.
    if !(1..=crate::db::SCHEMA_VERSION).contains(&version) {
        return Err(validation(
            "This backup uses an unsupported CivicFlow schema version.",
        ));
    }

    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| validation("This CivicFlow backup is corrupt."))?;
    if integrity != "ok" {
        return Err(validation(
            "This CivicFlow backup is corrupt (integrity check failed).",
        ));
    }

    let mut statement = conn.prepare("PRAGMA foreign_key_check")?;
    let mut rows = statement.query([])?;
    if rows.next()?.is_some() {
        return Err(validation(
            "This CivicFlow backup has broken foreign keys and was not restored.",
        ));
    }

    // The application id is written by every CivicFlow database and survives a
    // copy, so it identifies the file without depending on a pinned clock: a
    // real workspace legitimately follows the system clock.
    let application_id: i64 = conn.query_row("PRAGMA application_id", [], |row| row.get(0))?;
    if application_id != crate::db::APPLICATION_ID {
        return Err(validation("This file is not a CivicFlow workspace backup."));
    }

    Ok(())
}

fn sha256(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn count(conn: &Connection, table: &str) -> Result<i64> {
    Ok(
        conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
            row.get(0)
        })?,
    )
}

fn read_meta(path: &Path) -> Result<BackupSnapshot> {
    validate(path)?;
    let conn = open_read_only(path)?;
    let created_at: String = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'backup_created_at'",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| {
            // A workspace on the system clock has no pinned timestamp. The file
            // mtime is the honest answer for when the snapshot was written.
            let stamp = fs::metadata(path)
                .and_then(|meta| meta.modified())
                .map(chrono::DateTime::<chrono::Utc>::from)
                .unwrap_or_else(|_| chrono::Utc::now());
            stamp.to_rfc3339()
        });
    let counts = BackupCounts {
        volunteers: count(&conn, "volunteers")?,
        programs: count(&conn, "opportunities")?,
        shifts: count(&conn, "shifts")?,
        hours: count(&conn, "hour_entries")?,
        notifications: count(&conn, "notifications")?,
        audit: conn.query_row(
            "SELECT COUNT(*) FROM audit_events WHERE action <> 'demo_seeded'",
            [],
            |row| row.get(0),
        )?,
    };
    let mut rows = 0;
    let mut statement = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let mut names = statement.query([])?;
    while let Some(row) = names.next()? {
        let table: String = row.get(0)?;
        rows += count(&conn, &table)?;
    }

    let id = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| validation("Backup file name is not valid."))?
        .to_string();
    let kind = id
        .split('-')
        .nth(3)
        .filter(|kind| *kind == "manual" || *kind == "automatic")
        .unwrap_or("manual")
        .to_string();
    let bytes = i64::try_from(fs::metadata(path)?.len()).unwrap_or(i64::MAX);
    let schema_version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    let checksum = sha256(path)?;
    let note: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'backup_note'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    let note = note.unwrap_or_else(|| {
        if kind == "automatic" {
            "Automatic snapshot".to_string()
        } else {
            "Manual snapshot".to_string()
        }
    });
    Ok(BackupSnapshot {
        id,
        created_at,
        kind,
        bytes,
        rows,
        note,
        counts,
        sha256: checksum,
        schema_version,
        integrity: "ok".into(),
    })
}

fn backup_path(dir: &Path, id: &str) -> Result<PathBuf> {
    if id.is_empty()
        || Path::new(id).file_name().and_then(|name| name.to_str()) != Some(id)
        || !id.ends_with(".db")
    {
        return Err(validation("That snapshot id is not valid."));
    }
    let path = dir.join(id);
    if !path.is_file() {
        return Err(CoreError::NotFound(format!("Backup {id}")));
    }
    Ok(path)
}

/// Keeps the newest `RETENTION_LIMIT`; `protect` files survive and do not count.
fn prune(dir: &Path, protect: &[&str]) -> Result<()> {
    let snapshots = list(dir)?;
    let mut kept = 0;
    for snapshot in snapshots {
        kept += 1;
        if protect.contains(&snapshot.id.as_str()) {
            continue;
        }
        if kept > RETENTION_LIMIT {
            fs::remove_file(dir.join(&snapshot.id))?;
        }
    }
    Ok(())
}

fn create_with_protection(
    conn: &Connection,
    dir: &Path,
    kind: &str,
    note: &str,
    protect: Option<&str>,
) -> Result<BackupSnapshot> {
    if kind != "manual" && kind != "automatic" {
        return Err(validation(format!("Unknown backup kind: {kind}")));
    }
    fs::create_dir_all(dir)?;
    let id = format!(
        "civicflow-backup-{}-{}-{}.db",
        Utc::now().timestamp_millis(),
        kind,
        uuid::Uuid::new_v4().simple()
    );
    let path = dir.join(&id);
    let mut destination = crate::db::open_new(&path)?;
    {
        let backup = Backup::new(conn, &mut destination)?;
        backup.run_to_completion(100, Duration::from_millis(0), None)?;
    }
    drop(destination);

    if let Err(error) = validate(&path) {
        let _ = fs::remove_file(&path);
        return Err(error);
    }

    let note = if note.trim().is_empty() {
        if kind == "automatic" {
            "Automatic snapshot"
        } else {
            "Manual snapshot"
        }
    } else {
        note.trim()
    };
    {
        let conn = crate::db::open_existing(&path)?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backup_note', ?1)",
            params![note],
        )?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backup_created_at', ?1)",
            params![Utc::now().to_rfc3339()],
        )?;
    }
    let mut protected = vec![id.as_str()];
    if let Some(target) = protect {
        protected.push(target);
    }
    prune(dir, &protected)?;
    let snapshot = read_meta(&path)?;
    conn.execute(
        "INSERT OR REPLACE INTO backup_snapshots
         (id, path, created_at, trigger, database_size, sha256, schema_version, integrity,
          counts_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            &snapshot.id,
            path.to_string_lossy(),
            &snapshot.created_at,
            &snapshot.kind,
            snapshot.bytes,
            &snapshot.sha256,
            snapshot.schema_version,
            &snapshot.integrity,
            serde_json::to_string(&snapshot.counts)?,
        ],
    )?;
    Ok(snapshot)
}

/// Writes a consistent copy of the live database into `dir` and prunes older
/// snapshots past the retention limit.
pub fn create(conn: &Connection, dir: &Path, kind: &str, note: &str) -> Result<BackupSnapshot> {
    create_with_protection(conn, dir, kind, note, None)
}

pub fn list(dir: &Path) -> Result<Vec<BackupSnapshot>> {
    fs::create_dir_all(dir)?;
    let mut snapshots = Vec::new();
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("db") {
            continue;
        }
        if let Ok(meta) = read_meta(&path) {
            snapshots.push(meta);
        }
    }
    snapshots.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.id.cmp(&a.id))
    });
    Ok(snapshots)
}

/// Creates a safety snapshot, replaces the live database from `id`, and records
/// the restore in the restored audit trail.
pub fn restore(conn: &mut Connection, dir: &Path, id: &str) -> Result<BackupRestoreResult> {
    let path = backup_path(dir, id)?;
    validate(&path)?;

    let safety = create_with_protection(
        conn,
        dir,
        "automatic",
        &format!("Before restoring {id}"),
        Some(id),
    )?;

    let source = open_read_only(&path)?;
    {
        let backup = Backup::new(&source, conn)?;
        backup.run_to_completion(100, Duration::from_millis(0), None)?;
    }
    drop(source);

    // The restored copy carries the schema version it was taken at. Bring it up
    // to this build before anything else touches it.
    crate::db::apply_migrations(conn)?;

    let detail = format!("Safety snapshot: {}", safety.id);
    workflows::append_audit(
        conn,
        "backup.restore",
        "backup",
        id,
        format!("Restored backup {id}"),
        Some(detail),
    )?;

    // The target is no longer needed once the copy is complete, so the
    // directory returns to the same bounded size as a normal snapshot.
    prune(dir, &[])?;

    Ok(BackupRestoreResult {
        snapshot: workflows::snapshot(conn)?,
        backups: list(dir)?,
    })
}

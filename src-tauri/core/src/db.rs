use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};

use crate::error::{CoreError, Result};
use crate::models::{SeedWorkflow, SeedWorkspace, WorkspaceHealth};

/// The demo seed is authored once and embedded at build time. The Rust seeder and
/// the browser preview therefore read the exact same records.
pub const DEMO_SEED: &str = include_str!("../../../shared/demo-workspace.json");
/// Workflow defaults, beside the workspace seed so both stores start equal.
pub const WORKFLOW_SEED: &str = include_str!("../../../shared/session-seed.json");
/// Bumped with every migration so backups can check they match this build.
pub const SCHEMA_VERSION: i64 = 15;
/// "CIFV" — marks a database as a CivicFlow workspace so restore can refuse
/// an arbitrary SQLite file.
pub const APPLICATION_ID: i64 = 0x4349_4656;
const INITIAL_SCHEMA: &str = include_str!("../migrations/0001_initial.sql");
const WORKFLOW_SCHEMA: &str = include_str!("../migrations/0002_workflows.sql");
const LIFECYCLE_SCHEMA: &str = include_str!("../migrations/0003_service_lifecycle.sql");
const ACCOUNT_SCHEMA: &str =
    include_str!("../migrations/0004_accounts_and_notification_audiences.sql");
const VOLUNTEER_PHOTO_SCHEMA: &str = include_str!("../migrations/0005_volunteer_photo.sql");
const AUTH_ATTEMPT_SCHEMA: &str = include_str!("../migrations/0006_auth_attempts.sql");
const ORGANIZATION_SCHEMA: &str =
    include_str!("../migrations/0007_organizations_memberships_invites.sql");
const ROSTER_POLICY_SCHEMA: &str = include_str!("../migrations/0008_roster_policy.sql");
const ASSIGNMENT_LOCK_SCHEMA: &str = include_str!("../migrations/0009_assignment_locks.sql");
const SHIFT_SERIES_SCHEMA: &str = include_str!("../migrations/0010_shift_series.sql");
const NOTIFICATION_RULE_SCHEMA: &str = include_str!("../migrations/0011_notification_rules.sql");
const OWNERSHIP_SYNC_SCHEMA: &str =
    include_str!("../migrations/0012_ownership_sync_and_revisions.sql");
const WORKSPACE_CLOCK_SCHEMA: &str = include_str!("../migrations/0013_workspace_clock.sql");
const ORGANIZATION_SCOPE_SCHEMA: &str = include_str!("../migrations/0014_organization_scope.sql");
const SHARED_REPLICA_SCHEMA: &str = include_str!("../migrations/0015_shared_replica.sql");
const WORKFLOW_SEED_MARKER: &str = "workflow_seed_version";

const CREDENTIAL_TYPES: [(&str, i64); 6] = [
    ("Safe driver clearance", 24),
    ("Food safety handler", 12),
    ("Tutor certification", 24),
    ("CPR / AED", 12),
    ("Garden tool safety", 12),
    ("Volunteer team lead", 24),
];

pub(crate) fn slug_id(prefix: &str, value: &str) -> String {
    let slug: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("{prefix}-{}", slug.trim_matches('-'))
}

/// Derived from the authored role names so the seed and engine cannot drift; an
/// unmapped role is open to any eligible volunteer.
fn role_requirement(role: &str) -> (Option<String>, Option<String>, Option<i64>) {
    let role = role.to_lowercase();
    if role.contains("spanish") {
        return (Some("Spanish".into()), None, None);
    }
    if role.contains("driver") || role.contains("delivery") {
        return (
            Some("Driver".into()),
            Some("Safe driver clearance".into()),
            Some(18),
        );
    }
    if role.contains("tutor") {
        return (
            Some("Tutoring".into()),
            Some("Tutor certification".into()),
            Some(16),
        );
    }
    if role.contains("food") || role.contains("pantry") || role.contains("sort") {
        return (
            Some("Food handling".into()),
            Some("Food safety handler".into()),
            None,
        );
    }
    if role.contains("garden") || role.contains("tool") {
        return (
            Some("Gardening".into()),
            Some("Garden tool safety".into()),
            None,
        );
    }
    (None, None, None)
}

/// A restore replaces the live database, so the copy must catch up to this build.
const MIGRATIONS: [(i64, &str); 15] = [
    (1, INITIAL_SCHEMA),
    (2, WORKFLOW_SCHEMA),
    (3, LIFECYCLE_SCHEMA),
    (4, ACCOUNT_SCHEMA),
    (5, VOLUNTEER_PHOTO_SCHEMA),
    (6, AUTH_ATTEMPT_SCHEMA),
    (7, ORGANIZATION_SCHEMA),
    (8, ROSTER_POLICY_SCHEMA),
    (9, ASSIGNMENT_LOCK_SCHEMA),
    (10, SHIFT_SERIES_SCHEMA),
    (11, NOTIFICATION_RULE_SCHEMA),
    (12, OWNERSHIP_SYNC_SCHEMA),
    (13, WORKSPACE_CLOCK_SCHEMA),
    (14, ORGANIZATION_SCOPE_SCHEMA),
    (15, SHARED_REPLICA_SCHEMA),
];

pub fn apply_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;
    for (version, schema) in MIGRATIONS {
        let applied: Option<i64> = conn
            .query_row(
                "SELECT version FROM schema_migrations WHERE version = ?1",
                params![version],
                |row| row.get(0),
            )
            .optional()?;

        if applied.is_none() {
            let transaction = conn.unchecked_transaction()?;
            transaction.execute_batch(schema)?;
            transaction.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                params![version, Utc::now().to_rfc3339()],
            )?;
            transaction.commit()?;
        }
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

/// A file that starts with this is a plain SQLite database; anything else this
/// build opens is SQLCipher ciphertext.
const SQLITE_HEADER: &[u8; 16] = b"SQLite format 3\0";

/// The key that seals the workspace file. It is installed once at startup from
/// the operating system credential store; without it an encrypted workspace
/// cannot be read at all, which is the point.
static DATABASE_KEY: OnceLock<[u8; 32]> = OnceLock::new();

pub fn install_key(key: [u8; 32]) {
    let _ = DATABASE_KEY.set(key);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut key = [0u8; 32];
    for (index, chunk) in value.as_bytes().chunks(2).enumerate() {
        key[index] = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(key)
}

/// Accepts either form the desktop may have stored: 32 raw bytes as hex, or
/// the passphrase-style text a person typed. A passphrase is stretched by
/// SQLCipher's own KDF, so both are safe to hand to `PRAGMA key`.
pub fn parse_key(value: &str) -> Option<[u8; 32]> {
    decode_hex(value.trim())
}

/// The literal form SQLCipher reads as a raw 32-byte key.
fn raw_key(key: &[u8; 32]) -> String {
    format!("x'{}'", hex(key))
}

fn is_plaintext(path: &Path) -> bool {
    let mut header = [0u8; 16];
    File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map(|()| &header == SQLITE_HEADER)
        .unwrap_or(false)
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Applies the installed key and forces SQLCipher to prove it now, so a wrong
/// key is reported here rather than as a confusing error on a later query.
fn apply_key(conn: &Connection) -> Result<()> {
    let Some(key) = DATABASE_KEY.get() else {
        return Ok(());
    };
    conn.execute_batch(&format!("PRAGMA key = \"{}\";", raw_key(key)))?;
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    })?;
    Ok(())
}

/// Opens a workspace file, keying it only when it is not plaintext. A file this
/// app has not written yet (a new installation, or a test fixture) is keyed at
/// creation so it is never briefly unencrypted on disk.
fn open_path(path: &Path, flags: OpenFlags) -> Result<Connection> {
    let conn = Connection::open_with_flags(path, flags)?;
    if !is_plaintext(path) {
        apply_key(&conn)?;
    }
    Ok(conn)
}

pub(crate) fn open_read_only(path: &Path) -> Result<Connection> {
    open_path(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
}

pub(crate) fn open_existing(path: &Path) -> Result<Connection> {
    open_path(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
}

/// A destination connection for a copy: new and empty, so it is keyed before
/// the first page is written.
pub(crate) fn open_new(path: &Path) -> Result<Connection> {
    open_path(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
    )
}

/// Rewrites a plaintext workspace as ciphertext. The copy is written beside the
/// original, checked by reopening it, and only then swapped in, so a failure
/// leaves the readable file untouched.
fn encrypt_in_place(path: &Path) -> Result<()> {
    let key = DATABASE_KEY.get().ok_or_else(|| {
        CoreError::rule(
            "WORKSPACE_KEY",
            "This workspace cannot be encrypted without its key.",
            None,
            None,
        )
    })?;
    let staged = path.with_extension("encrypting");
    let _ = std::fs::remove_file(&staged);
    {
        let conn = Connection::open(path)?;
        // A write-ahead log would otherwise be left behind as plaintext.
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        conn.execute_batch(&format!(
            "ATTACH DATABASE {} AS encrypted KEY \"{}\";\n             SELECT sqlcipher_export('encrypted');\n             DETACH DATABASE encrypted;",
            quote(&staged.to_string_lossy()),
            raw_key(key)
        ))?;
    }
    if is_plaintext(&staged) {
        let _ = std::fs::remove_file(&staged);
        return Err(CoreError::rule(
            "WORKSPACE_KEY",
            "This build could not encrypt the workspace.",
            None,
            None,
        ));
    }
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }
    std::fs::rename(&staged, path)?;
    Ok(())
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let conn = open_path(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )?;
        let database = Self { conn };
        database.configure()?;
        database.migrate()?;
        Ok(database)
    }

    /// Opens the workspace that belongs to a key, upgrading a plaintext file
    /// left by an earlier build on the way in.
    pub fn open_with_key(path: impl AsRef<Path>, key: [u8; 32]) -> Result<Self> {
        install_key(key);
        let path = path.as_ref();
        if path.is_file() && is_plaintext(path) {
            encrypt_in_place(path)?;
        }
        Self::open(path)
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let database = Self { conn };
        database.configure()?;
        database.migrate()?;
        Ok(database)
    }

    fn configure(&self) -> Result<()> {
        self.conn.execute_batch(&format!(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA journal_mode = WAL;
             PRAGMA application_id = {APPLICATION_ID};
             PRAGMA user_version = {SCHEMA_VERSION};"
        ))?;
        Ok(())
    }

    /// Whether SQLCipher is the engine under this connection. A plaintext file
    /// opened without a key reports no cipher version, which is how a build can
    /// notice the workspace is not protected.
    pub fn cipher_version(&self) -> Option<String> {
        self.conn
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))
            .optional()
            .ok()
            .flatten()
    }

    fn migrate(&self) -> Result<()> {
        apply_migrations(&self.conn)
    }

    /// Whether this workspace is the bundled demo rather than a real
    /// organization. Only a demo workspace may be reset to its fixtures.
    pub fn is_demo(&self) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM organizations WHERE is_demo = 1)",
            [],
            |row| row.get(0),
        )?)
    }

    /// Never overwrites a workspace that already holds an organization.
    pub fn seed_demo(&mut self) -> Result<bool> {
        let organizations: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM organizations", [], |row| row.get(0))?;
        if organizations > 0 {
            return Err(CoreError::rule(
                "WORKSPACE_NOT_EMPTY",
                "This workspace already has an organization. Open the demo from a separate installation.",
                None,
                Some("RETURN_TO_SIGN_IN".into()),
            ));
        }
        self.seed_demo_if_empty()
    }

    /// Loads the deterministic demo workspace once. Re-running is a no-op so the
    /// app can start repeatedly without duplicating records.
    pub fn seed_demo_if_empty(&mut self) -> Result<bool> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM volunteers", [], |row| row.get(0))?;
        let seeded = count == 0;
        let seed = SeedWorkspace::parse(DEMO_SEED)?;
        if seeded {
            self.insert_seed(&seed)?;
        }
        crate::auth::seed_demo_accounts(&self.conn, &seed.now)?;
        // The bundled accounts belong to the workspace organization, exactly as
        // an upgraded database does after the membership migration.
        crate::organizations::backfill_memberships(&self.conn)?;
        self.seed_workflow_defaults()?;
        // Startup establishes the installation's own workspace for this
        // connection. The first authenticated command replaces it with the
        // organization the account selected, and a sign-out clears it.
        let organization: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM organizations ORDER BY created_at, id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        crate::scope::select(&self.conn, organization.as_deref())?;
        Ok(seeded)
    }

    /// One-time workflow defaults. The marker keeps deletions and decisions made
    /// by the user from being re-seeded on the next launch.
    fn seed_workflow_defaults(&mut self) -> Result<()> {
        let marker: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![WORKFLOW_SEED_MARKER],
                |row| row.get(0),
            )
            .optional()?;
        if marker.is_some() {
            return Ok(());
        }

        let seed = SeedWorkflow::parse(WORKFLOW_SEED)?;
        // The fixture names its own volunteer, so a different seed cannot
        // silently inherit an identifier from this one.
        let volunteer_id: String = self
            .conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'current_volunteer_id'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .or_else(|| {
                SeedWorkspace::parse(DEMO_SEED)
                    .ok()
                    .map(|workspace| workspace.current_volunteer_id)
            })
            .unwrap_or_default();
        let now = crate::clock::now(&self.conn)?.to_rfc3339();
        // Workflow defaults belong to the organization this workspace was
        // created for, which is the one the demo seed just inserted.
        let organization: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM organizations ORDER BY created_at, id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;

        let transaction = self.conn.transaction()?;
        for opportunity_id in &seed.saved_opportunity_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO saved_opportunities
                 (volunteer_id, opportunity_id, saved_at) VALUES (?1, ?2, ?3)",
                params![volunteer_id, opportunity_id, now],
            )?;
        }
        for application in &seed.applications {
            transaction.execute(
                "INSERT OR IGNORE INTO applications
                 (id, name, email, initials, tone, stage, applied_at, source, cause,
                  skills_json, note, organization_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    application.id,
                    application.name,
                    application.email,
                    application.initials,
                    application.tone,
                    application.stage,
                    application.applied_at,
                    application.source,
                    application.cause,
                    serde_json::to_string(&application.skills)?,
                    application.note,
                    organization,
                ],
            )?;
        }
        for entry in &seed.waitlist {
            transaction.execute(
                "INSERT OR IGNORE INTO waitlist_entries
                 (id, shift_id, volunteer_id, created_at, status, position, eligible_role)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    entry.id,
                    entry.shift_id,
                    entry.volunteer_id,
                    entry.created_at,
                    entry.status,
                    entry.position,
                    entry.eligible_role,
                ],
            )?;
        }
        for event in &seed.audit {
            transaction.execute(
                "INSERT OR IGNORE INTO audit_events
                 (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary,
                  detail, organization_id)
                 VALUES (?1, ?2, 'coordinator', ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    event.id,
                    event.at,
                    event.actor,
                    event.action,
                    event.entity_type,
                    event.entity_id,
                    event.summary,
                    event.detail,
                    organization,
                ],
            )?;
        }
        let settings = &seed.settings;
        let pairs = [
            ("setting.week_starts_on", settings.week_starts_on.clone()),
            (
                "setting.default_shift_length",
                settings.default_shift_length.to_string(),
            ),
            (
                "setting.auto_promote_waitlist",
                settings.auto_promote_waitlist.to_string(),
            ),
            (
                "setting.hours_require_approval",
                settings.hours_require_approval.to_string(),
            ),
            ("setting.email_digest", settings.email_digest.clone()),
            ("setting.text_scale", settings.text_scale.clone()),
            ("setting.high_contrast", settings.high_contrast.to_string()),
            (
                "setting.reduced_motion",
                settings.reduced_motion.to_string(),
            ),
            (
                "setting.underline_links",
                settings.underline_links.to_string(),
            ),
            (
                "setting.colour_independent",
                settings.colour_independent.to_string(),
            ),
        ];
        for (key, value) in pairs {
            transaction.execute(
                "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        transaction.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, '1')",
            params![WORKFLOW_SEED_MARKER],
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Restores the deterministic demo state. Callers must hold the database
    /// mutex; the screens then read the returned snapshot instead of reloading.
    pub fn reset_demo(&mut self) -> Result<()> {
        if !self.is_demo()? {
            return Err(CoreError::rule(
                "NOT_A_DEMO_WORKSPACE",
                "Only the demo workspace can be reset. This organization holds real records.",
                None,
                None,
            ));
        }
        // The ownership guard would refuse to delete the last owner, so it is
        // dropped for the wholesale reset and reinstalled before the seed.
        self.conn.execute_batch(
            "DROP TRIGGER IF EXISTS organization_memberships_keep_owner_on_update;
             DROP TRIGGER IF EXISTS organization_memberships_keep_owner_on_delete;
             DELETE FROM checkin_codes;
             DELETE FROM attendance_ledger;
             DELETE FROM service_verifications;
             DELETE FROM impact_results;
             DELETE FROM impact_metric_definitions;
             DELETE FROM volunteer_credentials;
             DELETE FROM credential_types;
             DELETE FROM role_requirements;
             DELETE FROM availability_rules;
             DELETE FROM volunteer_stage_history;
             DELETE FROM report_saved_views;
             DELETE FROM backup_snapshots;
             DELETE FROM users;
             DELETE FROM attendance_events;
             DELETE FROM registrations;
             DELETE FROM waitlist_entries;
             DELETE FROM saved_opportunities;
             DELETE FROM applications;
             DELETE FROM audit_events;
             DELETE FROM hour_entries;
             DELETE FROM auth_sessions;
             DELETE FROM auth_attempts;
             DELETE FROM notifications;
             DELETE FROM activity_events;
             DELETE FROM shift_roles;
             DELETE FROM shifts;
             DELETE FROM opportunities;
             DELETE FROM volunteer_skills;
             DELETE FROM volunteers;
             DELETE FROM impact_totals;
             DELETE FROM organizations;
             DELETE FROM app_settings;",
        )?;
        let seed = SeedWorkspace::parse(DEMO_SEED)?;
        crate::organizations::install_ownership_guards(&self.conn)?;
        self.insert_seed(&seed)?;
        crate::auth::seed_demo_accounts(&self.conn, &seed.now)?;
        // The bundled accounts belong to the workspace organization, exactly as
        // an upgraded database does after the membership migration.
        crate::organizations::backfill_memberships(&self.conn)?;
        self.seed_workflow_defaults()?;
        Ok(())
    }

    fn insert_seed(&mut self, seed: &SeedWorkspace) -> Result<()> {
        let transaction = self.conn.transaction()?;

        transaction.execute(
            "INSERT INTO organizations
             (id, name, initials, mission, city, state, address, website, email, timezone, created_at,
              is_demo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1)",
            params![
                seed.organization.id,
                seed.organization.name,
                seed.organization.initials,
                seed.organization.mission,
                seed.organization.city,
                seed.organization.state,
                seed.organization.address,
                seed.organization.website,
                seed.organization.email,
                seed.organization.timezone,
                seed.now,
            ],
        )?;

        for (key, value) in seed.settings() {
            transaction.execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }

        for (name, months) in CREDENTIAL_TYPES {
            transaction.execute(
                "INSERT OR IGNORE INTO credential_types (id, name, validity_months)
                 VALUES (?1, ?2, ?3)",
                params![slug_id("credential", name), name, months],
            )?;
        }

        {
            let mut statement = transaction.prepare(
                "INSERT INTO volunteers
                 (id, organization_id, name, first_name, initials, role, email, phone, joined_at,
                  status, tone, languages_json, causes_json, hours_verified, attendance_rate,
                  events_completed, interests, availability_json, birthdate)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                         ?17, ?18, ?19)",
            )?;
            let mut skill_statement = transaction
                .prepare("INSERT INTO volunteer_skills (volunteer_id, skill) VALUES (?1, ?2)")?;
            let mut availability_statement = transaction.prepare(
                "INSERT OR IGNORE INTO availability_rules (id, volunteer_id, day, period)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for volunteer in &seed.volunteers {
                statement.execute(params![
                    volunteer.id,
                    seed.organization.id,
                    volunteer.name,
                    volunteer.first_name,
                    volunteer.initials,
                    volunteer.role,
                    volunteer.email,
                    volunteer.phone,
                    volunteer.joined_at,
                    volunteer.status,
                    volunteer.tone,
                    serde_json::to_string(&volunteer.languages)?,
                    serde_json::to_string(&volunteer.causes)?,
                    volunteer.hours_verified,
                    volunteer.attendance_rate,
                    volunteer.events_completed,
                    volunteer.interests,
                    serde_json::to_string(
                        &volunteer
                            .availability
                            .iter()
                            .map(|slot| format!("{}:{}", slot.day, slot.period))
                            .collect::<Vec<_>>()
                    )?,
                    volunteer.birthdate,
                ])?;
                for skill in &volunteer.skills {
                    skill_statement.execute(params![volunteer.id, skill])?;
                }
                for slot in &volunteer.availability {
                    availability_statement.execute(params![
                        format!("avail-{}-{}-{}", volunteer.id, slot.day, slot.period),
                        volunteer.id,
                        slot.day,
                        slot.period,
                    ])?;
                }
            }
        }

        {
            let mut statement = transaction.prepare(
                "INSERT INTO opportunities
                 (id, organization_id, slug, title, cause, organization_name, image, image_alt,
                  description, address, distance_miles, coordinator, capacity, duration,
                  training_json, requirements_json, impact_metric)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            )?;
            for opportunity in &seed.opportunities {
                statement.execute(params![
                    opportunity.id,
                    seed.organization.id,
                    opportunity.slug,
                    opportunity.title,
                    opportunity.cause,
                    opportunity.organization,
                    opportunity.image,
                    opportunity.image_alt,
                    opportunity.description,
                    opportunity.address,
                    opportunity.distance_miles,
                    opportunity.coordinator,
                    opportunity.capacity,
                    opportunity.duration,
                    serde_json::to_string(&opportunity.training)?,
                    serde_json::to_string(&opportunity.requirements)?,
                    opportunity.impact_metric,
                ])?;
            }
        }

        {
            let mut shift_statement = transaction.prepare(
                "INSERT INTO shifts
                 (id, opportunity_id, starts_at, ends_at, capacity, confirmed, waitlisted, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            let mut role_statement = transaction.prepare(
                "INSERT INTO shift_roles (shift_id, name, required, filled) VALUES (?1, ?2, ?3, ?4)",
            )?;
            let mut requirement_statement = transaction.prepare(
                "INSERT OR IGNORE INTO role_requirements
                 (id, shift_id, role_name, skill, credential_type_id, minimum_age)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for shift in &seed.shifts {
                shift_statement.execute(params![
                    shift.id,
                    shift.opportunity_id,
                    shift.starts_at,
                    shift.ends_at,
                    shift.capacity,
                    shift.confirmed,
                    shift.waitlisted,
                    shift.status,
                ])?;
                for role in &shift.roles {
                    role_statement.execute(params![
                        shift.id,
                        role.name,
                        role.required,
                        role.filled
                    ])?;
                    let (skill, credential, minimum_age) = role_requirement(&role.name);
                    requirement_statement.execute(params![
                        format!("req-{}-{}", shift.id, slug_id("role", &role.name)),
                        shift.id,
                        role.name,
                        skill,
                        credential.map(|name| slug_id("credential", &name)),
                        minimum_age,
                    ])?;
                }
            }
        }

        {
            let mut statement = transaction.prepare(
                "INSERT OR IGNORE INTO registrations
                 (shift_id, volunteer_id, role, created_at, status, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?4)",
            )?;
            for registration in &seed.registrations {
                statement.execute(params![
                    registration.shift_id,
                    registration.volunteer_id,
                    registration.role,
                    seed.now,
                    registration.status,
                ])?;
            }
        }

        // Two teammates are already on site for the demo-day pantry shift. The
        // arrivals are real attendance rows and ledger evidence, not a UI guess,
        // so the kiosk, roster, and attendance screens read the same state.
        {
            let now = chrono::DateTime::parse_from_rfc3339(&seed.now)?;
            let arrived_at = (now - Duration::minutes(18)).to_rfc3339();
            let mut select = transaction.prepare(
                "SELECT volunteer_id, role FROM registrations
                 WHERE shift_id = 'sh-tue-pantry' AND volunteer_id <> ?1
                 ORDER BY volunteer_id LIMIT 2",
            )?;
            let arrivals: Vec<(String, String)> = select
                .query_map(params![seed.current_volunteer_id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?
                .collect::<std::result::Result<_, _>>()?;
            drop(select);
            let mut attendance = transaction.prepare(
                "INSERT OR IGNORE INTO attendance_events
                 (shift_id, volunteer_id, role, status, checked_in_at, checked_out_at, recorded_at)
                 VALUES ('sh-tue-pantry', ?1, ?2, 'checked_in', ?3, NULL, ?3)",
            )?;
            let mut ledger = transaction.prepare(
                "INSERT OR IGNORE INTO attendance_ledger
                 (id, shift_id, volunteer_id, event_type, actor, note, at)
                 VALUES (?1, 'sh-tue-pantry', ?2, 'check_in', ?3, ?4, ?5)",
            )?;
            for (volunteer_id, role) in arrivals {
                attendance.execute(params![&volunteer_id, &role, &arrived_at])?;
                ledger.execute(params![
                    format!("ledger-seed-{volunteer_id}"),
                    &volunteer_id,
                    &seed.coordinator.name,
                    "Seeded demo arrival",
                    &arrived_at,
                ])?;
            }
        }

        {
            let mut statement = transaction.prepare(
                "INSERT INTO hour_entries
                 (id, volunteer_id, opportunity_id, date, minutes, status, verification_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for entry in seed.hour_entries.iter().chain(seed.maya_entries.iter()) {
                statement.execute(params![
                    entry.id,
                    entry.volunteer_id,
                    entry.opportunity_id,
                    entry.date,
                    entry.minutes,
                    entry.status,
                    entry.verification_id,
                ])?;
            }
        }

        // Verified rows without an authored code still receive an official,
        // stable record code; the certificate never shows an empty identifier.
        transaction.execute(
            "UPDATE hour_entries
             SET verification_id = 'CFV-2026-' || printf('%04d', rowid)
             WHERE status = 'verified' AND verification_id IS NULL",
            [],
        )?;

        {
            let mut statement = transaction.prepare(
                "SELECT verification_id, volunteer_id, MIN(date), MAX(date), SUM(minutes),
                        COUNT(*)
                 FROM hour_entries
                 WHERE status = 'verified' AND verification_id IS NOT NULL
                 GROUP BY verification_id, volunteer_id",
            )?;
            let mut rows = statement.query([])?;
            let mut verification_statement = transaction.prepare(
                "INSERT OR IGNORE INTO service_verifications
                 (id, code, volunteer_id, organization_id, date_start, date_end,
                  total_minutes, issued_at, issued_by)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            while let Some(row) = rows.next()? {
                let code: String = row.get(0)?;
                verification_statement.execute(params![
                    format!("verification-{code}"),
                    code,
                    row.get::<_, String>(1)?,
                    seed.organization.id,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    seed.now,
                    seed.coordinator.name,
                ])?;
            }
        }

        {
            let mut type_statement = transaction.prepare(
                "INSERT OR IGNORE INTO credential_types (id, name, validity_months)
                 VALUES (?1, ?2, ?3)",
            )?;
            let mut credential_statement = transaction.prepare(
                "INSERT OR IGNORE INTO volunteer_credentials
                 (id, volunteer_id, credential_type_id, identifier, issued_at, valid_from,
                  valid_through, verified_at, verified_by, notes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )?;
            for credential in &seed.credentials {
                let type_id = slug_id("credential", &credential.name);
                type_statement.execute(params![type_id, credential.name, 24_i64])?;
                credential_statement.execute(params![
                    credential.id,
                    credential.volunteer_id,
                    type_id,
                    credential.identifier,
                    credential.issued_at,
                    credential.valid_from,
                    credential.valid_through,
                    credential.verified_at,
                    credential.verified_by,
                    credential.notes,
                ])?;
            }
        }

        {
            let mut definition_statement = transaction.prepare(
                "INSERT OR IGNORE INTO impact_metric_definitions
                 (id, opportunity_id, metric_key, name, unit, created_at, organization_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            let mut result_statement = transaction.prepare(
                "INSERT OR IGNORE INTO impact_results
                 (id, definition_id, shift_id, value, recorded_at, recorded_by)
                 VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            )?;
            for record in &seed.impact_records {
                let definition_id =
                    format!("metric-{}-{}", record.opportunity_id, record.metric_key);
                definition_statement.execute(params![
                    definition_id,
                    record.opportunity_id,
                    record.metric_key,
                    record.name,
                    record.unit,
                    record.recorded_at,
                    seed.organization.id,
                ])?;
                result_statement.execute(params![
                    format!("impact-{}", record.id),
                    definition_id,
                    record.value,
                    record.recorded_at,
                    seed.coordinator.name,
                ])?;
            }
        }

        {
            let mut statement = transaction.prepare(
                "INSERT OR IGNORE INTO report_saved_views
                 (id, owner_id, scope, name, filters_json, created_at, organization_id)
                 VALUES (?1, ?2, 'records', ?3, ?4, ?5, ?6)",
            )?;
            for view in &seed.saved_views {
                statement.execute(params![
                    view.id,
                    seed.current_volunteer_id,
                    view.name,
                    serde_json::to_string(&view.filters)?,
                    seed.now,
                    seed.organization.id,
                ])?;
            }
        }

        {
            let mut statement = transaction.prepare(
                "INSERT INTO notifications
                 (id, kind, title, body, priority, created_at, read_at, href, audience,
                  organization_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )?;
            for notification in &seed.notifications {
                let audience = if notification.href.starts_with("/volunteer") {
                    "volunteer"
                } else {
                    "coordinator"
                };
                statement.execute(params![
                    notification.id,
                    notification.kind,
                    notification.title,
                    notification.body,
                    notification.priority,
                    notification.created_at,
                    notification.read_at,
                    notification.href,
                    audience,
                    seed.organization.id,
                ])?;
            }
        }

        {
            let mut statement = transaction.prepare(
                "INSERT INTO activity_events
                 (id, volunteer_id, name, action, detail, tone, at, organization_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for activity in &seed.recent_activity {
                statement.execute(params![
                    activity.id,
                    activity.volunteer_id,
                    activity.name,
                    activity.action,
                    activity.detail,
                    activity.tone,
                    activity.at,
                    seed.organization.id,
                ])?;
            }
        }

        transaction.execute(
            "INSERT INTO impact_totals
             (organization_id, hours_ytd, unique_volunteers_ytd, meals_packed,
              tutoring_sessions, trees_planted, families_served_month, shifts_completed,
              attendance_rate)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                seed.organization.id,
                seed.impact.hours_ytd,
                seed.impact.unique_volunteers_ytd,
                seed.impact.meals_packed,
                seed.impact.tutoring_sessions,
                seed.impact.trees_planted,
                seed.impact.families_served_this_month,
                seed.impact.shifts_completed,
                seed.impact.attendance_rate,
            ],
        )?;

        transaction.execute(
            "INSERT INTO audit_events
             (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary,
              organization_id)
             VALUES (?1, ?2, 'system', 'system', 'demo_seeded', 'workspace', ?3, ?4, ?3)",
            params![
                uuid::Uuid::new_v4().to_string(),
                Utc::now().to_rfc3339(),
                seed.organization.id,
                format!(
                    "Seeded demo workspace with {} volunteers",
                    seed.volunteers.len()
                ),
            ],
        )?;

        transaction.commit()?;
        Ok(())
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn connection_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    pub fn integrity_check(&self) -> Result<String> {
        let result: String = self
            .conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        Ok(result)
    }

    pub fn foreign_key_violations(&self) -> Result<i64> {
        let mut statement = self.conn.prepare("PRAGMA foreign_key_check")?;
        let mut rows = statement.query([])?;
        let mut count = 0;
        while rows.next()?.is_some() {
            count += 1;
        }
        Ok(count)
    }

    pub fn health(&self) -> Result<WorkspaceHealth> {
        let count = |table: &str| -> Result<i64> {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            Ok(self.conn.query_row(&sql, [], |row| row.get(0))?)
        };
        let timezone: String =
            self.conn
                .query_row("SELECT timezone FROM organizations LIMIT 1", [], |row| {
                    row.get(0)
                })?;
        Ok(WorkspaceHealth {
            schema_version: SCHEMA_VERSION,
            integrity: self.integrity_check()?,
            volunteer_count: count("volunteers")?,
            opportunity_count: count("opportunities")?,
            shift_count: count("shifts")?,
            now: crate::clock::now(&self.conn)?.to_rfc3339(),
            timezone,
        })
    }
}

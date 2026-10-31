//! The durable side of the desktop shared workspace.
//!
//! The server is the authority; this module never decides whether a command is
//! allowed. It stores exactly the rows the server chose to return, advances the
//! cursor only in the transaction that wrote them, and keeps queued commands
//! bound to the account that created them.

use std::collections::BTreeMap;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::error::{CoreError, Result};

use super::protocol::{Change, ChangeOperation, CommandEnvelope, CommandType};

const DEFAULT_ENTITY_LIMIT: i64 = 500;
const MAX_ENTITY_LIMIT: i64 = 2_000;

type WorkspaceRow = (
    String,
    String,
    String,
    i64,
    i64,
    i64,
    Option<String>,
    Option<String>,
);
type OutboxRow = (
    i64,
    String,
    String,
    String,
    String,
    Option<String>,
    String,
    String,
    i64,
    Option<String>,
    i64,
    Option<i64>,
    Option<String>,
);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub organization_id: Option<String>,
    pub configured: bool,
    pub user_id: Option<String>,
    pub mode: String,
    pub replica_id: Option<String>,
    pub membership_epoch: i64,
    pub cursor: i64,
    pub revision: i64,
    pub entities: i64,
    pub pending: i64,
    pub conflicts: i64,
    pub last_synced_at: Option<String>,
    pub last_error: Option<String>,
}

impl SyncStatus {
    fn empty(organization_id: Option<String>) -> Self {
        Self {
            organization_id,
            configured: false,
            user_id: None,
            mode: "local".into(),
            replica_id: None,
            membership_epoch: 0,
            cursor: 0,
            revision: 0,
            entities: 0,
            pending: 0,
            conflicts: 0,
            last_synced_at: None,
            last_error: None,
        }
    }
}

/// The response from `bootstrap_workspace`. `entities` is keyed by the same
/// entity names `pull_changes` uses, so one applier handles both.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    #[serde(default)]
    status: String,
    #[serde(default)]
    cursor: i64,
    #[serde(default)]
    revision: i64,
    #[serde(default)]
    entities: BTreeMap<String, Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub id: i64,
    pub operation_id: String,
    pub organization_id: String,
    pub user_id: String,
    pub command: CommandType,
    pub envelope: CommandEnvelope,
    pub created_at: String,
    pub state: String,
    pub attempts: i64,
    pub last_error: Option<String>,
    pub next_attempt_at: i64,
    pub sending_at: Option<i64>,
    pub result: Option<Value>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn validate_organization(organization_id: &str) -> Result<()> {
    if Uuid::parse_str(organization_id).is_err() {
        return Err(CoreError::Validation(
            "A shared organization is identified by a UUID.".into(),
        ));
    }
    Ok(())
}

fn validate_command(value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(CoreError::Validation(
            "A queued command needs its command name.".into(),
        ));
    }
    Ok(())
}

/// Ensures this device has a UUID replica id. Migration 12 used raw hex for
/// the local row; the server requires a UUID, so an unparseable value is
/// replaced rather than sent and refused.
fn ensure_replica_id(conn: &Connection) -> Result<String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT replica_id FROM replica_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(value) = existing {
        if Uuid::parse_str(&value).is_ok() {
            return Ok(value);
        }
    }
    let created = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO replica_meta (id, replica_id, device_label, created_at, last_seen_at)
         VALUES (1, ?1, '', ?2, ?2)
         ON CONFLICT(id) DO UPDATE SET replica_id = excluded.replica_id",
        params![created, now()],
    )?;
    Ok(created)
}

/// Points this device at one hosted organization. A different account sees a
/// different row set, so switching accounts clears the replica instead of
/// showing one person rows another person was allowed to read.
pub fn configure(
    conn: &Connection,
    organization_id: &str,
    user_id: &str,
    membership_epoch: i64,
) -> Result<SyncStatus> {
    validate_organization(organization_id)?;
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err(CoreError::Validation(
            "A shared workspace needs the account that signed in.".into(),
        ));
    }
    let replica_id = ensure_replica_id(conn)?;
    let transaction = conn.unchecked_transaction()?;
    let existing: Option<(String, i64, i64)> = transaction
        .query_row(
            "SELECT user_id, cursor, revision FROM shared_workspaces WHERE organization_id = ?1",
            params![organization_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;

    let (cursor, revision) = match existing {
        Some((existing_user, _, _)) if existing_user != user_id => {
            transaction.execute(
                "DELETE FROM replica_entities WHERE organization_id = ?1",
                params![organization_id],
            )?;
            transaction.execute(
                "DELETE FROM sync_entity_versions WHERE organization_id = ?1",
                params![organization_id],
            )?;
            (0, 0)
        }
        Some((_, cursor, revision)) => (cursor, revision),
        None => (0, 0),
    };

    transaction.execute(
        "INSERT INTO shared_workspaces
            (organization_id, user_id, mode, replica_id, membership_epoch, cursor, revision,
             created_at, updated_at)
         VALUES (?1, ?2, 'shared', ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(organization_id) DO UPDATE SET
            user_id = excluded.user_id,
            mode = 'shared',
            replica_id = excluded.replica_id,
            membership_epoch = excluded.membership_epoch,
            cursor = excluded.cursor,
            revision = excluded.revision,
            updated_at = excluded.updated_at",
        params![
            organization_id,
            user_id,
            replica_id,
            membership_epoch,
            cursor,
            revision,
            now()
        ],
    )?;
    transaction.execute(
        "UPDATE sync_state
         SET mode = 'synced', organization_id = ?1, cursor = ?2, revision = ?3,
             membership_epoch = ?4
         WHERE id = 1",
        params![
            organization_id,
            cursor.to_string(),
            revision,
            membership_epoch
        ],
    )?;
    transaction.commit()?;
    status(conn, organization_id)
}

/// Replaces the local replica with the server's current state. Bootstrap is
/// the recovery path as well as the first load: the cursor is advanced in the
/// same transaction that replaces every row, so an interrupted bootstrap
/// leaves the old, consistent replica in place.
pub fn apply_bootstrap(
    conn: &Connection,
    organization_id: &str,
    user_id: &str,
    membership_epoch: i64,
    payload: &Value,
) -> Result<SyncStatus> {
    validate_organization(organization_id)?;
    let bootstrap: Bootstrap = serde_json::from_value(payload.clone())
        .map_err(|error| CoreError::Data(format!("bootstrap response is invalid: {error}")))?;
    if bootstrap.status != "ok" {
        return Err(CoreError::rule(
            "FORBIDDEN",
            "This account can no longer read that organization.",
            None,
            Some("REFRESH_ACCESS".into()),
        ));
    }
    if bootstrap.cursor < 0 || bootstrap.revision < 0 {
        return Err(CoreError::Data(
            "bootstrap returned a negative cursor or revision".into(),
        ));
    }

    let replica_id = ensure_replica_id(conn)?;
    let transaction = conn.unchecked_transaction()?;
    transaction.execute(
        "DELETE FROM replica_entities WHERE organization_id = ?1",
        params![organization_id],
    )?;
    transaction.execute(
        "DELETE FROM sync_entity_versions WHERE organization_id = ?1",
        params![organization_id],
    )?;

    let mut stored = 0usize;
    for (entity_type, rows) in &bootstrap.entities {
        if entity_type.trim().is_empty() {
            return Err(CoreError::Data(
                "bootstrap returned an entity without a name".into(),
            ));
        }
        for row in rows {
            let entity_id = row
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| CoreError::Data("bootstrap row has no id".into()))?;
            if Uuid::parse_str(entity_id).is_err() {
                return Err(CoreError::Data(format!(
                    "bootstrap row {entity_type}/{entity_id} has no UUID id"
                )));
            }
            if entity_type == "organization" {
                if entity_id != organization_id {
                    return Err(CoreError::Data(
                        "bootstrap returned a different organization".into(),
                    ));
                }
            } else if let Some(row_organization) =
                row.get("organization_id").and_then(Value::as_str)
            {
                if row_organization != organization_id {
                    return Err(CoreError::Data(
                        "bootstrap returned a row from another organization".into(),
                    ));
                }
            }
            let row_version = row.get("row_version").and_then(Value::as_i64);
            transaction.execute(
                "INSERT INTO replica_entities
                    (organization_id, entity_type, entity_id, sequence, row_version, deleted,
                     payload, updated_at)
                 VALUES (?1, ?2, ?3, 0, ?4, 0, ?5, ?6)",
                params![
                    organization_id,
                    entity_type,
                    entity_id,
                    row_version,
                    serde_json::to_string(row)?,
                    now()
                ],
            )?;
            transaction.execute(
                "INSERT INTO sync_entity_versions
                    (organization_id, entity_type, entity_id, row_version, sequence)
                 VALUES (?1, ?2, ?3, ?4, 0)",
                params![organization_id, entity_type, entity_id, row_version],
            )?;
            stored += 1;
        }
    }

    let timestamp = now();
    transaction.execute(
        "INSERT INTO shared_workspaces
            (organization_id, user_id, mode, replica_id, membership_epoch, cursor, revision,
             last_successful_sync_at, created_at, updated_at)
         VALUES (?1, ?2, 'shared', ?3, ?4, ?5, ?6, ?7, ?7, ?7)
         ON CONFLICT(organization_id) DO UPDATE SET
            user_id = excluded.user_id,
            mode = 'shared',
            replica_id = excluded.replica_id,
            membership_epoch = excluded.membership_epoch,
            cursor = excluded.cursor,
            revision = excluded.revision,
            last_successful_sync_at = excluded.last_successful_sync_at,
            last_error = NULL,
            updated_at = excluded.updated_at",
        params![
            organization_id,
            user_id,
            replica_id,
            membership_epoch,
            bootstrap.cursor,
            bootstrap.revision,
            timestamp
        ],
    )?;
    transaction.execute(
        "UPDATE sync_state
         SET mode = 'synced', organization_id = ?1, cursor = ?2, revision = ?3,
             membership_epoch = ?4, last_synced_at = ?5, last_error = NULL
         WHERE id = 1",
        params![
            organization_id,
            bootstrap.cursor.to_string(),
            bootstrap.revision,
            membership_epoch,
            timestamp
        ],
    )?;
    transaction.commit()?;
    let mut current = status(conn, organization_id)?;
    current.entities = stored as i64;
    Ok(current)
}

/// Applies one pulled batch and advances the cursor atomically. A delete is a
/// tombstone, not a row removal: a delayed insert must not resurrect it.
pub fn apply_changes(
    conn: &Connection,
    organization_id: &str,
    changes: &[Change],
    cursor: i64,
    revision: i64,
) -> Result<SyncStatus> {
    validate_organization(organization_id)?;
    if cursor < 0 || revision < 0 {
        return Err(CoreError::Validation(
            "A sync cursor and revision cannot be negative.".into(),
        ));
    }
    let current: Option<(i64, i64)> = conn
        .query_row(
            "SELECT cursor, revision FROM shared_workspaces WHERE organization_id = ?1",
            params![organization_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (current_cursor, _) = current.ok_or_else(|| {
        CoreError::rule(
            "NOT_CONFIGURED",
            "This desktop is not set up for that shared organization.",
            None,
            Some("CONNECT_SHARED".into()),
        )
    })?;
    if cursor < current_cursor {
        return Err(CoreError::rule(
            "STALE_CURSOR",
            "The server returned an older cursor than this device already applied.",
            None,
            Some("REFRESH".into()),
        ));
    }
    // The cursor is the promise that every change up to it was applied. A
    // change beyond it would otherwise be skipped forever.
    if let Some(ahead) = changes.iter().find(|change| change.sequence > cursor) {
        return Err(CoreError::Data(format!(
            "change {} is beyond the cursor {cursor}",
            ahead.sequence
        )));
    }

    let transaction = conn.unchecked_transaction()?;
    let mut last_sequence = current_cursor;
    for change in changes {
        if change.sequence <= last_sequence {
            continue;
        }
        if change.entity.trim().is_empty() || Uuid::parse_str(&change.id).is_err() {
            return Err(CoreError::Data(
                "a pulled change has no entity name or UUID id".into(),
            ));
        }
        match change.operation {
            ChangeOperation::Delete => {
                transaction.execute(
                    "INSERT INTO replica_entities
                        (organization_id, entity_type, entity_id, sequence, row_version, deleted,
                         payload, updated_at)
                     VALUES (?1, ?2, ?3, ?4, NULL, 1, NULL, ?5)
                     ON CONFLICT(organization_id, entity_type, entity_id) DO UPDATE SET
                        sequence = excluded.sequence,
                        row_version = NULL,
                        deleted = 1,
                        payload = NULL,
                        updated_at = excluded.updated_at",
                    params![
                        organization_id,
                        change.entity,
                        change.id,
                        change.sequence,
                        now()
                    ],
                )?;
                transaction.execute(
                    "INSERT INTO sync_entity_versions
                        (organization_id, entity_type, entity_id, row_version, sequence)
                     VALUES (?1, ?2, ?3, NULL, ?4)
                     ON CONFLICT(organization_id, entity_type, entity_id) DO UPDATE SET
                        row_version = NULL,
                        sequence = excluded.sequence",
                    params![organization_id, change.entity, change.id, change.sequence],
                )?;
            }
            ChangeOperation::Insert | ChangeOperation::Update => {
                let payload = change.payload.as_ref().ok_or_else(|| {
                    CoreError::Data(format!(
                        "{} {} arrived without a payload",
                        change.entity, change.id
                    ))
                })?;
                if change.entity != "organization" {
                    if let Some(row_organization) =
                        payload.get("organization_id").and_then(Value::as_str)
                    {
                        if row_organization != organization_id {
                            return Err(CoreError::Data(
                                "a pulled change belongs to another organization".into(),
                            ));
                        }
                    }
                }
                let row_version = change
                    .row_version
                    .or_else(|| payload.get("row_version").and_then(Value::as_i64));
                transaction.execute(
                    "INSERT INTO replica_entities
                        (organization_id, entity_type, entity_id, sequence, row_version, deleted,
                         payload, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
                     ON CONFLICT(organization_id, entity_type, entity_id) DO UPDATE SET
                        sequence = excluded.sequence,
                        row_version = excluded.row_version,
                        deleted = 0,
                        payload = excluded.payload,
                        updated_at = excluded.updated_at",
                    params![
                        organization_id,
                        change.entity,
                        change.id,
                        change.sequence,
                        row_version,
                        serde_json::to_string(payload)?,
                        now()
                    ],
                )?;
                transaction.execute(
                    "INSERT INTO sync_entity_versions
                        (organization_id, entity_type, entity_id, row_version, sequence)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(organization_id, entity_type, entity_id) DO UPDATE SET
                        row_version = excluded.row_version,
                        sequence = excluded.sequence",
                    params![
                        organization_id,
                        change.entity,
                        change.id,
                        row_version,
                        change.sequence
                    ],
                )?;
            }
        }
        last_sequence = change.sequence;
    }

    let timestamp = now();
    transaction.execute(
        "UPDATE shared_workspaces
         SET cursor = ?2, revision = ?3, last_successful_sync_at = ?4,
             last_error = NULL, updated_at = ?4
         WHERE organization_id = ?1",
        params![organization_id, cursor, revision, timestamp],
    )?;
    transaction.execute(
        "UPDATE sync_state
         SET mode = 'synced', organization_id = ?1, cursor = ?2, revision = ?3,
             last_synced_at = ?4, last_error = NULL
         WHERE id = 1",
        params![organization_id, cursor.to_string(), revision, timestamp],
    )?;
    transaction.commit()?;
    status(conn, organization_id)
}

/// Every organization this device has a replica for, newest first. The native
/// screen uses this when the network is down and `my_workspaces` cannot answer.
pub fn list_workspaces(conn: &Connection) -> Result<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT organization_id FROM shared_workspaces
         ORDER BY updated_at DESC, organization_id",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row?);
    }
    Ok(values)
}

pub fn status(conn: &Connection, organization_id: &str) -> Result<SyncStatus> {
    validate_organization(organization_id)?;
    let row: Option<WorkspaceRow> = conn
        .query_row(
            "SELECT user_id, mode, replica_id, membership_epoch, cursor, revision,
                    last_successful_sync_at, last_error
             FROM shared_workspaces WHERE organization_id = ?1",
            params![organization_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()?;

    let Some((
        user_id,
        mode,
        replica_id,
        membership_epoch,
        cursor,
        revision,
        last_synced_at,
        last_error,
    )) = row
    else {
        return Ok(SyncStatus::empty(Some(organization_id.to_string())));
    };

    let entities: i64 = conn.query_row(
        "SELECT count(*) FROM replica_entities
         WHERE organization_id = ?1 AND deleted = 0",
        params![organization_id],
        |row| row.get(0),
    )?;
    let pending: i64 = conn.query_row(
        "SELECT count(*) FROM sync_outbox
         WHERE organization_id = ?1 AND user_id = ?2 AND state IN ('pending', 'sending')",
        params![organization_id, user_id],
        |row| row.get(0),
    )?;
    let conflicts: i64 = conn.query_row(
        "SELECT count(*) FROM sync_conflicts
         WHERE organization_id = ?1 AND status = 'open'",
        params![organization_id],
        |row| row.get(0),
    )?;

    Ok(SyncStatus {
        organization_id: Some(organization_id.to_string()),
        configured: true,
        user_id: Some(user_id),
        mode,
        replica_id: Some(replica_id),
        membership_epoch,
        cursor,
        revision,
        entities,
        pending,
        conflicts,
        last_synced_at,
        last_error,
    })
}

/// Reads one entity type for a screen. The payload is the server's row, not a
/// local projection, so a schema addition does not require a migration here.
pub fn read_entities(
    conn: &Connection,
    organization_id: &str,
    entity_type: &str,
    limit: Option<i64>,
) -> Result<Vec<Value>> {
    validate_organization(organization_id)?;
    let limit = limit
        .unwrap_or(DEFAULT_ENTITY_LIMIT)
        .clamp(1, MAX_ENTITY_LIMIT);
    let mut statement = conn.prepare(
        "SELECT payload FROM replica_entities
         WHERE organization_id = ?1 AND entity_type = ?2 AND deleted = 0
         ORDER BY entity_id
         LIMIT ?3",
    )?;
    let rows = statement.query_map(params![organization_id, entity_type, limit], |row| {
        row.get::<_, Option<String>>(0)
    })?;
    let mut values = Vec::new();
    for row in rows {
        if let Some(text) = row? {
            values
                .push(serde_json::from_str(&text).map_err(|error| {
                    CoreError::Data(format!("replica row is invalid: {error}"))
                })?);
        }
    }
    Ok(values)
}

pub fn read_cursor(conn: &Connection, organization_id: &str) -> Result<i64> {
    let cursor: Option<i64> = conn
        .query_row(
            "SELECT cursor FROM shared_workspaces WHERE organization_id = ?1",
            params![organization_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(cursor.unwrap_or(0))
}

pub fn read_revision(conn: &Connection, organization_id: &str) -> Result<i64> {
    let revision: Option<i64> = conn
        .query_row(
            "SELECT revision FROM shared_workspaces WHERE organization_id = ?1",
            params![organization_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(revision.unwrap_or(0))
}

pub fn write_revision(
    conn: &Connection,
    organization_id: &str,
    revision: i64,
) -> Result<SyncStatus> {
    if revision < 0 {
        return Err(CoreError::Validation(
            "A workspace revision cannot be negative.".into(),
        ));
    }
    let timestamp = now();
    let changed = conn.execute(
        "UPDATE shared_workspaces
         SET revision = ?2, last_successful_sync_at = ?3, last_error = NULL, updated_at = ?3
         WHERE organization_id = ?1",
        params![organization_id, revision, timestamp],
    )?;
    if changed == 0 {
        return Err(CoreError::rule(
            "NOT_CONFIGURED",
            "This desktop is not set up for that shared organization.",
            None,
            Some("CONNECT_SHARED".into()),
        ));
    }
    conn.execute(
        "UPDATE sync_state
         SET revision = ?2, last_synced_at = ?3, last_error = NULL
         WHERE id = 1",
        params![revision, timestamp],
    )?;
    status(conn, organization_id)
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

pub fn recover_stale_sending(conn: &Connection, cutoff: i64, now_ms: i64) -> Result<usize> {
    let changed = conn.execute(
        "UPDATE sync_outbox
         SET state = 'pending', sending_at = NULL, next_attempt_at = ?2,
             last_error = 'Recovered an interrupted upload. It will be retried.',
             updated_at = ?3
         WHERE state = 'sending' AND sending_at IS NOT NULL AND sending_at < ?1",
        params![cutoff, now_ms, now()],
    )?;
    Ok(changed)
}

pub fn next_ready(
    conn: &Connection,
    user_id: &str,
    organization_id: &str,
    now_ms: i64,
) -> Result<Option<OutboxItem>> {
    let row: Option<OutboxRow> = conn
        .query_row(
            "SELECT id, operation_id, organization_id, user_id, command, envelope, created_at,
                    state, attempts, last_error, next_attempt_at, sending_at, result
             FROM sync_outbox
             WHERE user_id = ?1 AND organization_id = ?2 AND state = 'pending'
               AND next_attempt_at <= ?3
             ORDER BY coalesce(sequence_number, 0), id
             LIMIT 1",
            params![user_id, organization_id, now_ms],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        operation_id,
        organization_id,
        user_id,
        command,
        envelope,
        created_at,
        state,
        attempts,
        last_error,
        next_attempt_at,
        sending_at,
        result,
    )) = row
    else {
        return Ok(None);
    };
    validate_command(&command)?;
    let envelope_text = envelope.ok_or_else(|| {
        CoreError::rule(
            "UNREADABLE_OUTBOX",
            "A queued change has no command envelope and cannot be uploaded.",
            None,
            Some("DISCARD_QUEUE".into()),
        )
    })?;
    let envelope: CommandEnvelope = serde_json::from_str(&envelope_text)
        .map_err(|error| CoreError::Data(format!("queued envelope is invalid: {error}")))?;
    let command: CommandType = serde_json::from_value(Value::String(command.clone()))
        .map_err(|_| CoreError::Data("queued command name is unknown".into()))?;
    let result = match result {
        Some(text) => Some(
            serde_json::from_str(&text)
                .map_err(|error| CoreError::Data(format!("queued result is invalid: {error}")))?,
        ),
        None => None,
    };
    Ok(Some(OutboxItem {
        id,
        operation_id,
        organization_id,
        user_id,
        command,
        envelope,
        created_at,
        state,
        attempts,
        last_error,
        next_attempt_at,
        sending_at,
        result,
    }))
}

pub fn mark_sending(conn: &Connection, id: i64, now_ms: i64) -> Result<()> {
    conn.execute(
        "UPDATE sync_outbox SET state = 'sending', sending_at = ?2, updated_at = ?3
         WHERE id = ?1",
        params![id, now_ms, now()],
    )?;
    Ok(())
}

pub fn mark_sent(conn: &Connection, id: i64, result: &Value) -> Result<()> {
    conn.execute(
        "UPDATE sync_outbox
         SET state = 'sent', result = ?2, last_error = NULL, sending_at = NULL, updated_at = ?3
         WHERE id = ?1",
        params![id, serde_json::to_string(result)?, now()],
    )?;
    Ok(())
}

pub fn mark_retry(conn: &Connection, id: i64, error: &str, next_attempt_at: i64) -> Result<()> {
    conn.execute(
        "UPDATE sync_outbox
         SET state = 'pending', attempts = attempts + 1, last_error = ?2,
             next_attempt_at = ?3, sending_at = NULL, updated_at = ?4
         WHERE id = ?1",
        params![id, error, next_attempt_at, now()],
    )?;
    Ok(())
}

pub fn mark_refused(conn: &Connection, id: i64, result: &Value, conflict: &Value) -> Result<()> {
    let conflict_id = conflict
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let organization_id = conflict
        .get("organizationId")
        .and_then(Value::as_str)
        .ok_or_else(|| CoreError::Data("conflict has no organization".into()))?;
    let operation_id = conflict
        .get("operationId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let command = conflict
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let entity = conflict
        .get("entity")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let code = conflict
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("conflict");
    let message = conflict
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("The server refused this change.");
    let classification = conflict
        .get("classification")
        .and_then(Value::as_str)
        .unwrap_or("invariant");
    let created_at = conflict
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(now);
    let local = conflict.get("localPayload").cloned().unwrap_or(Value::Null);
    let authoritative = conflict
        .get("authoritative")
        .cloned()
        .unwrap_or(Value::Null);
    let replica_id: Option<String> = conn
        .query_row(
            "SELECT replica_id FROM shared_workspaces WHERE organization_id = ?1",
            params![organization_id],
            |row| row.get(0),
        )
        .optional()?;

    let transaction = conn.unchecked_transaction()?;
    transaction.execute(
        "UPDATE sync_outbox
         SET state = 'conflict', result = ?2, last_error = ?3, sending_at = NULL, updated_at = ?4
         WHERE id = ?1",
        params![id, serde_json::to_string(result)?, message, now()],
    )?;
    transaction.execute(
        "INSERT INTO sync_conflicts
            (id, organization_id, replica_id, transaction_id, entity_type, entity_id, code,
             summary, local_payload, authoritative_payload, status, created_at, resolved_at,
             operation_id, command, classification)
         VALUES (?1, ?2, ?3, NULL, 'command', ?4, ?5, ?6, ?7, ?8, 'open', ?9, NULL, ?10, ?11, ?12)
         ON CONFLICT(id) DO NOTHING",
        params![
            conflict_id,
            organization_id,
            replica_id,
            if entity.is_empty() {
                operation_id
            } else {
                entity
            },
            code,
            message,
            serde_json::to_string(&local)?,
            serde_json::to_string(&authoritative)?,
            created_at,
            operation_id,
            command,
            classification
        ],
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn pending_count(conn: &Connection, user_id: &str, organization_id: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM sync_outbox
         WHERE user_id = ?1 AND organization_id = ?2 AND state IN ('pending', 'sending')",
        params![user_id, organization_id],
        |row| row.get(0),
    )?)
}

pub fn open_conflict_count(conn: &Connection, organization_id: &str) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT count(*) FROM sync_conflicts
         WHERE organization_id = ?1 AND status = 'open'",
        params![organization_id],
        |row| row.get(0),
    )?)
}

/// Everything a conflict screen needs, including the values both sides held.
/// The payloads are parsed before they leave Rust so the screen never has to
/// guess whether a column is text or JSON.
pub fn list_conflicts(conn: &Connection, organization_id: &str) -> Result<Vec<Value>> {
    validate_organization(organization_id)?;
    let mut statement = conn.prepare(
        "SELECT id, operation_id, command, entity_type, entity_id, code, summary,
                local_payload, authoritative_payload, classification, status,
                created_at, resolved_at
         FROM sync_conflicts
         WHERE organization_id = ?1
         ORDER BY status = 'open' DESC, created_at DESC",
    )?;
    let rows = statement.query_map(params![organization_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, String>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, Option<String>>(12)?,
        ))
    })?;
    let mut values = Vec::new();
    for row in rows {
        let (
            id,
            operation_id,
            command,
            entity_type,
            entity_id,
            code,
            summary,
            local,
            authoritative,
            classification,
            status,
            created_at,
            resolved_at,
        ) = row?;
        let local = local
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .unwrap_or(Value::Null);
        let authoritative = authoritative
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .unwrap_or(Value::Null);
        values.push(serde_json::json!({
            "id": id,
            "operationId": operation_id,
            "command": command,
            "entityType": entity_type,
            "entityId": entity_id,
            "code": code,
            "message": summary,
            "localPayload": local,
            "authoritative": authoritative,
            "classification": classification.unwrap_or_else(|| "invariant".into()),
            "status": status,
            "createdAt": created_at,
            "resolvedAt": resolved_at,
        }));
    }
    Ok(values)
}

/// Closing a conflict is a local acknowledgement. It never edits the server
/// row; if the server state needs to move, the screen rebuilds from bootstrap.
pub fn resolve_conflict(
    conn: &Connection,
    organization_id: &str,
    conflict_id: &str,
    resolution: &str,
) -> Result<()> {
    validate_organization(organization_id)?;
    if resolution != "resolved" && resolution != "dismissed" {
        return Err(CoreError::Validation(
            "A conflict can be resolved or dismissed, not deleted.".into(),
        ));
    }
    let changed = conn.execute(
        "UPDATE sync_conflicts
         SET status = ?3, resolved_at = ?4
         WHERE organization_id = ?1 AND id = ?2 AND status = 'open'",
        params![organization_id, conflict_id, resolution, now()],
    )?;
    if changed == 0 {
        return Err(CoreError::rule(
            "NOT_FOUND",
            "That conflict is not open on this desktop.",
            None,
            Some("REFRESH".into()),
        ));
    }
    Ok(())
}

/// Builds the envelope for this device and account, then writes it to the
/// outbox. The caller supplies only what the user intended: the command, its
/// payload and the row versions it was built against. Identity, replica id and
/// authority are read from the configured workspace, never from the screen.
pub fn enqueue_command(
    conn: &Connection,
    organization_id: &str,
    command: CommandType,
    payload: &Value,
    entity_versions: &BTreeMap<String, i64>,
    base_revision: Option<i64>,
) -> Result<i64> {
    validate_organization(organization_id)?;
    if !payload.is_object() {
        return Err(CoreError::Validation(
            "A command payload has to be an object.".into(),
        ));
    }
    let configured: Option<(String, String, i64, i64)> = conn
        .query_row(
            "SELECT user_id, replica_id, membership_epoch, revision
             FROM shared_workspaces WHERE organization_id = ?1 AND mode = 'shared'",
            params![organization_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((user_id, replica_id, membership_epoch, revision)) = configured else {
        return Err(CoreError::rule(
            "NOT_CONFIGURED",
            "Connect a shared workspace before changing the organization.",
            None,
            Some("CONNECT_SHARED".into()),
        ));
    };
    let base_revision = base_revision.unwrap_or(revision);
    if base_revision < 0 {
        return Err(CoreError::Validation(
            "A workspace revision cannot be negative.".into(),
        ));
    }
    let mut payload = payload.clone();
    if let Some(object) = payload.as_object_mut() {
        object.insert("membershipEpoch".into(), Value::from(membership_epoch));
    }
    let envelope = CommandEnvelope {
        operation_id: Uuid::new_v4().to_string(),
        replica_id,
        user_id: user_id.clone(),
        organization_id: organization_id.to_string(),
        command,
        membership_epoch,
        base_workspace_revision: base_revision,
        entity_versions: entity_versions.clone(),
        payload,
        client_created_at: now(),
    };
    let sequence: i64 = conn.query_row(
        "SELECT coalesce(max(sequence_number), 0) + 1 FROM sync_outbox
         WHERE organization_id = ?1",
        params![organization_id],
        |row| row.get(0),
    )?;
    enqueue(conn, &user_id, organization_id, sequence, &envelope)
}

/// One queue row per intent. Kept public because the outbox format has one
/// owner and one test.
pub fn enqueue(
    conn: &Connection,
    user_id: &str,
    organization_id: &str,
    sequence_number: i64,
    envelope: &CommandEnvelope,
) -> Result<i64> {
    if envelope.user_id != user_id || envelope.organization_id != organization_id {
        return Err(CoreError::Validation(
            "A queued command must belong to the account and organization that queue it.".into(),
        ));
    }
    if !envelope.is_bindable() {
        return Err(CoreError::Validation(
            "A queued command is missing its operation, account, replica, or membership epoch."
                .into(),
        ));
    }
    let created_at = now();
    conn.execute(
        "INSERT INTO sync_outbox
            (operation_id, entity_table, entity_id, operation, payload, membership_epoch,
             created_at, state, attempts, last_error, organization_id, user_id, command, envelope,
             sequence_number, base_revision, next_attempt_at, updated_at)
         VALUES (?1, 'command', ?2, 'insert', ?3, ?4, ?5, 'pending', 0, NULL, ?6, ?7, ?8, ?9,
                 ?10, ?11, 0, ?5)",
        params![
            envelope.operation_id,
            envelope.operation_id,
            serde_json::to_string(&envelope.payload)?,
            envelope.membership_epoch,
            created_at,
            organization_id,
            user_id,
            envelope.command.as_str(),
            serde_json::to_string(envelope)?,
            sequence_number,
            envelope.base_workspace_revision
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

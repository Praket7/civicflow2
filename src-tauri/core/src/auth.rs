//! Local account authentication.
//!
//! The workspace is offline and single-device, but it still separates the
//! coordinator from the volunteer. Passwords are stored as Argon2id hashes and
//! sessions are opaque tokens whose SHA-256 hash is kept in SQLite. Tokens are
//! never written to disk in plain text.

use argon2::password_hash::{
    rand_core::{OsRng, RngCore},
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

use crate::error::{CoreError, Result};

/// Only the demo seed uses these; they never authorize a real organization.
pub const DEMO_EMAIL: &str = "praket@rivergate.example";
pub const DEMO_PASSWORD: &str = "civicflow-demo";
const REMEMBER_DAYS: i64 = 30;
const SHORT_SESSION_HOURS: i64 = 12;
/// Misses this many times in the window before the wait starts.
const FREE_ATTEMPTS: i64 = 5;
/// The first wait, doubled for each further miss, capped at `MAX_LOCK_SECONDS`.
const LOCK_STEP_SECONDS: i64 = 30;
const MAX_LOCK_SECONDS: i64 = 300;
const ATTEMPT_WINDOW_MINUTES: i64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: String,
    pub volunteer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub token: String,
    pub user: Account,
    pub expires_at: String,
}

fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| CoreError::Data(format!("password hashing failed: {error}")))
}

fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub(crate) fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

/// 256 bits from the OS generator. Only the hash of a value like this is stored,
/// so a copy of the database cannot be replayed as a session or an invitation.
pub(crate) fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A real Argon2 hash the sign-in path verifies against when the email is
/// unknown, so a miss costs the same time as a wrong password.
fn timing_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| {
        let salt = SaltString::encode_b64(b"civicflow-timing-1").expect("static salt encodes");
        Argon2::default()
            .hash_password(b"civicflow-timing-equalizer", &salt)
            .map(|hash| hash.to_string())
            .unwrap_or_default()
    })
}

fn lockout_error(seconds: i64) -> CoreError {
    let wait = if seconds >= 60 {
        let minutes = seconds / 60;
        if minutes <= 1 {
            "a minute".to_string()
        } else {
            format!("{minutes} minutes")
        }
    } else {
        format!("{seconds} seconds")
    };
    CoreError::rule(
        "TOO_MANY_ATTEMPTS",
        format!("Too many attempts. Try again in {wait}."),
        Some("password".into()),
        Some("TRY_AGAIN_LATER".into()),
    )
}

/// Seconds left on an active wait, if the email is currently throttled.
fn active_lock(conn: &Connection, email: &str) -> Result<Option<i64>> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT locked_until FROM auth_attempts WHERE email = ?1",
            params![email],
            |row| row.get(0),
        )
        .optional()?;
    let Some(Some(locked_until)) = row else {
        return Ok(None);
    };
    let Ok(until) = chrono::DateTime::parse_from_rfc3339(&locked_until) else {
        return Ok(None);
    };
    let now = Utc::now();
    let seconds = (until.with_timezone(&Utc) - now).num_seconds();
    Ok((seconds > 0).then_some(seconds))
}

/// Records a miss and returns the wait it started, or zero when one is not due.
fn record_failure(conn: &Connection, email: &str) -> Result<i64> {
    let now = Utc::now();
    let existing: Option<(i64, String)> = conn
        .query_row(
            "SELECT failed_count, first_failed_at FROM auth_attempts WHERE email = ?1",
            params![email],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let started = existing.as_ref().and_then(|(_, at)| {
        chrono::DateTime::parse_from_rfc3339(at)
            .ok()
            .map(|value| value.with_timezone(&Utc))
    });
    let in_window = started
        .map(|at| now - at < Duration::minutes(ATTEMPT_WINDOW_MINUTES))
        .unwrap_or(false);
    let attempts = if in_window {
        existing.as_ref().map(|(count, _)| *count).unwrap_or(0) + 1
    } else {
        1
    };
    let first_failed_at = if in_window {
        existing
            .map(|(_, at)| at)
            .unwrap_or_else(|| now.to_rfc3339())
    } else {
        now.to_rfc3339()
    };
    let wait = if attempts > FREE_ATTEMPTS {
        let steps = (attempts - FREE_ATTEMPTS - 1).min(4) as u32;
        (LOCK_STEP_SECONDS * 2_i64.pow(steps)).min(MAX_LOCK_SECONDS)
    } else {
        0
    };
    let locked_until = (wait > 0).then(|| (now + Duration::seconds(wait)).to_rfc3339());
    conn.execute(
        "INSERT INTO auth_attempts (email, failed_count, first_failed_at, locked_until)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(email) DO UPDATE SET
            failed_count = excluded.failed_count,
            first_failed_at = excluded.first_failed_at,
            locked_until = excluded.locked_until",
        params![email, attempts, first_failed_at, locked_until],
    )?;
    Ok(wait)
}

fn clear_failures(conn: &Connection, email: &str) -> Result<()> {
    conn.execute("DELETE FROM auth_attempts WHERE email = ?1", params![email])?;
    Ok(())
}

/// The shared answer for a credential that did not match, after the miss has
/// been counted. A miss that starts a wait says so instead.
fn credential_error(wait: i64) -> CoreError {
    if wait > 0 {
        return lockout_error(wait);
    }
    CoreError::rule(
        "INVALID_CREDENTIALS",
        "That email and password do not match an account on this device.",
        Some("password".into()),
        None,
    )
}

fn validate_password(password: &str) -> Result<()> {
    if password.chars().count() < 8 {
        return Err(CoreError::rule(
            "PASSWORD_TOO_SHORT",
            "Use at least 8 characters for the password.",
            Some("password".into()),
            None,
        ));
    }
    if password.chars().count() > 200 {
        return Err(CoreError::Validation(
            "Passwords must be 200 characters or fewer.".into(),
        ));
    }
    Ok(())
}

/// The role comes from the active membership in the **selected** organization,
/// never from a global column or the strongest membership anywhere. A stale
/// selection falls back to the strongest remaining one. Owners and coordinators
/// share coordinator capabilities; only an owner may change the membership.
const ROLE_SQL: &str = "COALESCE((
    SELECT CASE WHEN m.role IN ('owner', 'coordinator') THEN 'coordinator' ELSE 'volunteer' END
    FROM organization_memberships m
    WHERE m.user_id = u.id AND m.status = 'active'
      AND m.organization_id = COALESCE(
          (SELECT a.value FROM app_settings a
           WHERE a.key = 'active_organization:' || u.id
             AND EXISTS (SELECT 1 FROM organization_memberships x
                         WHERE x.user_id = u.id AND x.status = 'active'
                           AND x.organization_id = a.value)),
          (SELECT m2.organization_id FROM organization_memberships m2
           WHERE m2.user_id = u.id AND m2.status = 'active'
           ORDER BY CASE m2.role WHEN 'owner' THEN 0 WHEN 'coordinator' THEN 1 ELSE 2 END,
                    m2.joined_at, m2.organization_id
           LIMIT 1))
    LIMIT 1), 'none')";

/// Mirrors [`ROLE_SQL`], so the role and the data scope cannot disagree.
pub fn active_organization(conn: &Connection, user_id: &str) -> Result<Option<String>> {
    let selected: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![format!("active_organization:{user_id}")],
            |row| row.get(0),
        )
        .optional()?;
    let mut statement = conn.prepare(
        "SELECT organization_id FROM organization_memberships
         WHERE user_id = ?1 AND status = 'active'
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'coordinator' THEN 1 ELSE 2 END,
                  joined_at, organization_id",
    )?;
    let memberships: Vec<String> = statement
        .query_map(params![user_id], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    if let Some(selected) = selected {
        if memberships.iter().any(|id| id == &selected) {
            return Ok(Some(selected));
        }
    }
    Ok(memberships.into_iter().next())
}

/// A membership column, not a user column; `users.volunteer_id` is the legacy
/// fallback.
pub fn active_volunteer(
    conn: &Connection,
    user_id: &str,
    organization_id: &str,
) -> Result<Option<String>> {
    let membership: Option<Option<String>> = conn
        .query_row(
            "SELECT volunteer_id FROM organization_memberships
             WHERE organization_id = ?1 AND user_id = ?2 AND status = 'active'",
            params![organization_id, user_id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(Some(volunteer_id)) = membership {
        return Ok(Some(volunteer_id));
    }
    // The upgraded column is only trusted when the profile belongs to this
    // organization; otherwise it names a roster record somewhere else and
    // reading it here would put another team's volunteer behind this account.
    let legacy: Option<Option<String>> = conn
        .query_row(
            "SELECT volunteer_id FROM users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(Some(volunteer_id)) = legacy else {
        return Ok(None);
    };
    let belongs_here: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM volunteers WHERE id = ?1 AND organization_id = ?2",
            params![volunteer_id, organization_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(belongs_here.map(|_| volunteer_id))
}

/// Rewrites the session's volunteer id from the working organization, so a
/// coordinator in one roster and a volunteer in another sees the right profile.
fn with_active_profile(conn: &Connection, mut account: Account) -> Result<Account> {
    if let Some(organization) = active_organization(conn, &account.id)? {
        if let Some(volunteer_id) = active_volunteer(conn, &account.id, &organization)? {
            // The read models behind the screens resolve the signed-in volunteer
            // from this setting. Record it for the organization it belongs to so
            // a profile from one roster can never stand in for another.
            conn.execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
                params![format!("current_volunteer_id@{organization}"), volunteer_id],
            )?;
            account.volunteer_id = Some(volunteer_id);
        }
    }
    Ok(account)
}

type SignInRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    String,
);

pub fn sign_in(
    conn: &Connection,
    email: &str,
    password: &str,
    remember: bool,
) -> Result<AuthSession> {
    let clean_email = email.trim().to_lowercase();
    if let Some(seconds) = active_lock(conn, &clean_email)? {
        return Err(lockout_error(seconds));
    }
    let row: Option<SignInRow> = conn
        .query_row(
            &format!(
                "SELECT u.id, u.name, u.email, {ROLE_SQL}, u.volunteer_id,
                        u.password_hash, u.status
                 FROM users u WHERE lower(u.email) = ?1"
            ),
            params![clean_email],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()?;

    let Some((id, name, stored_email, role, volunteer_id, password_hash, status)) = row else {
        // Spend the same time an existing account would, then count the miss.
        let _ = verify_password(timing_hash(), password);
        return Err(credential_error(record_failure(conn, &clean_email)?));
    };

    if status != "active" {
        return Err(CoreError::rule(
            "ACCOUNT_DISABLED",
            "This account has been disabled by the coordinator.",
            Some("email".into()),
            Some("CONTACT_COORDINATOR".into()),
        ));
    }

    let Some(password_hash) = password_hash else {
        return Err(CoreError::rule(
            "PASSWORD_NOT_SET",
            "This account has not been activated yet. Ask the coordinator to reset its password.",
            Some("email".into()),
            Some("CONTACT_COORDINATOR".into()),
        ));
    };

    if !verify_password(&password_hash, password) {
        return Err(credential_error(record_failure(conn, &clean_email)?));
    }

    clear_failures(conn, &clean_email)?;
    start_session(
        conn,
        &Account {
            id,
            name,
            email: stored_email,
            role,
            volunteer_id,
        },
        remember,
    )
}

/// Starts a session and records the audit entry shared by every sign-in path.
fn start_session(conn: &Connection, account: &Account, remember: bool) -> Result<AuthSession> {
    // The workspace every following command reads and writes is the one this
    // account selected, not whichever organization happened to be oldest.
    let organization = active_organization(conn, &account.id)?;
    crate::scope::select(conn, organization.as_deref())?;
    let account = with_active_profile(conn, account.clone())?;
    let now = Utc::now();
    let lifetime = if remember {
        Duration::days(REMEMBER_DAYS)
    } else {
        Duration::hours(SHORT_SESSION_HOURS)
    };
    let expires_at = (now + lifetime).to_rfc3339();
    let token = random_token();
    conn.execute(
        "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            uuid::Uuid::new_v4().to_string(),
            account.id,
            token_hash(&token),
            now.to_rfc3339(),
            expires_at,
        ],
    )?;
    conn.execute(
        "UPDATE users SET last_login_at = ?1 WHERE id = ?2",
        params![now.to_rfc3339(), account.id],
    )?;
    conn.execute(
        "INSERT INTO audit_events
         (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary,
          organization_id)
         VALUES (?1, ?2, ?3, ?4, 'auth.sign_in', 'user', ?4, ?5, ?6)",
        params![
            uuid::Uuid::new_v4().to_string(),
            now.to_rfc3339(),
            account.role,
            account.id,
            format!("Signed in {}", account.email),
            organization,
        ],
    )?;

    Ok(AuthSession {
        token,
        user: account.clone(),
        expires_at,
    })
}

/// Claims a roster profile with the same email, or creates one for a new
/// volunteer account. A profile that already has an account is refused.
pub(crate) fn link_or_create_volunteer(
    conn: &Connection,
    organization_id: &str,
    name: &str,
    email: &str,
    now: &str,
) -> Result<String> {
    // A roster profile belongs to one organization. The same email may already
    // exist in another organization's roster, which is a different person
    // record and must not be claimed here.
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM volunteers WHERE lower(email) = ?1 AND organization_id = ?2",
            params![email, organization_id],
            |row| row.get(0),
        )
        .optional()?;
    match existing {
        Some(volunteer_id) => {
            let linked: Option<String> = conn
                .query_row(
                    "SELECT id FROM users WHERE volunteer_id = ?1
                     UNION ALL
                     SELECT user_id FROM organization_memberships WHERE volunteer_id = ?1
                     LIMIT 1",
                    params![volunteer_id],
                    |row| row.get(0),
                )
                .optional()?;
            if linked.is_some() {
                return Err(CoreError::rule(
                    "ACCOUNT_EXISTS",
                    "That volunteer profile already has an account. Ask a coordinator to reset its password.",
                    Some("email".into()),
                    Some("CONTACT_COORDINATOR".into()),
                ));
            }
            Ok(volunteer_id)
        }
        None => insert_volunteer(conn, organization_id, name, email, now),
    }
}

/// Creates or resumes the local workspace account behind a hosted identity.
///
/// The hosted provider has already verified the address, so no local password
/// is stored: `password_hash` stays NULL and the local password form keeps
/// refusing the account until a coordinator sets one from Settings → Accounts.
/// That keeps hosted accounts usable offline without inventing a second secret.
/// Creates or resumes the local identity behind a hosted account. Hosted
/// identity proves only who somebody is; organization access comes from a
/// membership row, never from signup metadata.
pub fn sign_in_with_hosted(conn: &Connection, name: &str, email: &str) -> Result<AuthSession> {
    let email = normalize_email(email)?;
    let existing: Option<Account> = conn
        .query_row(
            &format!(
                "SELECT u.id, u.name, u.email, {ROLE_SQL}, u.volunteer_id
                 FROM users u WHERE lower(u.email) = ?1"
            ),
            params![email],
            |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    role: row.get(3)?,
                    volunteer_id: row.get(4)?,
                })
            },
        )
        .optional()?;
    if let Some(account) = existing {
        return start_session(conn, &account, true);
    }

    let name = normalize_name(name)?;
    let now = Utc::now().to_rfc3339();
    let id = format!("user-{}", uuid::Uuid::new_v4());

    conn.execute(
        // See the note in `create_account`: the legacy column stays inside its
        // CHECK, and the membership table is what grants a workspace role.
        "INSERT INTO users (id, name, email, role, volunteer_id, password_hash, status, created_at)
         VALUES (?1, ?2, ?3, 'volunteer', NULL, NULL, 'active', ?4)",
        params![id, name, email, now],
    )?;
    conn.execute(
        "INSERT INTO audit_events
         (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary)
         VALUES (?1, ?2, 'member', ?3, 'auth.hosted_account_created', 'user', ?3, ?4)",
        params![
            uuid::Uuid::new_v4().to_string(),
            now,
            id,
            format!("Created a hosted identity for {email}"),
        ],
    )?;

    start_session(
        conn,
        &Account {
            id,
            name,
            email,
            role: "none".into(),
            volunteer_id: None,
        },
        true,
    )
}

pub fn current_user(conn: &Connection, token: &str) -> Result<Option<Account>> {
    if token.trim().is_empty() {
        crate::scope::select(conn, None)?;
        return Ok(None);
    }
    let now = Utc::now().to_rfc3339();
    let account = conn
        .query_row(
            &format!(
                "SELECT u.id, u.name, u.email, {ROLE_SQL}, u.volunteer_id
                 FROM auth_sessions s
                 JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?1
                   AND s.revoked_at IS NULL
                   AND s.expires_at > ?2
                   AND u.status = 'active'"
            ),
            params![token_hash(token), now],
            |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    role: row.get(3)?,
                    volunteer_id: row.get(4)?,
                })
            },
        )
        .optional()?;
    // Every authenticated command passes through here, so this is the one place
    // the connection learns which organization the caller is working in.
    let account = match account {
        Some(account) => Some(with_active_profile(conn, account)?),
        None => None,
    };
    match &account {
        Some(account) => {
            let organization = active_organization(conn, &account.id)?;
            match organization {
                Some(id) => crate::scope::select(conn, Some(&id))?,
                // A signed-in identity with no membership reads no workspace at
                // all instead of falling back to the installation's own one.
                None => crate::scope::select_none(conn)?,
            }
        }
        None => crate::scope::select(conn, None)?,
    }
    Ok(account)
}

pub fn require_user(conn: &Connection, token: &str) -> Result<Account> {
    current_user(conn, token)?.ok_or_else(|| {
        CoreError::rule(
            "AUTH_REQUIRED",
            "Sign in again to continue.",
            None,
            Some("SIGN_IN".into()),
        )
    })
}

/// A signed-in account that belongs to at least one active organization.
///
/// Workspace reads and writes use this: a brand-new hosted or local identity
/// with no membership must not fall back to the installation's demo workspace,
/// and a disabled membership must not keep reading it either.
pub fn require_member(conn: &Connection, token: &str) -> Result<Account> {
    let account = require_user(conn, token)?;
    if account.role == "none" {
        return Err(CoreError::rule(
            "NO_ORGANIZATION",
            "Choose or create an organization to continue.",
            None,
            Some("CHOOSE_ORGANIZATION".into()),
        ));
    }
    Ok(account)
}

pub fn require_coordinator(conn: &Connection, token: &str) -> Result<Account> {
    let account = require_user(conn, token)?;
    if account.role != "coordinator" {
        return Err(CoreError::rule(
            "FORBIDDEN",
            "Only a coordinator can do that.",
            None,
            Some("RETURN_TO_VOLUNTEER_HOME".into()),
        ));
    }
    Ok(account)
}

const HANDOFF_KEY: &str = "hosted_handoff";
const HANDOFF_HOURS: i64 = 24;

/// Records that this device started a hosted hand-off.
///
/// The webview store is the fast path, but it is shared with other builds of
/// the app and a launch that starts from a fresh store loses it. The workspace
/// database survives both, so a return link is still recognised as one this
/// device asked for instead of being refused as an unrequested sign-in.
pub fn remember_hosted_handoff(conn: &Connection, kind: &str) -> Result<()> {
    if kind != "callback" && kind != "reset" {
        return Err(CoreError::Validation(
            "Choose between a sign-in and a password reset.".into(),
        ));
    }
    let value = format!("{kind}:{}", Utc::now().timestamp());
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![HANDOFF_KEY, value],
    )?;
    Ok(())
}

/// True while an unspent hand-off of this kind is younger than a day.
pub fn hosted_handoff_pending(conn: &Connection, kind: &str) -> Result<bool> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![HANDOFF_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let Some(stored) = stored else {
        return Ok(false);
    };
    let Some((stored_kind, at)) = stored.split_once(':') else {
        return Ok(false);
    };
    let Ok(at) = at.parse::<i64>() else {
        return Ok(false);
    };
    let age = Utc::now().timestamp() - at;
    Ok(stored_kind == kind && (0..HANDOFF_HOURS * 3600).contains(&age))
}

pub fn clear_hosted_handoff(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        params![HANDOFF_KEY],
    )?;
    Ok(())
}

const LINK_KEY: &str = "hosted_link";
const LINK_AT_KEY: &str = "hosted_link_at";
const LINK_MINUTES: i64 = 60;

/// Keeps the address the operating system handed the app.
///
/// macOS opens the app on the scheme URL, and the page that renders from it can
/// arrive after a reload, a second delivery, or a fresh window — each of which
/// throws away whatever the previous page held in memory. Recording the address
/// here means the callback page can still finish a sign-in that the webview
/// dropped on the floor instead of calling a valid Google return an expired
/// link.
pub fn store_hosted_link(conn: &Connection, url: &str) -> Result<()> {
    let trimmed = url.trim();
    if !trimmed.starts_with("civicflow://") || trimmed.len() > 4096 {
        return Err(CoreError::Validation(
            "That return address is not a CivicFlow link.".into(),
        ));
    }
    if trimmed.contains(['\n', '\r']) {
        return Err(CoreError::Validation(
            "That return address is not a CivicFlow link.".into(),
        ));
    }
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![LINK_KEY, trimmed],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        params![LINK_AT_KEY, Utc::now().timestamp().to_string()],
    )?;
    Ok(())
}

/// Returns the stored address once and forgets it, so a link works once.
///
/// An address older than the provider's own hour is dropped: finishing it
/// would fail the exchange anyway, and the sign-in screen can ask for a new
/// hand-off instead.
pub fn take_hosted_link(conn: &Connection) -> Result<Option<String>> {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![LINK_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let stored_at: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![LINK_AT_KEY],
            |row| row.get(0),
        )
        .optional()?;
    conn.execute(
        "DELETE FROM app_settings WHERE key IN (?1, ?2)",
        params![LINK_KEY, LINK_AT_KEY],
    )?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    let at = stored_at
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_default();
    let age = Utc::now().timestamp() - at;
    if at == 0 || !(0..LINK_MINUTES * 60).contains(&age) {
        return Ok(None);
    }
    Ok(Some(stored))
}

pub fn sign_out(conn: &Connection, token: &str, actor: &Account) -> Result<bool> {
    let now = Utc::now().to_rfc3339();
    let changed = conn.execute(
        "UPDATE auth_sessions SET revoked_at = ?1
         WHERE token_hash = ?2 AND revoked_at IS NULL",
        params![now, token_hash(token)],
    )?;
    if changed > 0 {
        conn.execute(
            "INSERT INTO audit_events
             (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary,
              organization_id)
             VALUES (?1, ?2, ?3, ?4, 'auth.sign_out', 'user', ?4, ?5, ?6)",
            params![
                uuid::Uuid::new_v4().to_string(),
                now,
                actor.role,
                actor.id,
                format!("Signed out {}", actor.email),
                crate::scope::current(conn)?,
            ],
        )?;
    }
    Ok(changed > 0)
}

pub fn list_accounts(conn: &Connection, token: &str) -> Result<Vec<Account>> {
    require_coordinator(conn, token)?;
    // Only the people who belong to the organization that is open. Holding a
    // coordinator role somewhere else must not turn this screen into a list of
    // every identity on the installation.
    let organization = crate::scope::require(conn)?;
    let mut statement = conn.prepare(
        "SELECT u.id, u.name, u.email,
                CASE WHEN m.role IN ('owner', 'coordinator') THEN 'coordinator' ELSE 'volunteer' END,
                m.volunteer_id
         FROM users u
         JOIN organization_memberships m ON m.user_id = u.id
         WHERE m.organization_id = ?1 AND m.status = 'active'
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'coordinator' THEN 1 ELSE 2 END,
                  u.name, u.id",
    )?;
    let mut rows = statement.query(params![organization])?;
    let mut accounts = Vec::new();
    while let Some(row) = rows.next()? {
        accounts.push(Account {
            id: row.get(0)?,
            name: row.get(1)?,
            email: row.get(2)?,
            role: row.get(3)?,
            volunteer_id: row.get(4)?,
        });
    }
    Ok(accounts)
}

/// An account is only manageable from an organization it belongs to. A target
/// outside the open organization is reported exactly like an unknown one, so a
/// coordinator cannot probe for identities elsewhere.
fn load_member_account(
    conn: &Connection,
    user_id: &str,
    organization_id: &str,
) -> Result<Option<Account>> {
    Ok(conn
        .query_row(
            "SELECT u.id, u.name, u.email,
                    CASE WHEN m.role IN ('owner', 'coordinator') THEN 'coordinator' ELSE 'volunteer' END,
                    m.volunteer_id
             FROM users u
             JOIN organization_memberships m ON m.user_id = u.id
             WHERE u.id = ?1 AND m.organization_id = ?2 AND m.status = 'active'",
            params![user_id, organization_id],
            |row| {
                Ok(Account {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                    role: row.get(3)?,
                    volunteer_id: row.get(4)?,
                })
            },
        )
        .optional()?)
}

pub fn reset_password(
    conn: &Connection,
    token: &str,
    user_id: &str,
    new_password: &str,
) -> Result<()> {
    let actor = require_coordinator(conn, token)?;
    validate_password(new_password)?;
    let organization = crate::scope::require(conn)?;
    let account = load_member_account(conn, user_id, &organization)?
        .ok_or_else(|| CoreError::NotFound(format!("Account {user_id}")))?;
    let hash = hash_password(new_password)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE users SET password_hash = ?1, status = 'active' WHERE id = ?2",
        params![hash, account.id],
    )?;
    conn.execute(
        "UPDATE auth_sessions SET revoked_at = ?1
         WHERE user_id = ?2 AND revoked_at IS NULL",
        params![now, account.id],
    )?;
    conn.execute(
        "INSERT INTO audit_events
         (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary)
         VALUES (?1, ?2, 'coordinator', ?3, 'auth.password_reset', 'user', ?4, ?5)",
        params![
            uuid::Uuid::new_v4().to_string(),
            now,
            actor.id,
            account.id,
            format!("Reset password for {}", account.email),
        ],
    )?;
    Ok(())
}

pub(crate) fn normalize_email(email: &str) -> Result<String> {
    let clean = email.trim().to_lowercase();
    let mut parts = clean.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    let valid = !local.is_empty()
        && clean.matches('@').count() == 1
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !clean.contains(char::is_whitespace)
        && clean.chars().count() <= 160;
    if !valid {
        return Err(CoreError::rule(
            "EMAIL_INVALID",
            "Use an email address like name@example.org.",
            Some("email".into()),
            None,
        ));
    }
    Ok(clean)
}

pub(crate) fn normalize_name(name: &str) -> Result<String> {
    let clean = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() < 2 {
        return Err(CoreError::rule(
            "NAME_REQUIRED",
            "Enter the name to show on this account.",
            Some("name".into()),
            None,
        ));
    }
    if clean.chars().count() > 80 {
        return Err(CoreError::rule(
            "NAME_TOO_LONG",
            "Keep the name under 80 characters.",
            Some("name".into()),
            None,
        ));
    }
    Ok(clean)
}

pub(crate) fn initials_for(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let mut initials: String = match (words.first(), words.last()) {
        (Some(first), Some(last)) if words.len() > 1 => {
            let mut value = String::new();
            value.extend(first.chars().take(1));
            value.extend(last.chars().take(1));
            value
        }
        (Some(only), _) => only.chars().take(2).collect(),
        _ => String::new(),
    };
    initials = initials.to_uppercase();
    if initials.is_empty() {
        "CF".into()
    } else {
        initials
    }
}

/// Creates a volunteer profile for a new volunteer account, so the roster and
/// every volunteer-scoped read model have a real row to point at.
fn insert_volunteer(
    conn: &Connection,
    organization: &str,
    name: &str,
    email: &str,
    now: &str,
) -> Result<String> {
    let id = format!("vol-{}", uuid::Uuid::new_v4());
    let first_name = name.split_whitespace().next().unwrap_or(name).to_string();
    conn.execute(
        "INSERT INTO volunteers
         (id, organization_id, name, first_name, initials, role, email, phone, joined_at,
          status, tone, languages_json, causes_json, hours_verified, attendance_rate,
          events_completed, interests, availability_json)
         VALUES (?1, ?2, ?3, ?4, ?5, 'Volunteer', ?6, '', ?7, 'onboarding', 'violet',
                 '[]', '[]', 0, 0, 0, '', '[]')",
        params![
            id,
            organization,
            name,
            first_name,
            initials_for(name),
            email,
            now
        ],
    )?;
    Ok(id)
}

/// Creates a local identity and signs it in. Creating an account grants no
/// organization role: the person either creates an organization (becoming its
/// owner) or redeems an invitation. That is what keeps a signup form from
/// awarding coordinator access to itself.
pub fn create_account(
    conn: &Connection,
    name: &str,
    email: &str,
    password: &str,
) -> Result<AuthSession> {
    let name = normalize_name(name)?;
    let email = normalize_email(email)?;
    validate_password(password)?;

    let taken: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE lower(email) = ?1",
            params![email],
            |row| row.get(0),
        )
        .optional()?;
    if taken.is_some() {
        return Err(CoreError::rule(
            "EMAIL_TAKEN",
            "An account already uses that email. Sign in instead.",
            Some("email".into()),
            Some("SIGN_IN".into()),
        ));
    }

    let now = Utc::now().to_rfc3339();
    let id = format!("user-{}", uuid::Uuid::new_v4());

    conn.execute(
        // `users.role` is a legacy v11 column with a two-value CHECK. It is no
        // longer read for authorization; membership is the only role source.
        "INSERT INTO users (id, name, email, role, volunteer_id, password_hash, status, created_at)
         VALUES (?1, ?2, ?3, 'volunteer', NULL, ?4, 'active', ?5)",
        params![id, name, email, hash_password(password)?, now],
    )?;
    conn.execute(
        "INSERT INTO audit_events
         (id, timestamp, actor_type, actor_id, action, entity_type, entity_id, summary)
         VALUES (?1, ?2, 'member', ?3, 'auth.account_created', 'user', ?3, ?4)",
        params![
            uuid::Uuid::new_v4().to_string(),
            now,
            id,
            format!("Created an identity for {email}"),
        ],
    )?;

    sign_in(conn, &email, password, true)
}

fn upsert_account(
    conn: &Connection,
    id: &str,
    name: &str,
    email: &str,
    role: &str,
    volunteer_id: Option<&str>,
    now: &str,
) -> Result<()> {
    let existing: Option<Option<String>> = conn
        .query_row(
            "SELECT password_hash FROM users WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    let hash = match existing {
        Some(Some(hash)) => hash,
        _ => hash_password(DEMO_PASSWORD)?,
    };
    conn.execute(
        "INSERT INTO users (id, name, email, role, volunteer_id, password_hash, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7)
         ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             email = excluded.email,
             role = excluded.role,
             volunteer_id = excluded.volunteer_id,
             password_hash = COALESCE(users.password_hash, excluded.password_hash)",
        params![id, name, email, role, volunteer_id, hash, now],
    )?;
    Ok(())
}

/// Creates the two demo accounts on first launch and backfills a password for a
/// database that predates account support. A password the coordinator has reset
/// is never overwritten.
pub fn seed_demo_accounts(conn: &Connection, now: &str) -> Result<()> {
    let coordinator_id: Option<String> = conn
        .query_row(
            "SELECT id FROM users WHERE role = 'coordinator' ORDER BY created_at LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(id) = coordinator_id {
        conn.execute(
            "UPDATE users SET email = 'praket@rivergate.example',
                              name = COALESCE(NULLIF(name, ''), 'Praket Gauri'),
                              password_hash = COALESCE(password_hash, ?1)
             WHERE id = ?2",
            params![hash_password(DEMO_PASSWORD)?, id],
        )?;
    } else {
        upsert_account(
            conn,
            "user-praket",
            "Praket Gauri",
            "praket@rivergate.example",
            "coordinator",
            None,
            now,
        )?;
    }

    let volunteer: Option<(String, String, String)> = conn
        .query_row(
            "SELECT id, name, email FROM volunteers
             WHERE id = (SELECT value FROM app_settings WHERE key = 'current_volunteer_id')
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if let Some((volunteer_id, name, email)) = volunteer {
        upsert_account(
            conn,
            "user-maya",
            &name,
            &email,
            "volunteer",
            Some(&volunteer_id),
            now,
        )?;
    }

    Ok(())
}

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use civicflow_core::archive;
use civicflow_core::auth::{Account, AuthSession};
use civicflow_core::error::{AppError, CoreError};
use civicflow_core::explain::CandidateAnswer;
use civicflow_core::imports::{self, ImportPreview, ImportSummary};
use civicflow_core::insights::{
    self, CredentialReadiness, EngagementMetrics, RetentionSignal, VolunteerInsight,
};
use civicflow_core::matching::{RosterOptions, RosterPlan};
use civicflow_core::models::{
    AvailabilitySlot, BackupRestoreResult, BackupSnapshot, CheckinCode, CheckinWindow,
    CreateOpportunityResult, MissionControlSummary, NewOpportunityInput, NotificationItem,
    SettingsPatch, WorkspaceSnapshot,
};
use civicflow_core::notifications::{self, NotificationRule, RulePatch};
use civicflow_core::organizations::{
    self, IssuedInvite, NewOrganization, OrganizationAccess, OrganizationDetailsPatch,
    OrganizationMember, OrganizationRecord, PendingInvite,
};
use civicflow_core::policy::{self, PriorityLevel, RosterPolicy};
use civicflow_core::recovery::{self, DisruptionReport, RecoveryChangeRequest, RecoveryPlan};
use civicflow_core::recurrence::{self, RecurrenceRule, SeriesResult, ShiftSeriesRecord};
use civicflow_core::reports::{self, ExportFormat, ReportDocument, ReportRequest};
use civicflow_core::Database;
use civicflow_core::{auth, backups, roster, services, workflows};
use serde::Serialize;
use tauri::{Manager, State};
#[cfg(desktop)]
use tauri_plugin_deep_link::DeepLinkExt;

struct AppState {
    database: Mutex<Database>,
    backup_dir: PathBuf,
}

fn lock_error() -> AppError {
    AppError {
        code: "WORKSPACE_BUSY".into(),
        message: "The workspace database is busy. Close any open dialog and try again.".into(),
        field: None,
        action: Some("RETRY".into()),
    }
}

/// The shared-workspace session lives in the operating system's credential
/// store, never in the webview's local storage. A webview store is readable by
/// any script that manages to run in the page; the keychain is not.
const CLOUD_SESSION_SERVICE: &str = "io.github.praket7.civicflow";
const CLOUD_SESSION_ACCOUNT: &str = "shared-workspace-session";

fn keychain_error(error: keyring::Error) -> AppError {
    AppError {
        code: "KEYCHAIN".into(),
        message: format!("The operating system credential store refused the request: {error}"),
        field: None,
        action: Some("RETRY".into()),
    }
}

#[tauri::command]
fn save_cloud_session(value: String) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError {
            code: "VALIDATION".into(),
            message: "A cloud session cannot be empty.".into(),
            field: None,
            action: None,
        });
    }
    let entry = keyring::Entry::new(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
        .map_err(keychain_error)?;
    entry.set_password(&value).map_err(keychain_error)
}

#[tauri::command]
fn load_cloud_session() -> Result<Option<String>, AppError> {
    let entry = keyring::Entry::new(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
        .map_err(keychain_error)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keychain_error(error)),
    }
}

#[tauri::command]
fn clear_cloud_session() -> Result<(), AppError> {
    let entry = keyring::Entry::new(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
        .map_err(keychain_error)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(error)),
    }
}

/// The key that seals the workspace file. It is generated once on this machine
/// and kept in the same credential store as the cloud session; a copy of the
/// database without it opens as noise.
const WORKSPACE_KEY_SERVICE: &str = "io.github.praket7.civicflow";
const WORKSPACE_KEY_ACCOUNT: &str = "workspace-encryption-key";

fn workspace_key() -> Result<[u8; 32], AppError> {
    // The native test suite names its own key so a run never reads or writes
    // the credential store of the machine it happens to be running on.
    if let Some(value) = std::env::var_os("CIVICFLOW_WORKSPACE_KEY") {
        let value = value.to_string_lossy().to_string();
        return civicflow_core::db::parse_key(&value).ok_or_else(|| AppError {
            code: "KEYCHAIN".into(),
            message: "CIVICFLOW_WORKSPACE_KEY must be 64 hexadecimal characters.".into(),
            field: None,
            action: None,
        });
    }
    let entry = keyring::Entry::new(WORKSPACE_KEY_SERVICE, WORKSPACE_KEY_ACCOUNT)
        .map_err(keychain_error)?;
    match entry.get_password() {
        Ok(stored) => civicflow_core::db::parse_key(&stored).ok_or_else(|| AppError {
            code: "KEYCHAIN".into(),
            message: "The stored workspace key is not readable. Restore the key from your backup before opening this workspace.".into(),
            field: None,
            action: Some("OPEN_BACKUP".into()),
        }),
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            getrandom::getrandom(&mut key).map_err(|error| AppError {
                code: "KEYCHAIN".into(),
                message: format!("This machine could not produce a workspace key: {error}"),
                field: None,
                action: Some("RETRY".into()),
            })?;
            let stored: String = key.iter().map(|byte| format!("{byte:02x}")).collect();
            entry.set_password(&stored).map_err(keychain_error)?;
            Ok(key)
        }
        Err(error) => Err(keychain_error(error)),
    }
}

/// Every workspace command resolves its token here; hiding a screen is not the gate.
fn require_account(database: &Database, token: &str) -> Result<Account, AppError> {
    auth::require_member(database.connection(), token).map_err(AppError::from)
}

/// The row both role and data scope derive from.
fn remember_active_organization(
    database: &Database,
    user_id: &str,
    organization_id: &str,
) -> Result<(), AppError> {
    database
        .connection()
        .execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            [
                format!("active_organization:{user_id}"),
                organization_id.to_string(),
            ],
        )
        .map_err(|error| AppError::from(CoreError::from(error)))?;
    civicflow_core::scope::select(database.connection(), Some(organization_id))
        .map_err(AppError::from)
}

fn require_coordinator(database: &Database, token: &str) -> Result<Account, AppError> {
    auth::require_coordinator(database.connection(), token).map_err(AppError::from)
}

/// Snapshots cover the whole installation, so every backup command asks here.
fn require_installation_steward(database: &Database, token: &str) -> Result<Account, AppError> {
    let account = require_account(database, token)?;
    organizations::require_installation_steward(database.connection(), &account.id)
        .map_err(AppError::from)?;
    Ok(account)
}

/// A volunteer may only act on their own volunteer record; a coordinator may
/// act on anyone's.
fn require_self_or_coordinator(account: &Account, volunteer_id: &str) -> Result<(), AppError> {
    if account.role == "coordinator" {
        return Ok(());
    }
    if account.volunteer_id.as_deref() != Some(volunteer_id) {
        return Err(AppError::from(CoreError::rule(
            "FORBIDDEN",
            "You can only change your own volunteer record.",
            None,
            Some("RETURN_TO_VOLUNTEER_HOME".into()),
        )));
    }
    Ok(())
}

/// The snapshot is redacted for volunteers before it crosses the IPC bridge.
fn snapshot_for(database: &Database, account: &Account) -> Result<WorkspaceSnapshot, AppError> {
    let volunteer_id = if account.role == "volunteer" {
        account.volunteer_id.as_deref()
    } else {
        None
    };
    workflows::snapshot_for(database.connection(), volunteer_id).map_err(AppError::from)
}

fn volunteer_audience(account: &Account) -> (&str, Option<&str>) {
    if account.role == "volunteer" {
        ("volunteer", account.volunteer_id.as_deref())
    } else {
        ("coordinator", None)
    }
}

fn only_display_settings(patch: &SettingsPatch) -> bool {
    patch.organization_name.is_none()
        && patch.contact_email.is_none()
        && patch.timezone.is_none()
        && patch.week_starts_on.is_none()
        && patch.default_shift_length.is_none()
        && patch.auto_promote_waitlist.is_none()
        && patch.hours_require_approval.is_none()
        && patch.email_digest.is_none()
}

/// Only web addresses belong in the browser; a newline would let the shell read
/// the rest of the line as a second command.
fn is_openable_sign_in_url(url: &str) -> bool {
    url.starts_with("https://") && !url.contains(['\n', '\r', '"', '\''])
}

/// Provider consent pages need the system browser; answers come back on
/// `civicflow://`.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), AppError> {
    if !is_openable_sign_in_url(&url) {
        return Err(AppError::from(CoreError::rule(
            "INVALID_URL",
            "That sign-in address is not usable.",
            None,
            None,
        )));
    }
    open_in_browser(url.as_str()).map_err(|error| {
        AppError::from(CoreError::rule(
            "BROWSER_UNAVAILABLE",
            format!("The browser could not be opened: {error}"),
            None,
            Some("TRY_AGAIN".into()),
        ))
    })
}

fn open_in_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        // The empty string is start's window title, not part of the address.
        let mut command = std::process::Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    };
    command.spawn()?;
    Ok(())
}

#[tauri::command]
fn sign_in(
    state: State<'_, AppState>,
    email: String,
    password: String,
    remember: bool,
) -> Result<AuthSession, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::sign_in(database.connection(), &email, &password, remember).map_err(AppError::from)
}

#[tauri::command]
fn sign_in_with_hosted(
    state: State<'_, AppState>,
    name: String,
    email: String,
) -> Result<AuthSession, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::sign_in_with_hosted(database.connection(), &name, &email).map_err(AppError::from)
}

#[tauri::command]
fn create_account(
    state: State<'_, AppState>,
    name: String,
    email: String,
    password: String,
) -> Result<AuthSession, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::create_account(database.connection(), &name, &email, &password).map_err(AppError::from)
}

#[tauri::command]
fn list_my_organizations(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<OrganizationAccess>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::organizations_for_account(database.connection(), &account.id)
        .map_err(AppError::from)
}

#[tauri::command]
fn list_public_organizations(
    state: State<'_, AppState>,
) -> Result<Vec<OrganizationRecord>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    organizations::list_organizations(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn create_organization(
    state: State<'_, AppState>,
    token: String,
    input: NewOrganization,
) -> Result<OrganizationAccess, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    let organization = organizations::create_organization(database.connection(), &account, &input)
        .map_err(AppError::from)?;
    // The creator is the owner of what they just made, so it becomes their
    // workspace. Otherwise the next screen would open the previous organization.
    remember_active_organization(&database, &account.id, &organization.id)?;
    organizations::organization_access(database.connection(), &organization.id, &account.id)
        .map_err(AppError::from)
}

#[tauri::command]
fn update_organization(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
    patch: OrganizationDetailsPatch,
) -> Result<OrganizationRecord, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::update_organization(database.connection(), &account, &organization_id, &patch)
        .map_err(AppError::from)
}

#[tauri::command]
fn select_organization(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
) -> Result<OrganizationAccess, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    let access =
        organizations::organization_access(database.connection(), &organization_id, &account.id)
            .map_err(AppError::from)?;
    remember_active_organization(&database, &account.id, &organization_id)?;
    Ok(access)
}

#[tauri::command]
fn list_organization_members(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
) -> Result<Vec<OrganizationMember>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::list_members(database.connection(), &account, &organization_id)
        .map_err(AppError::from)
}

#[tauri::command]
fn list_organization_invites(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
) -> Result<Vec<PendingInvite>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::list_invites(database.connection(), &account, &organization_id)
        .map_err(AppError::from)
}

#[tauri::command]
fn create_organization_invite(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
    role: String,
    email: String,
) -> Result<IssuedInvite, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::create_invite(
        database.connection(),
        &account,
        &organization_id,
        &role,
        &email,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn revoke_organization_invite(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
    invite_id: String,
) -> Result<(), AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::revoke_invite(
        database.connection(),
        &account,
        &organization_id,
        &invite_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn redeem_organization_invite(
    state: State<'_, AppState>,
    token: String,
    code: String,
) -> Result<OrganizationAccess, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    let membership = organizations::redeem_invite(database.connection(), &account.id, &code)
        .map_err(AppError::from)?;
    remember_active_organization(&database, &account.id, &membership.organization_id)?;
    organizations::organization_access(
        database.connection(),
        &membership.organization_id,
        &account.id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn join_public_organization(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
) -> Result<OrganizationAccess, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    let membership =
        organizations::join_as_volunteer(database.connection(), &account.id, &organization_id)
            .map_err(AppError::from)?;
    // Joining a second organization means working in it now; the role follows.
    remember_active_organization(&database, &account.id, &membership.organization_id)?;
    organizations::organization_access(
        database.connection(),
        &membership.organization_id,
        &account.id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn set_organization_member_role(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
    user_id: String,
    role: String,
) -> Result<Vec<OrganizationMember>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::set_membership_role(
        database.connection(),
        &account,
        &organization_id,
        &user_id,
        &role,
    )
    .map_err(AppError::from)?;
    organizations::list_members(database.connection(), &account, &organization_id)
        .map_err(AppError::from)
}

#[tauri::command]
fn set_organization_member_status(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
    user_id: String,
    status: String,
) -> Result<Vec<OrganizationMember>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::set_membership_status(
        database.connection(),
        &account,
        &organization_id,
        &user_id,
        &status,
    )
    .map_err(AppError::from)?;
    organizations::list_members(database.connection(), &account, &organization_id)
        .map_err(AppError::from)
}

#[tauri::command]
fn transfer_organization_ownership(
    state: State<'_, AppState>,
    token: String,
    organization_id: String,
    user_id: String,
) -> Result<Vec<OrganizationMember>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::require_user(database.connection(), &token)?;
    organizations::transfer_ownership(database.connection(), &account, &organization_id, &user_id)
        .map_err(AppError::from)?;
    organizations::list_members(database.connection(), &account, &organization_id)
        .map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::is_openable_sign_in_url;

    #[test]
    fn opens_web_sign_in_addresses_only() {
        assert!(is_openable_sign_in_url(
            "https://imzdblvljdcbnxtwbmbw.supabase.co/auth/v1/authorize?provider=google&state=abc"
        ));
        assert!(!is_openable_sign_in_url("http://localhost:5199/sign-in"));
        assert!(!is_openable_sign_in_url("file:///etc/passwd"));
        assert!(!is_openable_sign_in_url(
            "https://example.org/\nopen -a Calculator"
        ));
        assert!(!is_openable_sign_in_url("https://example.org/\"quoted\""));
    }
}

#[tauri::command]
fn remember_hosted_handoff(state: State<'_, AppState>, kind: String) -> Result<(), AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::remember_hosted_handoff(database.connection(), &kind).map_err(AppError::from)
}

#[tauri::command]
fn hosted_handoff_pending(state: State<'_, AppState>, kind: String) -> Result<bool, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::hosted_handoff_pending(database.connection(), &kind).map_err(AppError::from)
}

#[tauri::command]
fn clear_hosted_handoff(state: State<'_, AppState>) -> Result<(), AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::clear_hosted_handoff(database.connection()).map_err(AppError::from)
}

/// Hands the callback page the address the operating system delivered. Taking
/// it spends it, so the same link cannot sign the window in twice.
#[tauri::command]
fn take_hosted_link(state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::take_hosted_link(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn sign_out(state: State<'_, AppState>, token: String) -> Result<bool, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = auth::current_user(database.connection(), &token).map_err(AppError::from)?;
    let Some(account) = account else {
        return Ok(false);
    };
    auth::sign_out(database.connection(), &token, &account).map_err(AppError::from)
}

#[tauri::command]
fn current_user(state: State<'_, AppState>, token: String) -> Result<Option<Account>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::current_user(database.connection(), &token).map_err(AppError::from)
}

#[tauri::command]
fn list_accounts(state: State<'_, AppState>, token: String) -> Result<Vec<Account>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::list_accounts(database.connection(), &token).map_err(AppError::from)
}

#[tauri::command]
fn reset_password(
    state: State<'_, AppState>,
    token: String,
    user_id: String,
    new_password: String,
) -> Result<(), AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    auth::reset_password(database.connection(), &token, &user_id, &new_password)
        .map_err(AppError::from)
}

#[tauri::command]
fn get_mission_control(
    state: State<'_, AppState>,
    token: String,
) -> Result<MissionControlSummary, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    services::get_mission_control(database.connection(), &account.role).map_err(AppError::from)
}

#[tauri::command]
fn list_notifications(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<NotificationItem>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    let (audience, volunteer_id) = volunteer_audience(&account);
    services::list_notifications(database.connection(), audience, volunteer_id)
        .map_err(AppError::from)
}

#[tauri::command]
fn mark_notification_read(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<bool, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    let (audience, volunteer_id) = volunteer_audience(&account);
    services::mark_notification_read(
        database.connection(),
        &id,
        audience,
        volunteer_id,
        &account.role,
        &account.name,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn get_workspace_snapshot(
    state: State<'_, AppState>,
    token: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn auto_roster(
    state: State<'_, AppState>,
    token: String,
    shift_ids: Vec<String>,
    options: RosterOptions,
) -> Result<RosterPlan, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    roster::plan_roster(database.connection(), &shift_ids, &options).map_err(AppError::from)
}

/// The plan and the full candidate evaluation it came from. The AutoRoster
/// screen renders these values instead of deriving its own eligibility or score.
#[tauri::command]
fn evaluate_roster_candidates(
    state: State<'_, AppState>,
    token: String,
    shift_ids: Vec<String>,
    options: RosterOptions,
) -> Result<civicflow_core::matching::RosterEvaluation, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    roster::evaluate_roster_candidates(database.connection(), &shift_ids, &options)
        .map_err(AppError::from)
}

/// The matching policy in force, plus the named priorities a coordinator may
/// choose from, so the screen never invents a numeric weight of its own.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RosterPolicyView {
    policy: RosterPolicy,
    levels: Vec<PriorityLevel>,
    organization_id: String,
}

/// The organization the session is working in.
fn workspace_organization(database: &Database) -> Result<String, AppError> {
    if let Some(organization) =
        civicflow_core::scope::current(database.connection()).map_err(AppError::from)?
    {
        return Ok(organization);
    }
    roster::workspace_organization_id(database.connection())
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::from(CoreError::NotFound("the workspace organization".into())))
}

fn policy_view(database: &Database) -> Result<RosterPolicyView, AppError> {
    let policy = roster::policy_for_workspace(database.connection()).map_err(AppError::from)?;
    let organization_id = workspace_organization(database)?;
    Ok(RosterPolicyView {
        policy,
        levels: policy::priority_levels(),
        organization_id,
    })
}

#[tauri::command]
fn get_roster_policy(
    state: State<'_, AppState>,
    token: String,
) -> Result<RosterPolicyView, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    policy_view(&database)
}

#[tauri::command]
fn update_roster_policy(
    state: State<'_, AppState>,
    token: String,
    policy: RosterPolicy,
) -> Result<RosterPolicyView, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    let organization_id = roster::workspace_organization_id(database.connection())
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::from(CoreError::NotFound("the workspace organization".into())))?;
    policy::save_policy(database.connection(), &account, &organization_id, &policy)
        .map_err(AppError::from)?;
    policy_view(&database)
}

#[tauri::command]
fn explain_roster_choice(
    state: State<'_, AppState>,
    token: String,
    shift_ids: Vec<String>,
    options: RosterOptions,
    candidate_id: String,
    slot_id: String,
) -> Result<CandidateAnswer, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    roster::explain_candidate(
        database.connection(),
        &shift_ids,
        &options,
        &candidate_id,
        &slot_id,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn apply_roster_plan(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    assignments: Vec<roster::RosterApplyAssignment>,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    roster::apply_roster_plan(database.connection(), &shift_id, &assignments)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

/// Applies every assignment of a reviewed week in one transaction. A plan that
/// went stale while the coordinator was reading is refused, not half-applied.
#[tauri::command]
fn apply_roster_week(
    state: State<'_, AppState>,
    token: String,
    expected_revision: Option<i64>,
    expected_policy_version: Option<i64>,
    assignments: Vec<roster::WeeklyAssignment>,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    roster::apply_roster_week(
        database.connection(),
        expected_revision,
        expected_policy_version,
        &assignments,
    )
    .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn detect_disruptions(
    state: State<'_, AppState>,
    token: String,
) -> Result<DisruptionReport, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    recovery::detect(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn plan_recovery(
    state: State<'_, AppState>,
    token: String,
    shift_ids: Vec<String>,
    options: RosterOptions,
) -> Result<RecoveryPlan, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    recovery::plan(database.connection(), &shift_ids, &options).map_err(AppError::from)
}

#[tauri::command]
fn apply_recovery(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    changes: Vec<RecoveryChangeRequest>,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    recovery::apply(database.connection(), &account, &shift_id, &changes).map_err(AppError::from)
}

#[tauri::command]
fn set_assignment_lock(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
    locked: bool,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    recovery::set_lock(
        database.connection(),
        &account,
        &shift_id,
        &volunteer_id,
        locked,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn create_shift_series(
    state: State<'_, AppState>,
    token: String,
    opportunity_id: String,
    rule: RecurrenceRule,
    roles: Vec<recurrence::SeriesRole>,
) -> Result<SeriesResult, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    recurrence::create_series(
        database.connection(),
        &account,
        &opportunity_id,
        &rule,
        &roles,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn list_shift_series(
    state: State<'_, AppState>,
    token: String,
    opportunity_id: Option<String>,
) -> Result<Vec<ShiftSeriesRecord>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    recurrence::list_series(database.connection(), opportunity_id.as_deref())
        .map_err(AppError::from)
}

#[tauri::command]
fn generate_series_instances(
    state: State<'_, AppState>,
    token: String,
    series_id: String,
) -> Result<SeriesResult, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    recurrence::generate_instances(database.connection(), &account, &series_id)
        .map_err(AppError::from)
}

#[tauri::command]
fn retime_shift_series(
    state: State<'_, AppState>,
    token: String,
    series_id: String,
    starts_local_time: String,
    duration_minutes: i64,
    scope: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    recurrence::retime(
        database.connection(),
        &account,
        &series_id,
        &starts_local_time,
        duration_minutes,
        &scope,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn delete_shift_series(
    state: State<'_, AppState>,
    token: String,
    series_id: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    recurrence::delete_series(database.connection(), &account, &series_id).map_err(AppError::from)
}

#[tauri::command]
fn recommend_replacement(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    role: String,
) -> Result<civicflow_core::waitlist::ReplacementRecommendation, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    civicflow_core::waitlist::rank(database.connection(), &shift_id, &role).map_err(AppError::from)
}

#[tauri::command]
fn list_notification_rules(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<NotificationRule>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    notifications::list_rules(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn update_notification_rule(
    state: State<'_, AppState>,
    token: String,
    rule_id: String,
    patch: RulePatch,
) -> Result<Vec<NotificationRule>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    notifications::update_rule(database.connection(), &account, &rule_id, &patch)
        .map_err(AppError::from)
}

#[tauri::command]
fn queue_due_reminders(state: State<'_, AppState>, token: String) -> Result<usize, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    let run = notifications::generate_due(database.connection(), Some(&account))
        .map_err(AppError::from)?;
    Ok(run.created.len())
}

#[tauri::command]
fn retention_signals(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<RetentionSignal>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    insights::retention_signals(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn volunteer_insight(
    state: State<'_, AppState>,
    token: String,
    volunteer_id: String,
) -> Result<VolunteerInsight, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    require_self_or_coordinator(&account, &volunteer_id)?;
    insights::volunteer_insight(database.connection(), &volunteer_id).map_err(AppError::from)
}

#[tauri::command]
fn engagement_metrics(
    state: State<'_, AppState>,
    token: String,
) -> Result<EngagementMetrics, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    insights::engagement_metrics(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn credential_readiness(
    state: State<'_, AppState>,
    token: String,
) -> Result<CredentialReadiness, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    insights::credential_readiness(database.connection()).map_err(AppError::from)
}

#[tauri::command]
fn save_report_view(
    state: State<'_, AppState>,
    token: String,
    name: String,
    scope: String,
    filters_json: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    workflows::save_report_view(database.connection(), &name, &scope, &filters_json)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn set_saved_opportunity(
    state: State<'_, AppState>,
    token: String,
    opportunity_id: String,
    saved: bool,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    workflows::set_saved_opportunity(database.connection(), &opportunity_id, saved)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn set_application_stage(
    state: State<'_, AppState>,
    token: String,
    application_id: String,
    stage: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    workflows::set_application_stage(database.connection(), &application_id, &stage)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn checkin_window(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
) -> Result<CheckinWindow, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_account(&database, &token)?;
    workflows::checkin_window(database.connection(), &shift_id).map_err(AppError::from)
}

#[tauri::command]
fn get_checkin_code(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
) -> Result<CheckinCode, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    // A coordinator reads the printed code that is the door gate. A volunteer
    // gets only the opaque token for the code already on the board, so the
    // six-digit secret never reaches a volunteer's session.
    if account.role != "coordinator" {
        let volunteer_id = account.volunteer_id.ok_or_else(|| {
            AppError::from(CoreError::rule(
                "FORBIDDEN",
                "Only a volunteer can show a check-in code.",
                None,
                Some("RETURN_TO_VOLUNTEER_HOME".into()),
            ))
        })?;
        return workflows::volunteer_checkin_credential(
            database.connection(),
            &shift_id,
            &volunteer_id,
        )
        .map_err(AppError::from);
    }
    workflows::get_checkin_code(database.connection(), &shift_id).map_err(AppError::from)
}

#[tauri::command]
fn check_in_volunteer(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
    code: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    require_self_or_coordinator(&account, &volunteer_id)?;
    if code.trim().is_empty() {
        return Err(AppError::from(CoreError::rule(
            "CHECKIN_CODE_REQUIRED",
            "Enter the code posted at the check-in table.",
            Some("code".into()),
            Some("ASK_SHIFT_LEAD".into()),
        )));
    }
    workflows::check_in(database.connection(), &shift_id, &volunteer_id, &code)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

/// A coordinator recording an arrival themselves. Separate from self check-in
/// so it carries its own permission, its own reason, and its own audit event.
#[tauri::command]
fn manual_check_in(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
    reason: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    workflows::manual_check_in(database.connection(), &shift_id, &volunteer_id, &reason)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn check_out_volunteer(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    require_self_or_coordinator(&account, &volunteer_id)?;
    workflows::check_out(database.connection(), &shift_id, &volunteer_id)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn mark_volunteer_no_show(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    workflows::mark_no_show(database.connection(), &shift_id, &volunteer_id)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn cancel_registration(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
    reason: Option<String>,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    require_self_or_coordinator(&account, &volunteer_id)?;
    workflows::cancel_registration(
        database.connection(),
        &shift_id,
        &volunteer_id,
        reason.as_deref().unwrap_or_default(),
    )
    .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn join_waitlist(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
    role: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    require_self_or_coordinator(&account, &volunteer_id)?;
    workflows::join_waitlist(database.connection(), &shift_id, &volunteer_id, &role)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn promote_waitlist(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    workflows::promote_waitlist(database.connection(), &shift_id, &volunteer_id)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn review_hours(
    state: State<'_, AppState>,
    token: String,
    entry_id: String,
    status: String,
    approved_minutes: Option<i64>,
    reason: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    workflows::review_hours(
        database.connection(),
        &entry_id,
        &status,
        approved_minutes,
        &reason,
    )
    .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn update_workspace_settings(
    state: State<'_, AppState>,
    token: String,
    patch: SettingsPatch,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    if account.role != "coordinator" && !only_display_settings(&patch) {
        return Err(AppError::from(CoreError::rule(
            "FORBIDDEN",
            "Only a coordinator can change workspace settings.",
            None,
            Some("RETURN_TO_VOLUNTEER_HOME".into()),
        )));
    }
    workflows::update_settings(database.connection(), patch).map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[tauri::command]
fn create_opportunity(
    state: State<'_, AppState>,
    token: String,
    input: NewOpportunityInput,
) -> Result<CreateOpportunityResult, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    workflows::create_opportunity(database.connection(), input).map_err(AppError::from)
}

#[tauri::command]
fn register_for_shift(
    state: State<'_, AppState>,
    token: String,
    shift_id: String,
    volunteer_id: String,
    role: String,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    require_self_or_coordinator(&account, &volunteer_id)?;
    workflows::register_for_shift(database.connection(), &shift_id, &volunteer_id, &role)
        .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

// The IPC surface is deliberately flat: the WebView sends one patch object's
// worth of fields, and a nested struct here would only add a second place to
// keep the TypeScript and Rust shapes in step.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn save_volunteer_profile(
    state: State<'_, AppState>,
    token: String,
    skills: Vec<String>,
    availability: Vec<AvailabilitySlot>,
    completed_onboarding: bool,
    phone: Option<String>,
    interests: Option<String>,
    causes: Option<Vec<String>>,
    photo: Option<String>,
) -> Result<WorkspaceSnapshot, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    if account.role != "volunteer" {
        return Err(AppError::from(CoreError::rule(
            "FORBIDDEN",
            "Only the signed-in volunteer can change a volunteer profile.",
            None,
            None,
        )));
    }
    workflows::save_volunteer_profile(
        database.connection(),
        civicflow_core::models::VolunteerProfilePatch {
            skills,
            availability,
            completed_onboarding,
            phone: phone.unwrap_or_default(),
            interests: interests.unwrap_or_default(),
            causes: causes.unwrap_or_default(),
            photo: photo.unwrap_or_default(),
        },
    )
    .map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

/// The only path that seeds fixture records. The session is short-lived.
#[tauri::command]
fn open_demo_workspace(state: State<'_, AppState>) -> Result<AuthSession, AppError> {
    let mut database = state.database.lock().map_err(|_| lock_error())?;
    database.seed_demo().map_err(AppError::from)?;
    auth::sign_in(
        database.connection(),
        auth::DEMO_EMAIL,
        auth::DEMO_PASSWORD,
        false,
    )
    .map_err(AppError::from)
}

#[tauri::command]
fn reset_demo(state: State<'_, AppState>, token: String) -> Result<WorkspaceSnapshot, AppError> {
    let mut database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    database.reset_demo().map_err(AppError::from)?;
    snapshot_for(&database, &account)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportReceipt {
    path: String,
    bytes: usize,
    format: String,
    title: String,
}

#[tauri::command]
fn generate_report(
    state: State<'_, AppState>,
    token: String,
    request: ReportRequest,
) -> Result<ReportDocument, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    reports::generate(database.connection(), &request).map_err(AppError::from)
}

#[tauri::command]
fn export_report(
    state: State<'_, AppState>,
    token: String,
    request: ReportRequest,
    format: String,
    path: String,
) -> Result<ExportReceipt, AppError> {
    let format = ExportFormat::parse(&format).map_err(AppError::from)?;
    let target = PathBuf::from(&path);
    if target.file_name().is_none() || !target.is_absolute() {
        return Err(AppError::from(CoreError::Validation(
            "Choose a file name and folder for the export.".into(),
        )));
    }
    let expected = match format {
        ExportFormat::Csv => "csv",
        ExportFormat::Pdf => "pdf",
    };
    if target.extension().and_then(|value| value.to_str()) != Some(expected) {
        return Err(AppError::from(CoreError::Validation(format!(
            "That report must be saved as a .{expected} file."
        ))));
    }
    if let Some(parent) = target.parent() {
        if !parent.is_dir() {
            return Err(AppError::from(CoreError::Validation(
                "That folder no longer exists.".into(),
            )));
        }
    }
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    let document = reports::generate(database.connection(), &request).map_err(AppError::from)?;
    reports::export(&document, format, &target).map_err(AppError::from)?;
    let bytes = std::fs::metadata(&target)
        .map(|metadata| metadata.len() as usize)
        .unwrap_or(0);
    Ok(ExportReceipt {
        path,
        bytes,
        format: expected.to_string(),
        title: document.title,
    })
}

#[tauri::command]
fn preview_volunteer_import(
    state: State<'_, AppState>,
    token: String,
    text: String,
) -> Result<ImportPreview, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    let organization_id = workspace_organization(&database)?;
    imports::preview(database.connection(), &organization_id, &text).map_err(AppError::from)
}

#[tauri::command]
fn apply_volunteer_import(
    state: State<'_, AppState>,
    token: String,
    text: String,
) -> Result<ImportSummary, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_coordinator(&database, &token)?;
    let organization_id = workspace_organization(&database)?;
    imports::apply(database.connection(), &account, &organization_id, &text).map_err(AppError::from)
}

#[tauri::command]
fn export_volunteer_roster(
    state: State<'_, AppState>,
    token: String,
    path: String,
) -> Result<ExportReceipt, AppError> {
    let target = PathBuf::from(&path);
    if target.file_name().is_none() || !target.is_absolute() {
        return Err(AppError::from(CoreError::Validation(
            "Choose a file name and folder for the roster export.".into(),
        )));
    }
    if target.extension().and_then(|value| value.to_str()) != Some("csv") {
        return Err(AppError::from(CoreError::Validation(
            "The roster exports as a .csv file.".into(),
        )));
    }
    if let Some(parent) = target.parent() {
        if !parent.is_dir() {
            return Err(AppError::from(CoreError::Validation(
                "That folder no longer exists.".into(),
            )));
        }
    }
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_coordinator(&database, &token)?;
    let organization_id = workspace_organization(&database)?;
    let document =
        imports::export_roster(database.connection(), &organization_id).map_err(AppError::from)?;
    std::fs::write(&target, document).map_err(|error| AppError::from(CoreError::from(error)))?;
    let bytes = std::fs::metadata(&target)
        .map(|metadata| metadata.len() as usize)
        .unwrap_or(0);
    Ok(ExportReceipt {
        path,
        bytes,
        format: "csv".into(),
        title: "Volunteer roster".into(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallationAccess {
    steward: bool,
}

/// Installation-level capability; the screens hide the backup section without it.
#[tauri::command]
fn installation_access(
    state: State<'_, AppState>,
    token: String,
) -> Result<InstallationAccess, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    let account = require_account(&database, &token)?;
    Ok(InstallationAccess {
        steward: organizations::is_workspace_steward(database.connection(), &account.id)
            .map_err(AppError::from)?,
    })
}

#[tauri::command]
fn list_backups(
    state: State<'_, AppState>,
    token: String,
) -> Result<Vec<BackupSnapshot>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_installation_steward(&database, &token)?;
    backups::list(&state.backup_dir).map_err(AppError::from)
}

#[tauri::command]
fn create_backup(
    state: State<'_, AppState>,
    token: String,
    note: Option<String>,
) -> Result<Vec<BackupSnapshot>, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_installation_steward(&database, &token)?;
    backups::create(
        database.connection(),
        &state.backup_dir,
        "manual",
        note.as_deref().unwrap_or("Manual snapshot"),
    )
    .map_err(AppError::from)?;
    backups::list(&state.backup_dir).map_err(AppError::from)
}

#[tauri::command]
fn restore_backup(
    state: State<'_, AppState>,
    token: String,
    id: String,
) -> Result<BackupRestoreResult, AppError> {
    let mut database = state.database.lock().map_err(|_| lock_error())?;
    require_installation_steward(&database, &token)?;
    backups::restore(database.connection_mut(), &state.backup_dir, &id).map_err(AppError::from)
}

/// Writes a sealed copy the coordinator chooses where to keep — a second disk,
/// a safe, a teammate's machine — without the file being readable in transit.
#[tauri::command]
fn export_encrypted_backup(
    state: State<'_, AppState>,
    token: String,
    path: String,
    passphrase: String,
) -> Result<archive::ExportReceipt, AppError> {
    let database = state.database.lock().map_err(|_| lock_error())?;
    require_installation_steward(&database, &token)?;
    archive::export(
        database.connection(),
        Path::new(&path),
        &passphrase,
        "Encrypted copy",
    )
    .map_err(AppError::from)
}

/// Opens a sealed archive through the same validation a local snapshot passes,
/// so a file that was truncated in transit cannot replace the workspace.
#[tauri::command]
fn import_encrypted_backup(
    state: State<'_, AppState>,
    token: String,
    path: String,
    passphrase: String,
) -> Result<BackupRestoreResult, AppError> {
    let mut database = state.database.lock().map_err(|_| lock_error())?;
    require_installation_steward(&database, &token)?;
    archive::import(
        database.connection_mut(),
        &state.backup_dir,
        Path::new(&path),
        &passphrase,
    )
    .map_err(AppError::from)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // The embedded WebDriver server exists only in debug builds. The plugin is
    // linked in release builds so the capability stays valid, but its server is
    // never started there.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .setup(|app| {
            // The end-to-end suite points this at a throwaway directory so a
            // test run never opens (or resets) the real workspace.
            let data_dir = match std::env::var_os("CIVICFLOW_DATA_DIR") {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            // Startup never invents records. A new installation is empty until
            // the person creates an organization or explicitly opens the demo.
            // The workspace is SQLCipher-encrypted with this machine's key; a
            // plaintext file from an earlier build is rewritten on the way in.
            // `AppError` is shaped for the webview, not for a startup failure, so
            // its message is carried into the boxed error the setup hook returns.
            let key = workspace_key().map_err(|error| std::io::Error::other(error.message))?;
            let database = Database::open_with_key(data_dir.join("civicflow.db"), key)?;
            let backup_dir = data_dir.join("backups");
            if backups::list(&backup_dir)?.is_empty() {
                backups::create(
                    database.connection(),
                    &backup_dir,
                    "automatic",
                    "Initial workspace snapshot",
                )?;
            }
            app.manage(AppState {
                database: Mutex::new(database),
                backup_dir,
            });
            Ok(())
        })
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            save_cloud_session,
            load_cloud_session,
            clear_cloud_session,
            sign_in,
            sign_in_with_hosted,
            open_demo_workspace,
            create_account,
            remember_hosted_handoff,
            hosted_handoff_pending,
            clear_hosted_handoff,
            take_hosted_link,
            sign_out,
            current_user,
            list_accounts,
            reset_password,
            list_my_organizations,
            list_public_organizations,
            create_organization,
            update_organization,
            select_organization,
            list_organization_members,
            list_organization_invites,
            create_organization_invite,
            revoke_organization_invite,
            redeem_organization_invite,
            join_public_organization,
            set_organization_member_role,
            set_organization_member_status,
            transfer_organization_ownership,
            get_mission_control,
            list_notifications,
            mark_notification_read,
            get_workspace_snapshot,
            auto_roster,
            evaluate_roster_candidates,
            apply_roster_plan,
            apply_roster_week,
            manual_check_in,
            get_roster_policy,
            update_roster_policy,
            explain_roster_choice,
            detect_disruptions,
            plan_recovery,
            apply_recovery,
            set_assignment_lock,
            create_shift_series,
            list_shift_series,
            generate_series_instances,
            retime_shift_series,
            delete_shift_series,
            recommend_replacement,
            list_notification_rules,
            update_notification_rule,
            queue_due_reminders,
            retention_signals,
            volunteer_insight,
            engagement_metrics,
            credential_readiness,
            save_report_view,
            set_saved_opportunity,
            set_application_stage,
            checkin_window,
            get_checkin_code,
            check_in_volunteer,
            check_out_volunteer,
            mark_volunteer_no_show,
            cancel_registration,
            join_waitlist,
            promote_waitlist,
            review_hours,
            update_workspace_settings,
            create_opportunity,
            register_for_shift,
            save_volunteer_profile,
            reset_demo,
            generate_report,
            export_report,
            preview_volunteer_import,
            apply_volunteer_import,
            export_volunteer_roster,
            installation_access,
            list_backups,
            create_backup,
            restore_backup,
            export_encrypted_backup,
            import_encrypted_backup
        ])
        .build(tauri::generate_context!())
        .expect("CivicFlow failed to launch");

    // The scheme URL belongs to the event, not to the window: macOS can deliver
    // it before the page that needs it has loaded, and a reload would lose a
    // value that only ever existed in the address bar. Record it first so the
    // callback page can ask for it whenever it is ready.
    #[cfg(desktop)]
    {
        let handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
            let state = handle.state::<AppState>();
            let Ok(database) = state.database.lock() else {
                return;
            };
            for url in event.urls() {
                let _ = auth::store_hosted_link(database.connection(), url.as_str());
            }
        });
    }

    app.run(|_, _| {});
}

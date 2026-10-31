//! The command envelope every replica speaks.
//!
//! This mirrors `src/lib/sync/protocol.ts` and is tested against the same
//! fixture files in `shared/sync-contract`. A field that exists on only one
//! side is a protocol bug, not an implementation detail.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const SYNC_CONTRACT_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommandType {
    CreateOpportunity,
    UpdateOpportunity,
    CreateShift,
    UpdateShift,
    RegisterForShift,
    CancelRegistration,
    JoinWaitlist,
    CheckIn,
    CheckOut,
    MarkNoShow,
    SaveVolunteerProfile,
    UpdateCredential,
    ReviewHours,
    UpdateRosterPolicy,
    ApplyRosterPlan,
}

impl CommandType {
    /// The exact spelling stored in the outbox and sent to `apply_command`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CreateOpportunity => "CREATE_OPPORTUNITY",
            Self::UpdateOpportunity => "UPDATE_OPPORTUNITY",
            Self::CreateShift => "CREATE_SHIFT",
            Self::UpdateShift => "UPDATE_SHIFT",
            Self::RegisterForShift => "REGISTER_FOR_SHIFT",
            Self::CancelRegistration => "CANCEL_REGISTRATION",
            Self::JoinWaitlist => "JOIN_WAITLIST",
            Self::CheckIn => "CHECK_IN",
            Self::CheckOut => "CHECK_OUT",
            Self::MarkNoShow => "MARK_NO_SHOW",
            Self::SaveVolunteerProfile => "SAVE_VOLUNTEER_PROFILE",
            Self::UpdateCredential => "UPDATE_CREDENTIAL",
            Self::ReviewHours => "REVIEW_HOURS",
            Self::UpdateRosterPolicy => "UPDATE_ROSTER_POLICY",
            Self::ApplyRosterPlan => "APPLY_ROSTER_PLAN",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandEnvelope {
    pub operation_id: String,
    pub replica_id: String,
    /// The account that created the work. The server still authenticates the
    /// request; this copy proves which person queued it.
    pub user_id: String,
    pub organization_id: String,
    pub command: CommandType,
    pub membership_epoch: i64,
    pub base_workspace_revision: i64,
    #[serde(default)]
    pub entity_versions: BTreeMap<String, i64>,
    pub payload: Value,
    pub client_created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandFixture {
    pub scenario: String,
    pub envelope: CommandEnvelope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeOperation {
    Insert,
    Update,
    Delete,
}

/// One row from `pull_changes`. A delete carries no payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub sequence: i64,
    pub entity: String,
    pub id: String,
    pub operation: ChangeOperation,
    #[serde(default)]
    pub row_version: Option<i64>,
    #[serde(default)]
    pub payload: Option<Value>,
}

impl CommandEnvelope {
    /// A cheap structural check before the envelope is queued. It does not
    /// decide authorization; the authority does that.
    pub fn is_bindable(&self) -> bool {
        Uuid::parse_str(&self.operation_id).is_ok()
            && Uuid::parse_str(&self.replica_id).is_ok()
            && Uuid::parse_str(&self.user_id).is_ok()
            && Uuid::parse_str(&self.organization_id).is_ok()
            && self.membership_epoch > 0
            && self.base_workspace_revision >= 0
            && self.payload.get("membershipEpoch").and_then(Value::as_i64)
                == Some(self.membership_epoch)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    const FIXTURES: [&str; 6] = [
        "register-shift",
        "update-shift",
        "stale-plan",
        "attendance",
        "membership-revoked",
        "capacity-race",
    ];

    fn fixture(name: &str) -> CommandFixture {
        let path: PathBuf = [
            env!("CARGO_MANIFEST_DIR"),
            "..",
            "..",
            "shared",
            "sync-contract",
            &format!("{name}.json"),
        ]
        .iter()
        .collect();
        let text = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display()));
        serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("could not parse {}: {error}", path.display()))
    }

    #[test]
    fn every_fixture_deserializes_and_is_bound() {
        assert_eq!(SYNC_CONTRACT_VERSION, 1);
        for name in FIXTURES {
            let parsed = fixture(name);
            assert!(parsed.scenario.len() > 20, "{name} has no useful scenario");
            assert!(parsed.envelope.is_bindable(), "{name} is not bindable");
        }
    }

    #[test]
    fn operation_ids_are_distinct() {
        let mut ids = std::collections::BTreeSet::new();
        for name in FIXTURES {
            assert!(
                ids.insert(fixture(name).envelope.operation_id),
                "{name} reuses an operation id"
            );
        }
    }

    #[test]
    fn command_names_match_the_wire_spelling() {
        let cases = [
            ("register-shift", CommandType::RegisterForShift),
            ("update-shift", CommandType::UpdateShift),
            ("stale-plan", CommandType::ApplyRosterPlan),
            ("attendance", CommandType::CheckIn),
            ("membership-revoked", CommandType::UpdateOpportunity),
            ("capacity-race", CommandType::RegisterForShift),
        ];
        for (name, expected) in cases {
            assert_eq!(fixture(name).envelope.command, expected, "{name}");
        }
    }

    #[test]
    fn an_unknown_command_is_not_accepted() {
        let mut raw = serde_json::to_value(fixture("update-shift")).expect("fixture");
        raw["envelope"]["command"] = Value::String("DELETE_EVERYTHING".into());
        assert!(serde_json::from_value::<CommandFixture>(raw).is_err());
    }

    #[test]
    fn an_unbound_envelope_is_refused_before_it_is_queued() {
        let mut parsed = fixture("register-shift");
        parsed.envelope.user_id = String::new();
        assert!(!parsed.envelope.is_bindable());

        let mut mismatched = fixture("attendance");
        mismatched.envelope.membership_epoch += 1;
        assert!(!mismatched.envelope.is_bindable());
    }
}

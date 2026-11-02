//! Adapts synchronized replica rows to the same planner AutoRoster uses.
//!
//! The replica is stored as server JSON, not as the local SQLite tables, so
//! this module does the one translation the shared screens need. Eligibility,
//! scoring, flow, and explanations stay in `matching`/`explain`; none of that
//! logic is repeated here.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::error::{CoreError, Result};
use crate::explain::{self, CandidateAnswer};
use crate::matching::{
    self, day_key, Candidate, Credential, RosterEvaluation, RosterOptions, RosterPlan, Slot,
    TimeBlock,
};
use crate::policy::RosterPolicy;
use crate::sync::replica;

fn rows(conn: &Connection, organization_id: &str, entity: &str) -> Result<Vec<Value>> {
    let mut statement = conn.prepare(
        "SELECT payload FROM replica_entities
         WHERE organization_id = ?1 AND entity_type = ?2 AND deleted = 0
           AND payload IS NOT NULL
         ORDER BY entity_id",
    )?;
    let values = statement.query_map(params![organization_id, entity], |row| {
        row.get::<_, String>(0)
    })?;
    let mut parsed = Vec::new();
    for value in values {
        let text = value?;
        parsed.push(
            serde_json::from_str(&text)
                .map_err(|error| CoreError::Data(format!("replica row is invalid: {error}")))?,
        );
    }
    Ok(parsed)
}

fn text<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    row.get(key).and_then(Value::as_str)
}

fn number(row: &Value, key: &str) -> i64 {
    row.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn optional_number(row: &Value, key: &str) -> Option<i64> {
    row.get(key).and_then(Value::as_i64)
}

fn date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.get(..10).unwrap_or(value), "%Y-%m-%d").ok()
}

fn datetime(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value).ok()
}

fn strings(value: &Value) -> Vec<String> {
    let Some(value) = value.as_array() else {
        return Vec::new();
    };
    value
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn strings_or_json(row: &Value, key: &str) -> Vec<String> {
    match row.get(key) {
        Some(Value::Array(_)) => strings(row.get(key).expect("the array was just matched")),
        Some(Value::String(raw)) => serde_json::from_str::<Value>(raw)
            .ok()
            .map(|value| strings(&value))
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn insert_availability(raw: &str, out: &mut HashSet<String>) {
    if let Some((day, period)) = raw.split_once(':') {
        if !day.is_empty() && !period.is_empty() {
            out.insert(format!("{day}:{period}"));
        }
    }
}

fn collect_availability(value: Option<&Value>, out: &mut HashSet<String>) {
    match value {
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(raw) = item.as_str() {
                    insert_availability(raw, out);
                } else if let (Some(day), Some(period)) = (
                    item.get("day").and_then(Value::as_str),
                    item.get("period").and_then(Value::as_str),
                ) {
                    out.insert(format!("{day}:{period}"));
                }
            }
        }
        Some(Value::String(raw)) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                collect_availability(Some(&parsed), out);
            } else {
                insert_availability(raw, out);
            }
        }
        _ => {}
    }
}

fn policy(conn: &Connection, organization_id: &str) -> Result<RosterPolicy> {
    let rows = rows(conn, organization_id, "roster_policy")?;
    let Some(row) = rows.iter().max_by_key(|row| number(row, "version")) else {
        return Ok(RosterPolicy::default());
    };
    let Some(stored) = row.get("policy") else {
        return Ok(RosterPolicy::default());
    };
    let mut parsed: RosterPolicy = serde_json::from_value(stored.clone())
        .map_err(|error| CoreError::Data(format!("roster policy is invalid: {error}")))?;
    if let Some(version) = optional_number(row, "version") {
        parsed.version = version;
    }
    Ok(parsed)
}

fn load_candidates(
    conn: &Connection,
    organization_id: &str,
    now: DateTime<FixedOffset>,
    options: &RosterOptions,
) -> Result<Vec<Candidate>> {
    let volunteers = rows(conn, organization_id, "volunteer")?;
    let skills_rows = rows(conn, organization_id, "volunteer_skill")?;
    let availability_rows = rows(conn, organization_id, "availability_rule")?;
    let credential_rows = rows(conn, organization_id, "credential")?;
    let credential_types = rows(conn, organization_id, "credential_type")?;
    let shifts = rows(conn, organization_id, "shift")?;
    let registrations = rows(conn, organization_id, "registration")?;
    let waitlists = rows(conn, organization_id, "waitlist_entry")?;

    let shift_by_id: HashMap<&str, &Value> = shifts
        .iter()
        .filter_map(|row| text(row, "id").map(|id| (id, row)))
        .collect();
    let type_names: HashMap<&str, &str> = credential_types
        .iter()
        .filter_map(|row| Some((text(row, "id")?, text(row, "name")?)))
        .collect();

    let mut skills: HashMap<String, Vec<String>> = HashMap::new();
    for row in &skills_rows {
        if let (Some(volunteer), Some(skill)) = (text(row, "volunteer_id"), text(row, "skill")) {
            skills
                .entry(volunteer.to_string())
                .or_default()
                .push(skill.to_string());
        }
    }

    let mut availability: HashMap<String, HashSet<String>> = HashMap::new();
    for row in &availability_rows {
        if let (Some(volunteer), Some(day), Some(period)) = (
            text(row, "volunteer_id"),
            text(row, "day"),
            text(row, "period"),
        ) {
            availability
                .entry(volunteer.to_string())
                .or_default()
                .insert(format!("{day}:{period}"));
        }
    }

    let mut credentials: HashMap<String, Vec<Credential>> = HashMap::new();
    for row in &credential_rows {
        let (Some(volunteer), Some(type_id), Some(valid_through)) = (
            text(row, "volunteer_id"),
            text(row, "credential_type_id"),
            text(row, "valid_through"),
        ) else {
            continue;
        };
        let (Some(name), Some(valid_through)) = (type_names.get(type_id), date(valid_through))
        else {
            continue;
        };
        credentials
            .entry(volunteer.to_string())
            .or_default()
            .push(Credential {
                name: (*name).to_string(),
                valid_through,
            });
    }

    let horizon = now + Duration::days(7);
    let mut assigned_blocks: HashMap<String, Vec<TimeBlock>> = HashMap::new();
    let mut assigned_shifts: HashMap<String, HashSet<String>> = HashMap::new();
    let mut weekly_load: HashMap<String, i64> = HashMap::new();
    let mut weekly_minutes: HashMap<String, i64> = HashMap::new();
    for row in &registrations {
        if !matches!(text(row, "status"), Some("registered" | "confirmed")) {
            continue;
        }
        let (Some(volunteer), Some(shift_id)) = (text(row, "volunteer_id"), text(row, "shift_id"))
        else {
            continue;
        };
        let Some(shift) = shift_by_id.get(shift_id) else {
            continue;
        };
        let (Some(starts), Some(ends)) = (
            text(shift, "starts_at").and_then(datetime),
            text(shift, "ends_at").and_then(datetime),
        ) else {
            continue;
        };
        assigned_shifts
            .entry(volunteer.to_string())
            .or_default()
            .insert(shift_id.to_string());
        assigned_blocks
            .entry(volunteer.to_string())
            .or_default()
            .push(TimeBlock {
                starts_at: starts,
                ends_at: ends,
            });
        if starts >= now && starts <= horizon {
            *weekly_load.entry(volunteer.to_string()).or_insert(0) += 1;
            *weekly_minutes.entry(volunteer.to_string()).or_insert(0) +=
                (ends - starts).num_minutes().max(0);
        }
    }

    let mut waitlisted: HashMap<String, HashSet<String>> = HashMap::new();
    for row in &waitlists {
        if text(row, "status") != Some("waiting") {
            continue;
        }
        if let (Some(volunteer), Some(shift)) = (text(row, "volunteer_id"), text(row, "shift_id")) {
            waitlisted
                .entry(volunteer.to_string())
                .or_default()
                .insert(shift.to_string());
        }
    }

    let mut candidates = Vec::new();
    for row in &volunteers {
        if text(row, "status") != Some("active") {
            continue;
        }
        let Some(id) = text(row, "id") else {
            continue;
        };
        let waitlist = waitlisted.remove(id).unwrap_or_default();
        if !options.include_waitlist && !waitlist.is_empty() {
            continue;
        }
        let mut available = availability.remove(id).unwrap_or_default();
        if available.is_empty() {
            collect_availability(row.get("availability"), &mut available);
        }
        candidates.push(Candidate {
            id: id.to_string(),
            name: text(row, "name").unwrap_or("Volunteer").to_string(),
            initials: text(row, "initials").unwrap_or("").to_string(),
            skills: skills.remove(id).unwrap_or_default(),
            languages: strings_or_json(row, "languages"),
            causes: strings_or_json(row, "causes"),
            availability: available,
            birthdate: text(row, "birthdate").and_then(date),
            attendance_rate: number(row, "attendance_rate"),
            events_completed: number(row, "events_completed"),
            credentials: credentials.remove(id).unwrap_or_default(),
            assigned_blocks: assigned_blocks.remove(id).unwrap_or_default(),
            assigned_shift_ids: assigned_shifts.remove(id).unwrap_or_default(),
            waitlisted_shift_ids: waitlist,
            weekly_load: weekly_load.remove(id).unwrap_or(0),
            weekly_minutes: weekly_minutes.remove(id).unwrap_or(0),
        });
    }
    Ok(candidates)
}

fn load_slots(
    conn: &Connection,
    organization_id: &str,
    shift_ids: &[String],
    now: DateTime<FixedOffset>,
) -> Result<Vec<Slot>> {
    let shifts = rows(conn, organization_id, "shift")?;
    let opportunities = rows(conn, organization_id, "opportunity")?;
    let roles = rows(conn, organization_id, "shift_role")?;
    let requirements = rows(conn, organization_id, "role_requirement")?;
    let credential_types = rows(conn, organization_id, "credential_type")?;

    let opportunity_by_id: HashMap<&str, &Value> = opportunities
        .iter()
        .filter_map(|row| text(row, "id").map(|id| (id, row)))
        .collect();
    let type_names: HashMap<&str, &str> = credential_types
        .iter()
        .filter_map(|row| Some((text(row, "id")?, text(row, "name")?)))
        .collect();
    let requirement_by_key: HashMap<(String, String), &Value> = requirements
        .iter()
        .filter_map(|row| {
            Some((
                (
                    text(row, "shift_id")?.to_string(),
                    text(row, "role_name")?.to_string(),
                ),
                row,
            ))
        })
        .collect();

    let mut slots = Vec::new();
    for shift in &shifts {
        if text(shift, "status") != Some("scheduled") {
            continue;
        }
        let Some(shift_id) = text(shift, "id") else {
            continue;
        };
        if !shift_ids.is_empty() && !shift_ids.iter().any(|id| id == shift_id) {
            continue;
        }
        let (Some(starts_at), Some(ends_at)) = (
            text(shift, "starts_at").and_then(datetime),
            text(shift, "ends_at").and_then(datetime),
        ) else {
            continue;
        };
        if starts_at <= now {
            continue;
        }
        let opportunity =
            text(shift, "opportunity_id").and_then(|id| opportunity_by_id.get(id).copied());
        let opportunity_id = text(shift, "opportunity_id").unwrap_or("").to_string();
        let shift_title = opportunity
            .and_then(|row| text(row, "title"))
            .unwrap_or("Shift")
            .to_string();
        let cause = opportunity
            .and_then(|row| text(row, "cause"))
            .unwrap_or("")
            .to_string();

        for role in roles
            .iter()
            .filter(|row| text(row, "shift_id") == Some(shift_id))
        {
            let Some(role_name) = text(role, "name") else {
                continue;
            };
            let required = number(role, "required");
            let filled = number(role, "filled");
            let open = (required - filled).max(0);
            if open == 0 {
                continue;
            }
            let requirement =
                requirement_by_key.get(&(shift_id.to_string(), role_name.to_string()));
            let required_skill = requirement
                .and_then(|row| text(row, "skill"))
                .map(str::to_string);
            let required_credential = requirement
                .and_then(|row| text(row, "credential_type_id"))
                .and_then(|id| type_names.get(id).copied())
                .map(str::to_string);
            let minimum_age = requirement.and_then(|row| optional_number(row, "minimum_age"));
            let mandatory =
                required_skill.is_some() || required_credential.is_some() || minimum_age.is_some();
            for index in 1..=open {
                slots.push(Slot {
                    id: format!("{shift_id}-{role_name}-{index}"),
                    shift_id: shift_id.to_string(),
                    opportunity_id: opportunity_id.clone(),
                    shift_title: shift_title.clone(),
                    role: role_name.to_string(),
                    cause: cause.clone(),
                    day_key: day_key(starts_at.date_naive()),
                    starts_at,
                    ends_at,
                    mandatory,
                    required_skill: required_skill.clone(),
                    required_credential: required_credential.clone(),
                    minimum_age,
                });
            }
        }
    }
    Ok(slots)
}

/// The shared screen's plan and the exact explanation AutoRoster shows.
pub fn evaluate_roster(
    conn: &Connection,
    organization_id: &str,
    shift_ids: &[String],
    options: &RosterOptions,
) -> Result<RosterEvaluation> {
    let now = Utc::now().fixed_offset();
    let policy = policy(conn, organization_id)?;
    let slots = load_slots(conn, organization_id, shift_ids, now)?;
    let candidates = load_candidates(conn, organization_id, now, options)?;
    let mut evaluation = matching::evaluate_roster(&candidates, &slots, &policy, options);
    evaluation.generated_at = now.to_rfc3339();
    evaluation.revision = replica::read_revision(conn, organization_id)?;
    evaluation.plan.generated_at = evaluation.generated_at.clone();
    evaluation.plan.revision = evaluation.revision;
    Ok(evaluation)
}

/// Why this person, or why not that one, using the same adapter.
pub fn explain_candidate(
    conn: &Connection,
    organization_id: &str,
    shift_ids: &[String],
    options: &RosterOptions,
    candidate_id: &str,
    slot_id: &str,
) -> Result<CandidateAnswer> {
    let now = Utc::now().fixed_offset();
    let policy = policy(conn, organization_id)?;
    let slots = load_slots(conn, organization_id, shift_ids, now)?;
    let candidates = load_candidates(conn, organization_id, now, options)?;
    explain::explain_candidate(&candidates, &slots, &policy, options, candidate_id, slot_id)
}

/// Kept for callers that only need the plan; it is the same evaluation above.
pub fn plan_roster(
    conn: &Connection,
    organization_id: &str,
    shift_ids: &[String],
    options: &RosterOptions,
) -> Result<RosterPlan> {
    Ok(evaluate_roster(conn, organization_id, shift_ids, options)?.plan)
}

//! What coverage rescue does when a roster breaks: what it detects, what it will
//! not touch, and what one approved write changes.

use chrono::{DateTime, FixedOffset};
use civicflow_core::auth::Account;
use civicflow_core::matching::RosterOptions;
use civicflow_core::recovery::{self, RecoveryChangeKind, RecoveryChangeRequest};
use civicflow_core::Database;
use rusqlite::{params, Connection};

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

fn actor() -> Account {
    Account {
        id: "user-coordinator".into(),
        name: "Praket Gauri".into(),
        email: "praket@example.org".into(),
        role: "coordinator".into(),
        volunteer_id: None,
    }
}

fn now(conn: &Connection) -> DateTime<FixedOffset> {
    let raw: String = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'workspace_clock'",
            [],
            |row| row.get(0),
        )
        .expect("demo clock");
    DateTime::parse_from_rfc3339(&raw).expect("rfc3339 clock")
}

/// A required seat on a future shift that is exactly full, so taking the
/// volunteer out of it opens one seat.
struct Seat {
    shift_id: String,
    role: String,
    volunteer_id: String,
    volunteer_name: String,
}

fn a_filled_required_seat(database: &Database) -> Seat {
    let conn = database.connection();
    let now = now(conn);
    let mut statement = conn
        .prepare(
            "SELECT r.shift_id, r.role, r.volunteer_id, v.name, s.starts_at
             FROM registrations r
             JOIN shifts s ON s.id = r.shift_id
             JOIN volunteers v ON v.id = r.volunteer_id
             JOIN shift_roles sr ON sr.shift_id = r.shift_id AND sr.name = r.role
             JOIN role_requirements rr ON rr.shift_id = r.shift_id AND rr.role_name = r.role
             WHERE r.status = 'registered' AND s.status = 'scheduled'
               AND sr.required = sr.filled
             ORDER BY s.starts_at, r.volunteer_id",
        )
        .expect("query");
    let mut rows = statement.query([]).expect("rows");
    while let Some(row) = rows.next().expect("row") {
        let starts: String = row.get(4).expect("starts_at");
        let Ok(starts_at) = DateTime::parse_from_rfc3339(&starts) else {
            continue;
        };
        if starts_at <= now {
            continue;
        }
        return Seat {
            shift_id: row.get(0).expect("shift"),
            role: row.get(1).expect("role"),
            volunteer_id: row.get(2).expect("volunteer"),
            volunteer_name: row.get(3).expect("name"),
        };
    }
    panic!("the seed has a filled required seat on a future shift");
}

/// Takes one volunteer out of the seat the way a cancellation does, so the
/// disruption under test is the roster's state rather than a fiction.
fn vacate(database: &Database, seat: &Seat) {
    let conn = database.connection();
    conn.execute(
        "UPDATE registrations SET status = 'canceled'
         WHERE shift_id = ?1 AND volunteer_id = ?2",
        params![seat.shift_id, seat.volunteer_id],
    )
    .expect("cancel registration");
    conn.execute(
        "UPDATE shift_roles SET filled = filled - 1
         WHERE shift_id = ?1 AND name = ?2",
        params![seat.shift_id, seat.role],
    )
    .expect("unfill role");
    conn.execute(
        "UPDATE shifts SET confirmed = confirmed - 1 WHERE id = ?1",
        params![seat.shift_id],
    )
    .expect("unconfirm");
}

#[test]
fn credential_risk_stays_inside_the_open_organization() {
    let database = seeded();
    let conn = database.connection();
    let clock = now(conn);

    let (shift_id, volunteer_id, credential_type): (String, String, String) = conn
        .query_row(
            "SELECT r.shift_id, r.volunteer_id, rr.credential_type_id
             FROM registrations r
             JOIN shifts s ON s.id = r.shift_id
             JOIN role_requirements rr ON rr.shift_id = r.shift_id AND rr.role_name = r.role
             WHERE r.status = 'registered' AND s.status = 'scheduled' AND s.starts_at > ?1
               AND rr.credential_type_id IS NOT NULL
             ORDER BY s.starts_at LIMIT 1",
            [clock.to_rfc3339()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("a future assignment that needs a credential");

    conn.execute(
        "INSERT INTO volunteer_credentials
         (id, volunteer_id, credential_type_id, identifier, issued_at, valid_from, valid_through)
         VALUES ('cred-risk-test', ?1, ?2, 'RISK-TEST', '2000-01-01', '2000-01-01', '2000-01-01')",
        params![volunteer_id, credential_type],
    )
    .expect("an expired credential");

    let home = recovery::detect(conn).expect("detect in the home organization");
    assert!(home
        .at_risk
        .iter()
        .any(|row| row.shift_id == shift_id && row.volunteer_id == volunteer_id));

    conn.execute(
        "INSERT INTO organizations
         (id, name, initials, mission, city, state, address, website, email, timezone, created_at)
         VALUES ('org-foreign', 'Harbor Lights', 'HL', '', 'Erie', 'PA', '', '', '',
                 'America/New_York', '2030-01-01T00:00:00+00:00')",
        [],
    )
    .expect("a second organization");

    civicflow_core::scope::select(conn, Some("org-foreign")).expect("scope the other organization");
    let foreign = recovery::detect(conn).expect("detect in the other organization");
    assert!(foreign.shifts.is_empty());
    assert!(
        foreign.at_risk.is_empty(),
        "another organization's credential risk is not this one's to read"
    );
}

#[test]
fn detection_names_the_open_required_seat_and_why() {
    let database = seeded();
    let seat = a_filled_required_seat(&database);
    vacate(&database, &seat);

    let report = recovery::detect(database.connection()).expect("detect");
    let shift = report
        .shifts
        .iter()
        .find(|item| item.shift_id == seat.shift_id)
        .expect("the disrupted shift");
    let role = shift
        .roles
        .iter()
        .find(|item| item.role == seat.role)
        .expect("the open role");
    assert_eq!(role.open, 1);
    assert_eq!(role.filled, role.required - 1);
    assert!(shift
        .reasons
        .iter()
        .any(|reason| reason.contains("canceled")));
    assert!(report.open_required >= 1);
    assert_eq!(report.now, now(database.connection()).to_rfc3339());
}

#[test]
fn a_credential_that_will_have_expired_is_reported_before_the_shift() {
    let database = seeded();
    let conn = database.connection();
    let now = now(conn);
    let mut statement = conn
        .prepare(
            "SELECT r.shift_id, r.volunteer_id, ct.name, s.starts_at
             FROM registrations r
             JOIN shifts s ON s.id = r.shift_id
             JOIN role_requirements rr ON rr.shift_id = r.shift_id AND rr.role_name = r.role
             JOIN credential_types ct ON ct.id = rr.credential_type_id
             JOIN volunteer_credentials vc
               ON vc.volunteer_id = r.volunteer_id AND vc.credential_type_id = ct.id
             WHERE r.status = 'registered' AND s.status = 'scheduled'
             ORDER BY s.starts_at",
        )
        .expect("query");
    let mut rows = statement.query([]).expect("rows");
    let mut picked = None;
    while let Some(row) = rows.next().expect("row") {
        let starts: String = row.get(3).expect("starts_at");
        if let Ok(starts_at) = DateTime::parse_from_rfc3339(&starts) {
            if starts_at > now {
                picked = Some((
                    row.get::<_, String>(0).expect("shift"),
                    row.get::<_, String>(1).expect("volunteer"),
                    row.get::<_, String>(2).expect("credential"),
                ));
                break;
            }
        }
    }
    let (shift_id, volunteer_id, credential) = picked.expect("a credentialed future assignment");
    drop(rows);
    drop(statement);
    conn.execute(
        "UPDATE volunteer_credentials SET valid_through = '2000-01-01'
         WHERE volunteer_id = ?1
           AND credential_type_id = (SELECT id FROM credential_types WHERE name = ?2)",
        params![volunteer_id, credential],
    )
    .expect("expire credential");

    let report = recovery::detect(conn).expect("detect");
    let at_risk = report
        .at_risk
        .iter()
        .find(|item| item.shift_id == shift_id && item.volunteer_id == volunteer_id)
        .expect("the assignment at risk");
    assert_eq!(at_risk.credential, credential);
    assert!(at_risk.expired);
    assert_eq!(at_risk.valid_through.as_deref(), Some("2000-01-01"));
}

#[test]
fn a_plan_covers_the_open_seat_without_moving_anybody() {
    let database = seeded();
    let seat = a_filled_required_seat(&database);
    vacate(&database, &seat);

    let options = RosterOptions {
        include_waitlist: true,
        ..RosterOptions::default()
    };
    let plan = recovery::plan(
        database.connection(),
        std::slice::from_ref(&seat.shift_id),
        &options,
    )
    .expect("plan");

    assert_eq!(plan.open_before, 1);
    assert_eq!(plan.open_after, 0);
    assert!(plan.remaining.is_empty());
    let change = plan
        .changes
        .iter()
        .find(|item| item.role == seat.role)
        .expect("the required seat is covered");
    assert_eq!(change.cost, 0);
    assert_ne!(change.volunteer_id, seat.volunteer_id);
    assert!(matches!(
        change.kind,
        RecoveryChangeKind::Assign | RecoveryChangeKind::Promote
    ));
    assert!(!change.reason.is_empty());
    // Every move in a plan arrives with the assignment that refills the seat it
    // vacated, so coverage can never drop because of one.
    assert_eq!(
        plan.changes
            .iter()
            .filter(|item| item.kind == RecoveryChangeKind::Move)
            .count() as i64,
        plan.moved_assignments
    );
}

#[test]
fn an_approved_recovery_is_one_audited_write() {
    let database = seeded();
    let seat = a_filled_required_seat(&database);
    vacate(&database, &seat);
    let options = RosterOptions {
        include_waitlist: true,
        ..RosterOptions::default()
    };
    let plan = recovery::plan(
        database.connection(),
        std::slice::from_ref(&seat.shift_id),
        &options,
    )
    .expect("plan");
    let requests: Vec<RecoveryChangeRequest> = plan
        .changes
        .iter()
        .map(|change| RecoveryChangeRequest {
            volunteer_id: change.volunteer_id.clone(),
            role: change.role.clone(),
            from_role: change.from_role.clone(),
            promote_waitlist: change.kind == RecoveryChangeKind::Promote,
        })
        .collect();

    let state =
        recovery::apply(database.connection(), &actor(), &seat.shift_id, &requests).expect("apply");

    assert!(state
        .audit
        .iter()
        .any(|event| event.action == "recovery.apply"));
    assert!(state
        .audit
        .iter()
        .any(|event| event.actor == "Praket Gauri"));
    let (required, filled): (i64, i64) = database
        .connection()
        .query_row(
            "SELECT required, filled FROM shift_roles WHERE shift_id = ?1 AND name = ?2",
            params![seat.shift_id, seat.role],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("role counts");
    assert_eq!(filled, required);
    let registered: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM registrations
             WHERE shift_id = ?1 AND status = 'registered'",
            params![seat.shift_id],
            |row| row.get(0),
        )
        .expect("registrations");
    assert_eq!(
        registered,
        state
            .registrations
            .iter()
            .filter(|row| { row.shift_id == seat.shift_id && row.status == "registered" })
            .count() as i64
    );
}

#[test]
fn a_change_that_no_longer_fits_is_refused_without_writing_anything() {
    let database = seeded();
    let seat = a_filled_required_seat(&database);
    vacate(&database, &seat);
    let before: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM registrations WHERE shift_id = ?1 AND status = 'registered'",
            params![seat.shift_id],
            |row| row.get(0),
        )
        .expect("count");

    // The volunteer who canceled cannot be re-added by claiming to move them.
    let refused = recovery::apply(
        database.connection(),
        &actor(),
        &seat.shift_id,
        &[RecoveryChangeRequest {
            volunteer_id: seat.volunteer_id.clone(),
            role: seat.role.clone(),
            from_role: Some(seat.role.clone()),
            promote_waitlist: false,
        }],
    );
    assert!(refused.is_err());

    let after: i64 = database
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM registrations WHERE shift_id = ?1 AND status = 'registered'",
            params![seat.shift_id],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(before, after);
}

#[test]
fn a_locked_assignment_is_held_still_and_the_lock_is_audited() {
    let database = seeded();
    let seat = a_filled_required_seat(&database);
    let conn = database.connection();

    // The shift grows by one seat, which is one of the ways a roster breaks. The
    // refusal under test is then the lock, not a full role.
    let other_role: String = conn
        .query_row(
            "SELECT name FROM shift_roles WHERE shift_id = ?1 AND name <> ?2 ORDER BY rowid LIMIT 1",
            params![seat.shift_id, seat.role],
            |row| row.get(0),
        )
        .expect("a second role on the shift");
    conn.execute(
        "UPDATE shift_roles SET required = required + 1 WHERE shift_id = ?1 AND name = ?2",
        params![seat.shift_id, other_role],
    )
    .expect("open a seat");

    recovery::set_lock(conn, &actor(), &seat.shift_id, &seat.volunteer_id, true).expect("lock");
    let (locked, by): (i64, Option<String>) = conn
        .query_row(
            "SELECT locked, locked_by FROM registrations
             WHERE shift_id = ?1 AND volunteer_id = ?2",
            params![seat.shift_id, seat.volunteer_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("registration");
    assert_eq!(locked, 1);
    assert_eq!(by.as_deref(), Some("Praket Gauri"));

    // A plan may not move the seat a coordinator is holding.
    let refused = recovery::apply(
        conn,
        &actor(),
        &seat.shift_id,
        &[RecoveryChangeRequest {
            volunteer_id: seat.volunteer_id.clone(),
            role: other_role,
            from_role: Some(seat.role.clone()),
            promote_waitlist: false,
        }],
    );
    let error = refused.expect_err("a locked seat cannot be rearranged");
    assert!(error.to_string().contains("locked"));

    recovery::set_lock(conn, &actor(), &seat.shift_id, &seat.volunteer_id, false).expect("unlock");
    let locked: i64 = conn
        .query_row(
            "SELECT locked FROM registrations WHERE shift_id = ?1 AND volunteer_id = ?2",
            params![seat.shift_id, seat.volunteer_id],
            |row| row.get(0),
        )
        .expect("registration");
    assert_eq!(locked, 0);
    assert!(recovery::detect(conn).is_ok());
    let _ = seat.volunteer_name;
}

#[test]
fn a_no_show_opens_a_coverage_gap_and_keeps_that_volunteer_out_of_the_rescue() {
    let database = seeded();
    let connection = database.connection();
    // The pantry shift already has two arrivals on the demo clock, so the
    // no-show case needs a filled seat that nobody has checked into yet.
    let (shift_id, role, volunteer_id): (String, String, String) = connection
        .query_row(
            "SELECT r.shift_id, r.role, r.volunteer_id
             FROM registrations r
             JOIN shifts s ON s.id = r.shift_id
             JOIN shift_roles sr ON sr.shift_id = r.shift_id AND sr.name = r.role
             JOIN role_requirements rr ON rr.shift_id = r.shift_id AND rr.role_name = r.role
             WHERE r.status = 'registered' AND s.status = 'scheduled'
               AND sr.required = sr.filled AND s.id <> 'sh-tue-pantry'
               AND s.starts_at > ?1
               AND NOT EXISTS (SELECT 1 FROM attendance_events a
                               WHERE a.shift_id = r.shift_id
                                 AND a.volunteer_id = r.volunteer_id)
             ORDER BY s.starts_at, r.volunteer_id LIMIT 1",
            [now(connection).to_rfc3339()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("a filled required seat on a future shift");
    let seat = Seat {
        shift_id,
        role,
        volunteer_id,
        volunteer_name: String::new(),
    };

    civicflow_core::workflows::mark_no_show(
        database.connection(),
        &seat.shift_id,
        &seat.volunteer_id,
    )
    .expect("mark the no-show");

    let report = recovery::detect(database.connection()).expect("detect");
    let shift = report
        .shifts
        .iter()
        .find(|item| item.shift_id == seat.shift_id)
        .expect("the disrupted shift");
    let role = shift
        .roles
        .iter()
        .find(|item| item.role == seat.role)
        .expect("the open role");
    assert!(role.open >= 1);
    assert!(shift
        .reasons
        .iter()
        .any(|reason| reason.contains("did not attend")));

    let options = RosterOptions {
        include_waitlist: true,
        ..RosterOptions::default()
    };
    let plan = recovery::plan(
        database.connection(),
        std::slice::from_ref(&seat.shift_id),
        &options,
    )
    .expect("plan the rescue");
    assert!(
        plan.changes
            .iter()
            .all(|change| change.volunteer_id != seat.volunteer_id),
        "somebody who did not turn up is not offered the seat back"
    );
}

//! One installation can hold several organizations, and one account can hold a
//! different membership in each. These tests hold the boundary: the role comes
//! from the organization that is open, and so does every row the snapshot reads.

use civicflow_core::auth::{self, Account};
use civicflow_core::authorization::{require_coordinator, require_membership};
use civicflow_core::error::CoreError;
use civicflow_core::models::{NewOpportunityInput, SettingsPatch};
use civicflow_core::organizations::{
    create_organization, join_as_volunteer, organization_access, require_installation_steward,
    NewOrganization,
};
use civicflow_core::workflows::{create_opportunity, snapshot, update_settings};
use civicflow_core::Database;
use rusqlite::Connection;

fn seeded() -> Database {
    let mut database = Database::in_memory().expect("in-memory database");
    assert!(database.seed_demo_if_empty().expect("seed"));
    database
}

fn account(conn: &Connection, email: &str, name: &str) -> Account {
    auth::create_account(conn, name, email, "kitchen-table-2026")
        .expect("account is created")
        .user
}

fn new_organization(name: &str) -> NewOrganization {
    NewOrganization {
        name: name.into(),
        description: "Neighbours cooking for neighbours.".into(),
        website: "example.org".into(),
        address: "12 Main Street".into(),
        city: "Buffalo".into(),
        state: "NY".into(),
        contact_emails: vec!["hello@example.org".into()],
        image: None,
        image_alt: None,
        visibility: "public".into(),
    }
}

fn rule_code(error: CoreError) -> String {
    match error {
        CoreError::Rule { code, .. } => code,
        other => panic!("expected a rule error, got {other:?}"),
    }
}

/// What the command layer does when somebody switches organization: remember the
/// choice for the account, then scope the connection to it.
fn work_in(conn: &Connection, user_id: &str, organization_id: &str) {
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        [
            format!("active_organization:{user_id}"),
            organization_id.to_string(),
        ],
    )
    .unwrap();
    civicflow_core::scope::select(conn, Some(organization_id)).unwrap();
}

fn workspace_organization(conn: &Connection) -> String {
    conn.query_row(
        "SELECT id FROM organizations ORDER BY created_at, id LIMIT 1",
        [],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn a_signed_in_identity_without_membership_reads_nothing() {
    let database = seeded();
    let conn = database.connection();
    let session = auth::create_account(conn, "New Person", "new@example.org", "kitchen-table-2026")
        .expect("account is created");
    assert_eq!(session.user.role, "none");

    let refused = auth::require_member(conn, &session.token).expect_err("no membership yet");
    assert_eq!(rule_code(refused), "NO_ORGANIZATION");

    // Founding an organization is the way out, and the role follows immediately.
    create_organization(conn, &session.user, &new_organization("Riverside Pantry"))
        .expect("the first organization");
    let member = auth::require_member(conn, &session.token).expect("now a member");
    assert_eq!(member.role, "coordinator");
}

#[test]
fn owner_in_org_a_is_volunteer_in_org_b() {
    let database = seeded();
    let conn = database.connection();
    let owner = account(conn, "owner@example.org", "Alex Rivera");
    let host = account(conn, "host@example.org", "Dana Whitfield");

    let home = create_organization(conn, &owner, &new_organization("Riverside Pantry")).unwrap();
    let other = create_organization(conn, &host, &new_organization("Lakeside Kitchen")).unwrap();
    join_as_volunteer(conn, &owner.id, &other.id).expect("the public roster accepts a volunteer");

    // Riverside: the membership they created is an owner membership.
    work_in(conn, &owner.id, &home.id);
    let session = auth::sign_in(conn, "owner@example.org", "kitchen-table-2026", true).unwrap();
    assert_eq!(session.user.role, "coordinator");
    assert_eq!(
        organization_access(conn, &home.id, &owner.id)
            .unwrap()
            .membership
            .role,
        "owner"
    );
    require_coordinator(conn, &home.id, &owner.id).expect("an owner coordinates their own org");

    // Lakeside: the same person is a volunteer and holds no coordinator power.
    work_in(conn, &owner.id, &other.id);
    let session = auth::sign_in(conn, "owner@example.org", "kitchen-table-2026", true).unwrap();
    assert_eq!(session.user.role, "volunteer");
    let membership = require_membership(conn, &other.id, &owner.id).unwrap();
    assert_eq!(membership.role, "volunteer");
    let error = require_coordinator(conn, &other.id, &owner.id).unwrap_err();
    assert_eq!(rule_code(error), "FORBIDDEN");
}

#[test]
fn switching_org_changes_authoritative_role() {
    let database = seeded();
    let conn = database.connection();
    let owner = account(conn, "owner@example.org", "Alex Rivera");
    let host = account(conn, "host@example.org", "Dana Whitfield");

    let home = create_organization(conn, &owner, &new_organization("Riverside Pantry")).unwrap();
    let other = create_organization(conn, &host, &new_organization("Lakeside Kitchen")).unwrap();
    join_as_volunteer(conn, &owner.id, &other.id).unwrap();

    let first = auth::sign_in(conn, "owner@example.org", "kitchen-table-2026", true).unwrap();
    assert_eq!(first.user.role, "coordinator");

    // Switching is the only thing that changes the answer: the account did not.
    work_in(conn, &owner.id, &other.id);
    let second = auth::sign_in(conn, "owner@example.org", "kitchen-table-2026", true).unwrap();
    assert_eq!(second.user.role, "volunteer");
    assert_eq!(first.user.id, second.user.id, "the same account signed in");

    work_in(conn, &owner.id, &home.id);
    let third = auth::sign_in(conn, "owner@example.org", "kitchen-table-2026", true).unwrap();
    assert_eq!(third.user.role, "coordinator");
}

#[test]
fn snapshot_never_contains_other_org_records() {
    let database = seeded();
    let conn = database.connection();
    let resident = workspace_organization(conn);
    let owner = account(conn, "owner@example.org", "Alex Rivera");
    let host = account(conn, "host@example.org", "Dana Whitfield");
    let home = create_organization(conn, &owner, &new_organization("Riverside Pantry")).unwrap();
    let other = create_organization(conn, &host, &new_organization("Lakeside Kitchen")).unwrap();
    join_as_volunteer(conn, &owner.id, &other.id).unwrap();

    // Lakeside holds only the profile created when this account joined it. None
    // of HomeMore's roster, programs, attendance, or applications come with it.
    work_in(conn, &owner.id, &other.id);
    let empty = snapshot(conn).unwrap();
    assert_eq!(empty.settings.organization_name, "Lakeside Kitchen");
    assert_eq!(empty.roster.len(), 1, "only the person who joined");
    assert_eq!(empty.roster[0].name, "Alex Rivera");
    assert!(empty.registrations.is_empty());
    assert!(empty.attendance.is_empty());
    assert!(empty.created_opportunities.is_empty());
    assert!(empty.applications.is_empty());
    assert!(empty.waitlist.is_empty());
    assert!(
        empty.volunteer_profile.skills.is_empty()
            && empty.volunteer_profile.phone.is_empty()
            && empty.volunteer_profile.causes.is_empty(),
        "a demo profile from the seeded roster is not borrowed"
    );

    work_in(conn, &owner.id, &home.id);
    let scoped = snapshot(conn).unwrap();
    assert_eq!(scoped.settings.organization_name, "Riverside Pantry");
    assert!(scoped.roster.is_empty());

    work_in(conn, &owner.id, &resident);
    let seeded_workspace = snapshot(conn).unwrap();
    assert_eq!(
        seeded_workspace.settings.organization_name,
        "Rivergate Kitchen"
    );
    assert!(!seeded_workspace.roster.is_empty());
    assert!(!seeded_workspace.registrations.is_empty());
}

#[test]
fn creating_opportunity_uses_selected_org() {
    let database = seeded();
    let conn = database.connection();
    let owner = account(conn, "owner@example.org", "Alex Rivera");
    let host = account(conn, "host@example.org", "Dana Whitfield");
    let home = create_organization(conn, &owner, &new_organization("Riverside Pantry")).unwrap();
    let other = create_organization(conn, &host, &new_organization("Lakeside Kitchen")).unwrap();
    join_as_volunteer(conn, &owner.id, &other.id).unwrap();

    work_in(conn, &owner.id, &other.id);
    let created = create_opportunity(
        conn,
        NewOpportunityInput {
            title: "Saturday breakfast service".into(),
            cause: "food".into(),
            description: "Cook and serve breakfast for neighbours downtown.".into(),
            address: "18 Lakeview Avenue".into(),
            capacity: 8,
            duration: "3 hours".into(),
            requirements: vec!["Closed-toe shoes".into()],
        },
    )
    .unwrap();

    let stored: String = conn
        .query_row(
            "SELECT organization_id FROM opportunities WHERE id = ?1",
            [&created.opportunity.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, other.id);

    // The program is not visible from the founder's own organization.
    work_in(conn, &owner.id, &home.id);
    let home_snapshot = snapshot(conn).unwrap();
    assert!(!home_snapshot
        .created_opportunities
        .iter()
        .any(|row| row.id == created.opportunity.id));
}

#[test]
fn editing_settings_changes_only_selected_org() {
    let database = seeded();
    let conn = database.connection();
    let owner = account(conn, "owner@example.org", "Alex Rivera");
    let home = create_organization(conn, &owner, &new_organization("Riverside Pantry")).unwrap();
    let seeded_name: String = conn
        .query_row(
            "SELECT name FROM organizations ORDER BY created_at, id LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap();

    work_in(conn, &owner.id, &home.id);
    update_settings(
        conn,
        SettingsPatch {
            organization_name: Some("Riverside Community Pantry".into()),
            hours_require_approval: Some(false),
            ..SettingsPatch::default()
        },
    )
    .unwrap();

    let names: Vec<String> = {
        let mut statement = conn
            .prepare("SELECT name FROM organizations ORDER BY created_at, id")
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<String>>>()
            .unwrap()
    };
    assert!(names.contains(&"Riverside Community Pantry".to_string()));
    assert!(names.contains(&seeded_name));

    let seeded_scope = civicflow_core::scope::current(conn).unwrap();
    assert_eq!(seeded_scope.as_deref(), Some(home.id.as_str()));

    // The dashboard settings read the seeded organization when it is open.
    work_in(conn, &owner.id, &workspace_organization(conn));
    let inherited = snapshot(conn).unwrap();
    assert_eq!(inherited.settings.organization_name, "Rivergate Kitchen");
    assert!(
        inherited.settings.hours_require_approval,
        "the shipped approval rule survives a change made in another organization"
    );
}

#[test]
fn volunteer_profile_belongs_to_joined_org() {
    let database = seeded();
    let conn = database.connection();
    let owner = account(conn, "owner@example.org", "Alex Rivera");
    let host = account(conn, "host@example.org", "Dana Whitfield");
    let home = create_organization(conn, &owner, &new_organization("Riverside Pantry")).unwrap();
    let other = create_organization(conn, &host, &new_organization("Lakeside Kitchen")).unwrap();

    assert!(
        auth::active_volunteer(conn, &owner.id, &home.id)
            .unwrap()
            .is_none(),
        "an owner has no roster profile until they join as a volunteer"
    );

    join_as_volunteer(conn, &owner.id, &other.id).unwrap();
    let profile = auth::active_volunteer(conn, &owner.id, &other.id)
        .unwrap()
        .expect("joining a public roster creates a profile");

    let organization: String = conn
        .query_row(
            "SELECT organization_id FROM volunteers WHERE id = ?1",
            [&profile],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(organization, other.id);

    let linked: Option<String> = conn
        .query_row(
            "SELECT volunteer_id FROM organization_memberships
             WHERE organization_id = ?1 AND user_id = ?2",
            [&other.id, &owner.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(linked.as_deref(), Some(profile.as_str()));

    let home_link: Option<String> = conn
        .query_row(
            "SELECT volunteer_id FROM organization_memberships
             WHERE organization_id = ?1 AND user_id = ?2",
            [&home.id, &owner.id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        home_link.is_none(),
        "the profile in Lakeside is not reused in Riverside"
    );
}

#[test]
fn only_the_founding_owner_manages_installation_wide_records() {
    let database = seeded();
    let connection = database.connection();
    let founder: String = connection
        .query_row(
            "SELECT id FROM users WHERE email = 'praket@rivergate.example'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        civicflow_core::organizations::is_workspace_steward(connection, &founder).unwrap(),
        "the seeded coordinator opened the workspace"
    );

    let later = account(connection, "later@example.org", "Dana Whitfield");
    let created = create_organization(connection, &later, &new_organization("Lakeside Kitchen"))
        .expect("a second organization");
    assert!(
        !civicflow_core::organizations::is_workspace_steward(connection, &later.id).unwrap(),
        "owning a later organization does not hand over the installation database"
    );
    assert_eq!(
        require_membership(connection, &created.id, &later.id)
            .unwrap()
            .role,
        "owner"
    );
}

#[test]
fn installation_backups_are_the_stewards_alone() {
    let database = seeded();
    let connection = database.connection();
    let steward: String = connection
        .query_row(
            "SELECT id FROM users WHERE email = 'praket@rivergate.example'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    require_installation_steward(connection, &steward)
        .expect("the account that opened the installation manages its snapshots");

    // The owner of a later organization is a coordinator there, and still has
    // no claim on the installation database.
    let coordinator = account(connection, "coordinator@example.org", "Dana Whitfield");
    let created = create_organization(
        connection,
        &coordinator,
        &new_organization("Lakeside Kitchen"),
    )
    .expect("a second organization");
    let refused = require_installation_steward(connection, &coordinator.id)
        .expect_err("a later owner is not the steward");
    assert_eq!(rule_code(refused), "FORBIDDEN");

    let volunteer = account(connection, "volunteer@example.org", "Sam Ortiz");
    join_as_volunteer(connection, &volunteer.id, &created.id).expect("a public roster");
    let refused = require_installation_steward(connection, &volunteer.id)
        .expect_err("a volunteer never manages installation backups");
    assert_eq!(rule_code(refused), "FORBIDDEN");
}

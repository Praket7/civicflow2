-- Reads are row-level secured; writes are not granted at all.
--
-- A client can select the rows its membership allows and call the commands it
-- is authorized for. There is no INSERT, UPDATE or DELETE grant on any public
-- table, so a missing policy can only hide data, never let a browser rewrite a
-- seat count. The command functions are SECURITY DEFINER and own their checks.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema private to authenticated;
grant usage on schema sync to authenticated;

grant select on all tables in schema public to authenticated;
grant select on sync.sync_changes to authenticated;
grant select on sync.entity_tables to authenticated;
grant execute on all functions in schema private to authenticated;
grant execute on function sync.change_row(text, uuid, text, integer, bigint) to authenticated;

grant execute on function public.apply_command(uuid, uuid, uuid, text, bigint, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.pull_changes(uuid, bigint, integer) to authenticated;
grant execute on function public.my_workspaces() to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_contacts enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invites enable row level security;
alter table public.organization_updates enable row level security;
alter table public.organization_update_reads enable row level security;
alter table public.organization_revisions enable row level security;
alter table public.volunteers enable row level security;
alter table public.volunteer_skills enable row level security;
alter table public.availability_rules enable row level security;
alter table public.credential_types enable row level security;
alter table public.volunteer_credentials enable row level security;
alter table public.opportunities enable row level security;
alter table public.shift_series enable row level security;
alter table public.shift_series_roles enable row level security;
alter table public.shifts enable row level security;
alter table public.shift_roles enable row level security;
alter table public.role_requirements enable row level security;
alter table public.registrations enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_ledger enable row level security;
alter table public.hour_entries enable row level security;
alter table public.service_verifications enable row level security;
alter table public.organization_roster_policies enable row level security;
alter table public.applications enable row level security;
alter table public.volunteer_stage_history enable row level security;
alter table public.saved_opportunities enable row level security;
alter table public.report_saved_views enable row level security;
alter table public.impact_metric_definitions enable row level security;
alter table public.impact_results enable row level security;
alter table public.impact_totals enable row level security;
alter table public.audit_events enable row level security;
alter table public.activity_events enable row level security;
alter table public.checkin_codes enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notifications enable row level security;

-- Identity ------------------------------------------------------------------

create policy profiles_own on public.profiles
    for select to authenticated
    using (id = auth.uid());

-- Organization --------------------------------------------------------------

create policy organizations_member on public.organizations
    for select to authenticated
    using (private.is_member(id));

create policy organization_contacts_member on public.organization_contacts
    for select to authenticated
    using (private.is_member(organization_id));

create policy memberships_self_or_staff on public.organization_memberships
    for select to authenticated
    using (user_id = auth.uid() or private.is_staff(organization_id));

create policy invites_staff on public.organization_invites
    for select to authenticated
    using (private.is_staff(organization_id));

create policy organization_updates_member on public.organization_updates
    for select to authenticated
    using (private.is_member(organization_id));

create policy organization_update_reads_own on public.organization_update_reads
    for select to authenticated
    using (user_id = auth.uid());

create policy organization_revisions_member on public.organization_revisions
    for select to authenticated
    using (private.is_member(organization_id));

-- Volunteer roster ----------------------------------------------------------

create policy volunteers_staff_or_own on public.volunteers
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, id));

create policy volunteer_skills_staff_or_own on public.volunteer_skills
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy availability_staff_or_own on public.availability_rules
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy credential_types_member on public.credential_types
    for select to authenticated
    using (private.is_member(organization_id));

create policy credentials_staff_or_own on public.volunteer_credentials
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

-- Schedule ------------------------------------------------------------------

create policy opportunities_member on public.opportunities
    for select to authenticated
    using (private.is_member(organization_id));

create policy shift_series_member on public.shift_series
    for select to authenticated
    using (private.is_member(organization_id));

create policy shift_series_roles_member on public.shift_series_roles
    for select to authenticated
    using (private.is_member(organization_id));

create policy shifts_member on public.shifts
    for select to authenticated
    using (private.is_member(organization_id));

create policy shift_roles_member on public.shift_roles
    for select to authenticated
    using (private.is_member(organization_id));

create policy role_requirements_member on public.role_requirements
    for select to authenticated
    using (private.is_member(organization_id));

-- Participation -------------------------------------------------------------

create policy registrations_staff_or_own on public.registrations
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy waitlist_staff_or_own on public.waitlist_entries
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy attendance_staff_or_own on public.attendance_events
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy attendance_ledger_staff_or_own on public.attendance_ledger
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy hours_staff_or_own on public.hour_entries
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy verifications_staff_or_own on public.service_verifications
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy saved_opportunities_own on public.saved_opportunities
    for select to authenticated
    using (private.is_staff(organization_id)
           or private.is_own_volunteer(organization_id, volunteer_id));

create policy roster_policies_staff on public.organization_roster_policies
    for select to authenticated
    using (private.is_staff(organization_id));

-- Records -------------------------------------------------------------------

create policy applications_staff on public.applications
    for select to authenticated
    using (private.is_staff(organization_id));

create policy stage_history_staff on public.volunteer_stage_history
    for select to authenticated
    using (private.is_staff(organization_id));

create policy report_views_staff on public.report_saved_views
    for select to authenticated
    using (private.is_staff(organization_id));

create policy impact_definitions_member on public.impact_metric_definitions
    for select to authenticated
    using (private.is_member(organization_id));

create policy impact_results_member on public.impact_results
    for select to authenticated
    using (private.is_member(organization_id));

create policy impact_totals_member on public.impact_totals
    for select to authenticated
    using (private.is_member(organization_id));

create policy audit_staff on public.audit_events
    for select to authenticated
    using (private.is_staff(organization_id));

create policy activity_staff on public.activity_events
    for select to authenticated
    using (private.is_staff(organization_id));

-- Check-in codes are a credential. A volunteer proves one through CHECK_IN;
-- they never read the table, so an expired code cannot be replayed from cache.
create policy checkin_codes_staff on public.checkin_codes
    for select to authenticated
    using (private.is_staff(organization_id));

create policy notification_rules_staff on public.notification_rules
    for select to authenticated
    using (private.is_staff(organization_id));

create policy notifications_own_or_coordinator on public.notifications
    for select to authenticated
    using (
        private.is_staff(organization_id)
        or (audience in ('volunteer', 'all')
            and (volunteer_id is null
                 or volunteer_id = private.own_volunteer_id(organization_id)))
    );

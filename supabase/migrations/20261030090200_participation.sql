-- Participation: seats, waitlists, attendance, hours and the records that
-- explain them.
--
-- Seat counts are caches of this table. Every write that changes a seat passes
-- through a trigger that recounts the shift, so the capacity invariant holds
-- even if a future code path forgets to check it.

create table public.registrations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    role text not null default '',
    status text not null default 'registered'
        check (status in ('registered', 'confirmed', 'canceled', 'no_show', 'completed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz,
    locked boolean not null default false,
    locked_by uuid references auth.users(id) on delete set null,
    locked_at timestamptz,
    row_version integer not null default 1,
    unique (shift_id, volunteer_id)
);

create index registrations_shift on public.registrations (shift_id, status);
create index registrations_volunteer on public.registrations (volunteer_id, created_at desc);

create table public.waitlist_entries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    created_at timestamptz not null default now(),
    status text not null default 'waiting'
        check (status in ('waiting', 'promoted', 'declined', 'expired', 'removed')),
    position integer not null check (position > 0),
    eligible_role text not null default '',
    row_version integer not null default 1,
    unique (shift_id, volunteer_id)
);

create index waitlist_shift_position on public.waitlist_entries (shift_id, position);

create table public.attendance_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    role text not null default '',
    status text not null default 'expected'
        check (status in ('expected', 'checked_in', 'completed', 'no_show')),
    checked_in_at timestamptz,
    checked_out_at timestamptz,
    recorded_at timestamptz not null default now(),
    row_version integer not null default 1,
    unique (shift_id, volunteer_id)
);

create index attendance_shift on public.attendance_events (shift_id);
create index attendance_volunteer on public.attendance_events (volunteer_id, recorded_at desc);

create table public.attendance_ledger (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    event_type text not null check (event_type in (
        'check_in', 'check_out', 'manual_check_in', 'manual_check_out',
        'marked_late', 'marked_no_show', 'correction'
    )),
    actor text not null default '',
    note text,
    at timestamptz not null default now()
);

create index attendance_ledger_shift on public.attendance_ledger (shift_id, volunteer_id, at);

create table public.service_verifications (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    code text not null unique,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    date_start date not null,
    date_end date not null,
    total_minutes integer not null check (total_minutes > 0),
    issued_at timestamptz not null default now(),
    issued_by text not null default ''
);

create table public.hour_entries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    opportunity_id uuid not null references public.opportunities(id) on delete restrict,
    date date not null,
    minutes integer not null check (minutes between 0 and 1440),
    status text not null default 'pending'
        check (status in ('verified', 'pending', 'rejected')),
    verification_id uuid references public.service_verifications(id) on delete set null,
    approved_minutes integer check (approved_minutes is null or approved_minutes between 0 and 1440),
    reviewed_at timestamptz,
    reviewer text,
    review_reason text,
    scheduled_minutes integer check (scheduled_minutes is null or scheduled_minutes between 0 and 1440),
    calculated_minutes integer check (calculated_minutes is null or calculated_minutes between 0 and 1440),
    source_shift_id uuid references public.shifts(id) on delete set null,
    note text,
    row_version integer not null default 1
);

create index hour_entries_volunteer on public.hour_entries (volunteer_id, date desc);
create index hour_entries_pending on public.hour_entries (organization_id, status);

create table public.organization_roster_policies (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    version integer not null check (version > 0),
    policy jsonb not null,
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id) on delete set null,
    row_version integer not null default 1,
    unique (organization_id, version)
);

create table public.applications (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null,
    email text not null default '',
    initials text not null default '',
    tone text not null default 'sage',
    stage text not null default 'applied'
        check (stage in ('applied', 'review', 'onboarding', 'active')),
    applied_at timestamptz not null default now(),
    source text not null default '',
    cause text not null default '',
    skills jsonb not null default '[]'::jsonb,
    note text not null default '',
    row_version integer not null default 1
);

create table public.volunteer_stage_history (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    application_id uuid not null references public.applications(id) on delete cascade,
    from_stage text not null,
    to_stage text not null,
    changed_at timestamptz not null default now(),
    changed_by text not null default '',
    note text
);

create table public.saved_opportunities (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    opportunity_id uuid not null references public.opportunities(id) on delete cascade,
    saved_at timestamptz not null default now(),
    unique (volunteer_id, opportunity_id)
);

create table public.report_saved_views (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    owner_id uuid not null references auth.users(id) on delete cascade,
    scope text not null default '',
    name text not null,
    filters jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (organization_id, owner_id, scope, name)
);

create table public.impact_metric_definitions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    opportunity_id uuid not null references public.opportunities(id) on delete cascade,
    metric_key text not null,
    name text not null,
    unit text not null default '',
    created_at timestamptz not null default now(),
    unique (opportunity_id, metric_key)
);

create table public.impact_results (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    definition_id uuid not null references public.impact_metric_definitions(id) on delete cascade,
    shift_id uuid references public.shifts(id) on delete set null,
    value numeric not null check (value >= 0),
    recorded_at timestamptz not null default now(),
    recorded_by text not null default ''
);

create table public.impact_totals (
    organization_id uuid primary key references public.organizations(id) on delete cascade,
    hours_ytd integer not null default 0,
    unique_volunteers_ytd integer not null default 0,
    meals_packed integer not null default 0,
    tutoring_sessions integer not null default 0,
    trees_planted integer not null default 0,
    families_served_month integer not null default 0,
    shifts_completed integer not null default 0,
    attendance_rate integer not null default 0
);

create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    timestamp timestamptz not null default now(),
    actor_type text not null default 'user',
    actor_id text not null default '',
    action text not null,
    entity_type text not null,
    entity_id text not null,
    summary text not null default '',
    detail text
);

create index audit_events_organization on public.audit_events (organization_id, timestamp desc);

create table public.activity_events (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    volunteer_id uuid references public.volunteers(id) on delete cascade,
    name text not null default '',
    action text not null default '',
    detail text not null default '',
    tone text not null default 'sage',
    at timestamptz not null default now()
);

create index activity_events_organization on public.activity_events (organization_id, at desc);

-- A rotating code is a credential, not a label. The token is readable only by
-- staff; a volunteer proves the code through the CHECK_IN command, which
-- verifies it inside the database instead of shipping the hash to the client.
create table public.checkin_codes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    code text not null,
    token text not null unique,
    issued_at timestamptz not null default now(),
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    active boolean not null default true
);

create unique index one_active_code_per_shift
    on public.checkin_codes (shift_id) where active;

create table public.notification_rules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    trigger_type text not null check (trigger_type in (
        'shift_reminder', 'checkin_soon', 'missed_shift_follow_up', 'credential_expiring'
    )),
    offset_minutes integer not null,
    audience text not null check (audience in ('volunteer', 'coordinator')),
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    unique (organization_id, trigger_type, audience)
);

create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    kind text not null default 'reminder',
    title text not null,
    body text not null default '',
    priority text not null default 'normal' check (priority in ('high', 'normal')),
    created_at timestamptz not null default now(),
    read_at timestamptz,
    href text not null default '',
    audience text not null default 'coordinator'
        check (audience in ('coordinator', 'volunteer', 'all')),
    volunteer_id uuid references public.volunteers(id) on delete cascade,
    rule_id uuid references public.notification_rules(id) on delete set null,
    row_version integer not null default 1
);

create index notifications_organization on public.notifications (organization_id, created_at desc);
create index notifications_volunteer on public.notifications (volunteer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Seat accounting
-- ---------------------------------------------------------------------------

create or replace function private.recount_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_capacity integer;
    v_confirmed integer;
    v_waitlisted integer;
begin
    select capacity into v_capacity from public.shifts where id = p_shift_id;
    if v_capacity is null then
        return;
    end if;

    select count(*) into v_confirmed
    from public.registrations
    where shift_id = p_shift_id
      and status in ('registered', 'confirmed', 'completed');

    if v_confirmed > v_capacity then
        raise exception 'capacity_full'
            using errcode = 'check_violation',
                  detail = format('shift %s holds %s seats, %s confirmed',
                                  p_shift_id, v_capacity, v_confirmed);
    end if;

    select count(*) into v_waitlisted
    from public.waitlist_entries
    where shift_id = p_shift_id and status = 'waiting';

    update public.shifts
    set confirmed = v_confirmed, waitlisted = v_waitlisted
    where id = p_shift_id;
end;
$$;

create or replace function private.after_registration_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform private.recount_shift(old.shift_id);
        return old;
    end if;
    perform private.recount_shift(new.shift_id);
    if tg_op = 'UPDATE' and new.shift_id is distinct from old.shift_id then
        perform private.recount_shift(old.shift_id);
    end if;
    return new;
end;
$$;

create trigger registrations_recount
after insert or update or delete on public.registrations
for each row execute function private.after_registration_change();

create or replace function private.after_waitlist_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform private.recount_shift(old.shift_id);
        return old;
    end if;
    perform private.recount_shift(new.shift_id);
    if tg_op = 'UPDATE' and new.shift_id is distinct from old.shift_id then
        perform private.recount_shift(old.shift_id);
    end if;
    return new;
end;
$$;

create trigger waitlist_recount
after insert or update or delete on public.waitlist_entries
for each row execute function private.after_waitlist_change();

-- A waitlist is ordered, so the position is assigned rather than trusted. The
-- unique (shift, volunteer) key means a retried join returns the existing row.
create or replace function private.assign_waitlist_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.position is null or new.position <= 0 then
        select coalesce(max(position), 0) + 1 into new.position
        from public.waitlist_entries
        where shift_id = new.shift_id;
    end if;
    return new;
end;
$$;

create trigger waitlist_position
before insert on public.waitlist_entries
for each row execute function private.assign_waitlist_position();

-- Role fill counts follow the registrations that name the role.
create or replace function private.recount_shift_role(p_shift_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_filled integer;
begin
    select count(*) into v_filled
    from public.registrations
    where shift_id = p_shift_id
      and role = p_role
      and status in ('registered', 'confirmed', 'completed');

    update public.shift_roles
    set filled = least(v_filled, required)
    where shift_id = p_shift_id and name = p_role;
end;
$$;

create or replace function private.after_registration_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform private.recount_shift_role(old.shift_id, old.role);
        return old;
    end if;
    perform private.recount_shift_role(new.shift_id, new.role);
    if tg_op = 'UPDATE' and (new.role is distinct from old.role or new.shift_id is distinct from old.shift_id) then
        perform private.recount_shift_role(old.shift_id, old.role);
    end if;
    return new;
end;
$$;

create trigger registrations_role_fill
after insert or update or delete on public.registrations
for each row execute function private.after_registration_role();

-- ---------------------------------------------------------------------------
-- Derived volunteer totals
-- ---------------------------------------------------------------------------

create or replace function private.recount_volunteer_hours(p_volunteer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.volunteers
    set hours_verified = coalesce((
        select round(sum(coalesce(approved_minutes, minutes))::numeric / 60, 2)
        from public.hour_entries
        where volunteer_id = p_volunteer_id and status = 'verified'
    ), 0)
    where id = p_volunteer_id;
end;
$$;

create or replace function private.after_hour_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform private.recount_volunteer_hours(old.volunteer_id);
        return old;
    end if;
    perform private.recount_volunteer_hours(new.volunteer_id);
    if tg_op = 'UPDATE' and new.volunteer_id is distinct from old.volunteer_id then
        perform private.recount_volunteer_hours(old.volunteer_id);
    end if;
    return new;
end;
$$;

create trigger hour_entries_recount
after insert or update or delete on public.hour_entries
for each row execute function private.after_hour_change();

create or replace function private.recount_volunteer_attendance(p_volunteer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_completed integer;
    v_attended integer;
    v_rate integer;
begin
    select
        count(*) filter (where status in ('completed', 'no_show')),
        count(*) filter (where status = 'completed')
    into v_completed, v_attended
    from public.attendance_events
    where volunteer_id = p_volunteer_id;

    v_rate := case when v_completed = 0 then 0
                   else round(v_attended::numeric * 100 / v_completed) end;

    update public.volunteers
    set events_completed = v_attended,
        attendance_rate = greatest(0, least(100, v_rate))
    where id = p_volunteer_id;
end;
$$;

create or replace function private.after_attendance_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        perform private.recount_volunteer_attendance(old.volunteer_id);
        return old;
    end if;
    perform private.recount_volunteer_attendance(new.volunteer_id);
    if tg_op = 'UPDATE' and new.volunteer_id is distinct from old.volunteer_id then
        perform private.recount_volunteer_attendance(old.volunteer_id);
    end if;
    return new;
end;
$$;

create trigger attendance_recount
after insert or update or delete on public.attendance_events
for each row execute function private.after_attendance_change();

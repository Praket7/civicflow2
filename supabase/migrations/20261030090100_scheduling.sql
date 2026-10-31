-- Volunteers, credentials, opportunities, shifts and repeating series.
--
-- These mirror the SQLite model CivicFlow already uses. The differences are
-- deliberate: ids are UUIDs so a device can create a row offline, and unique
-- keys are scoped to an organization so the same person or slug can exist in
-- two organizations without colliding.

create table public.volunteers (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 120),
    first_name text not null default '',
    initials text not null default '',
    role text not null default 'Volunteer',
    email text not null default '',
    phone text not null default '',
    joined_at timestamptz not null default now(),
    status text not null default 'active'
        check (status in ('active', 'onboarding', 'inactive')),
    tone text not null default 'sage',
    languages jsonb not null default '[]'::jsonb,
    causes jsonb not null default '[]'::jsonb,
    hours_verified numeric(10, 2) not null default 0 check (hours_verified >= 0),
    attendance_rate integer not null default 0 check (attendance_rate between 0 and 100),
    events_completed integer not null default 0 check (events_completed >= 0),
    interests text not null default '',
    availability jsonb not null default '[]'::jsonb,
    photo text not null default '',
    birthdate date,
    onboarding_completed boolean not null default true,
    row_version integer not null default 1
);

create unique index volunteers_organization_email
    on public.volunteers (organization_id, lower(email))
    where email <> '';

create index volunteers_organization on public.volunteers (organization_id, name);

alter table public.organization_memberships
    add constraint organization_memberships_volunteer_fk
    foreign key (volunteer_id) references public.volunteers(id) on delete set null;

create table public.volunteer_skills (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    skill text not null,
    unique (volunteer_id, skill)
);

create table public.availability_rules (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    day text not null check (day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
    period text not null check (period in ('morning', 'afternoon', 'evening')),
    unique (volunteer_id, day, period)
);

create table public.credential_types (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    name text not null,
    validity_months integer not null check (validity_months > 0),
    unique (organization_id, name)
);

create table public.volunteer_credentials (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    volunteer_id uuid not null references public.volunteers(id) on delete cascade,
    credential_type_id uuid not null references public.credential_types(id) on delete restrict,
    identifier text not null default '',
    issued_at date not null default current_date,
    valid_from date not null default current_date,
    valid_through date not null,
    verified_at timestamptz,
    verified_by text,
    notes text,
    row_version integer not null default 1,
    unique (volunteer_id, credential_type_id, identifier)
);

create index volunteer_credentials_expiry
    on public.volunteer_credentials (organization_id, valid_through);

create table public.opportunities (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    slug text not null,
    title text not null,
    cause text not null default '',
    organization_name text not null default '',
    image text not null default '',
    image_alt text not null default '',
    description text not null default '',
    address text not null default '',
    distance_miles numeric(8, 2) not null default 0 check (distance_miles >= 0),
    coordinator text not null default '',
    capacity integer not null default 1 check (capacity > 0),
    duration text not null default '',
    training jsonb not null default '[]'::jsonb,
    requirements jsonb not null default '[]'::jsonb,
    impact_metric text not null default '',
    created_at timestamptz not null default now(),
    row_version integer not null default 1,
    unique (organization_id, slug)
);

create index opportunities_organization on public.opportunities (organization_id, title);

create table public.shift_series (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    opportunity_id uuid not null references public.opportunities(id) on delete cascade,
    timezone text not null default 'America/New_York',
    recurrence_kind text not null default 'weekly'
        check (recurrence_kind in ('none', 'weekly')),
    interval_weeks integer not null default 1 check (interval_weeks between 1 and 8),
    weekdays jsonb not null default '[]'::jsonb,
    starts_local_time text not null,
    duration_minutes integer not null check (duration_minutes between 15 and 1440),
    starts_on date not null,
    ends_on date,
    occurrence_count integer,
    created_at timestamptz not null default now(),
    check ((ends_on is null) <> (occurrence_count is null)),
    check (occurrence_count is null or occurrence_count between 1 and 60)
);

create table public.shift_series_roles (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    series_id uuid not null references public.shift_series(id) on delete cascade,
    name text not null,
    required integer not null default 0 check (required >= 0),
    unique (series_id, name)
);

create table public.shifts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    opportunity_id uuid not null references public.opportunities(id) on delete cascade,
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    capacity integer not null check (capacity > 0),
    confirmed integer not null default 0 check (confirmed >= 0),
    waitlisted integer not null default 0 check (waitlisted >= 0),
    status text not null default 'scheduled'
        check (status in ('scheduled', 'completed', 'canceled')),
    series_id uuid references public.shift_series(id) on delete set null,
    occurrence_date date,
    created_at timestamptz not null default now(),
    row_version integer not null default 1,
    check (ends_at > starts_at),
    -- The seat count is a cache of the registration table, and this check is
    -- the last line of defence if a trigger is ever bypassed.
    check (confirmed <= capacity)
);

create index shifts_organization_start on public.shifts (organization_id, starts_at);
create index shifts_series on public.shifts (series_id, occurrence_date);

create table public.shift_roles (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    name text not null,
    required integer not null default 0 check (required >= 0),
    filled integer not null default 0 check (filled >= 0),
    unique (shift_id, name),
    check (filled <= required)
);

create table public.role_requirements (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    role_name text not null,
    skill text,
    credential_type_id uuid references public.credential_types(id) on delete set null,
    minimum_age integer check (minimum_age is null or minimum_age between 0 and 120),
    unique (shift_id, role_name)
);

create index role_requirements_shift on public.role_requirements (shift_id);

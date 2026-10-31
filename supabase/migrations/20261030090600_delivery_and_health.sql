-- Reminder delivery and the health state a coordinator can actually read.
--
-- Nothing here schedules work on a volunteer's device. A cron job on the server
-- finds due reminders, writes a delivery row with a dedupe key, and dispatches
-- it. Running twice sends once.

create table public.notification_preferences (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    in_app boolean not null default true,
    push boolean not null default false,
    email boolean not null default false,
    sms boolean not null default false,
    quiet_hours_start time,
    quiet_hours_end time,
    reminder_minutes integer not null default 1440
        check (reminder_minutes between 5 and 20160),
    updated_at timestamptz not null default now(),
    unique (organization_id, user_id)
);

-- The endpoint is a capability, not an identifier: whoever holds it can send to
-- that device. It is readable only by the volunteer it belongs to.
create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    device_label text not null default '',
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz
);

create index push_subscriptions_user on public.push_subscriptions (user_id, revoked_at);

create table public.notification_deliveries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    notification_id uuid references public.notifications(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    channel text not null check (channel in ('in_app', 'push', 'email', 'sms')),
    provider text not null default '',
    dedupe_key text not null unique,
    status text not null default 'scheduled'
        check (status in ('scheduled', 'sending', 'sent', 'failed', 'deferred', 'skipped')),
    attempts integer not null default 0,
    scheduled_at timestamptz not null default now(),
    sent_at timestamptz,
    failed_at timestamptz,
    last_error text
);

create index notification_deliveries_due
    on public.notification_deliveries (status, scheduled_at);
create index notification_deliveries_user
    on public.notification_deliveries (user_id, scheduled_at desc);

create table public.backup_runs (
    id uuid primary key default gen_random_uuid(),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    status text not null default 'running'
        check (status in ('running', 'succeeded', 'failed')),
    size_bytes bigint,
    sha256 text,
    storage_path text,
    verified_at timestamptz,
    detail text
);

create table public.server_job_runs (
    id uuid primary key default gen_random_uuid(),
    job text not null,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    status text not null default 'running'
        check (status in ('running', 'succeeded', 'failed')),
    detail text
);

create index server_job_runs_job on public.server_job_runs (job, started_at desc);

-- ---------------------------------------------------------------------------
-- Device and preference RPCs
-- ---------------------------------------------------------------------------

create or replace function public.register_device(
    p_organization_id uuid,
    p_replica_id uuid,
    p_label text default '',
    p_platform text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_cursor bigint;
    v_revision bigint;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    insert into sync.devices (id, organization_id, user_id, label, platform, last_seen_at)
    values (p_replica_id, p_organization_id, auth.uid(),
            coalesce(p_label, ''), coalesce(p_platform, ''), now())
    on conflict (id) do update
        set label = excluded.label,
            platform = excluded.platform,
            user_id = excluded.user_id,
            organization_id = excluded.organization_id,
            last_seen_at = now();

    select cursor into v_cursor from sync.devices where id = p_replica_id;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    return jsonb_build_object(
        'status', 'ok',
        'cursor', coalesce(v_cursor, 0),
        'revision', coalesce(v_revision, 0),
        'serverTime', now()
    );
end;
$$;

create or replace function public.report_device_state(
    p_organization_id uuid,
    p_replica_id uuid,
    p_cursor bigint,
    p_pending integer default 0,
    p_oldest_pending_at timestamptz default null,
    p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    insert into sync.devices (id, organization_id, user_id, cursor, last_seen_at, platform)
    values (p_replica_id, p_organization_id, auth.uid(), greatest(coalesce(p_cursor, 0), 0),
            now(), '')
    on conflict (id) do update
        set cursor = greatest(coalesce(p_cursor, 0), 0),
            pending_operations = coalesce(p_pending, 0),
            oldest_pending_at = p_oldest_pending_at,
            last_error = p_error,
            last_seen_at = now(),
            last_successful_sync_at = case when p_error is null then now()
                                           else sync.devices.last_successful_sync_at end,
            organization_id = excluded.organization_id;

    return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.save_notification_preferences(
    p_organization_id uuid,
    p_in_app boolean,
    p_push boolean,
    p_email boolean,
    p_sms boolean,
    p_quiet_hours_start time default null,
    p_quiet_hours_end time default null,
    p_reminder_minutes integer default 1440
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    insert into public.notification_preferences
        (organization_id, user_id, in_app, push, email, sms,
         quiet_hours_start, quiet_hours_end, reminder_minutes, updated_at)
    values
        (p_organization_id, auth.uid(), p_in_app, p_push, p_email, p_sms,
         p_quiet_hours_start, p_quiet_hours_end,
         least(greatest(coalesce(p_reminder_minutes, 1440), 5), 20160), now())
    on conflict (organization_id, user_id) do update
        set in_app = excluded.in_app,
            push = excluded.push,
            email = excluded.email,
            sms = excluded.sms,
            quiet_hours_start = excluded.quiet_hours_start,
            quiet_hours_end = excluded.quiet_hours_end,
            reminder_minutes = excluded.reminder_minutes,
            updated_at = now()
    returning id into v_id;

    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

create or replace function public.register_push_subscription(
    p_organization_id uuid,
    p_endpoint text,
    p_p256dh text,
    p_auth text,
    p_label text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    if coalesce(btrim(p_endpoint), '') = '' then
        return jsonb_build_object('status', 'validation_error', 'code', 'endpoint_required');
    end if;

    -- A shared browser profile can be handed to another volunteer. Re-pointing
    -- the endpoint is how that hand-over is recorded, rather than leaving a
    -- subscription that would deliver to the wrong person.
    insert into public.push_subscriptions
        (organization_id, user_id, endpoint, p256dh, auth, device_label)
    values
        (p_organization_id, auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_label, ''))
    on conflict (endpoint) do update
        set user_id = excluded.user_id,
            organization_id = excluded.organization_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            device_label = excluded.device_label,
            revoked_at = null
    returning id into v_id;

    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

create or replace function public.revoke_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.push_subscriptions
    set revoked_at = now()
    where endpoint = p_endpoint and user_id = auth.uid();

    return jsonb_build_object('status', 'ok', 'revoked', found);
end;
$$;

-- The auth trigger creates a profile, but a project can predate the trigger or
-- run with a restricted migration role. This gives sign-in one idempotent way
-- to guarantee the row exists without granting INSERT on profiles.
create or replace function public.ensure_profile(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := auth.uid();
    v_name text;
    v_email text;
begin
    if v_id is null then
        return jsonb_build_object('status', 'forbidden', 'code', 'unauthenticated');
    end if;

    select coalesce(
               nullif(btrim(p_name), ''),
               nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
               nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
               'CivicFlow member'
           ),
           coalesce(u.email, '')
    into v_name, v_email
    from auth.users u
    where u.id = v_id;

    if v_name is null then
        return jsonb_build_object('status', 'forbidden', 'code', 'unknown_user');
    end if;

    insert into public.profiles (id, name, email)
    values (v_id, v_name, v_email)
    on conflict (id) do update set name = excluded.name;

    return jsonb_build_object('status', 'ok', 'id', v_id, 'name', v_name, 'email', v_email);
end;
$$;

create or replace function public.health_snapshot(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_devices jsonb;
    v_backup jsonb;
    v_job jsonb;
    v_revision bigint;
    v_counts jsonb;
begin
    if not private.is_staff(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'replicaId', d.id,
        'label', d.label,
        'platform', d.platform,
        'lastSeenAt', d.last_seen_at,
        'lastSuccessfulSyncAt', d.last_successful_sync_at,
        'pendingOperations', d.pending_operations,
        'oldestPendingAt', d.oldest_pending_at,
        'lastError', d.last_error
    ) order by d.last_seen_at desc), '[]'::jsonb)
    into v_devices
    from sync.devices d
    where d.organization_id = p_organization_id;

    select jsonb_build_object(
        'startedAt', b.started_at,
        'finishedAt', b.finished_at,
        'status', b.status,
        'verifiedAt', b.verified_at,
        'ageHours', round(extract(epoch from (now() - b.finished_at)) / 3600)
    )
    into v_backup
    from public.backup_runs b
    where b.status = 'succeeded'
    order by b.finished_at desc
    limit 1;

    select jsonb_build_object(
        'job', j.job,
        'startedAt', j.started_at,
        'status', j.status,
        'detail', j.detail
    )
    into v_job
    from public.server_job_runs j
    where j.status = 'succeeded'
    order by j.started_at desc
    limit 1;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    select jsonb_build_object(
        'volunteers', (select count(*) from public.volunteers where organization_id = p_organization_id),
        'opportunities', (select count(*) from public.opportunities where organization_id = p_organization_id),
        'shifts', (select count(*) from public.shifts where organization_id = p_organization_id),
        'registrations', (select count(*) from public.registrations
                          where organization_id = p_organization_id
                            and status in ('registered', 'confirmed')),
        'openHourEntries', (select count(*) from public.hour_entries
                            where organization_id = p_organization_id and status = 'pending'),
        'devices', (select count(*) from sync.devices where organization_id = p_organization_id),
        'pushSubscriptions', (select count(*) from public.push_subscriptions
                              where organization_id = p_organization_id and revoked_at is null)
    ) into v_counts;

    return jsonb_build_object(
        'status', 'ok',
        'revision', coalesce(v_revision, 0),
        'devices', v_devices,
        'lastBackup', v_backup,
        'lastJob', v_job,
        'counts', v_counts,
        'serverTime', now()
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Policies and grants
-- ---------------------------------------------------------------------------

alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.backup_runs enable row level security;
alter table public.server_job_runs enable row level security;

create policy notification_preferences_own on public.notification_preferences
    for select to authenticated
    using (user_id = auth.uid());

create policy push_subscriptions_own on public.push_subscriptions
    for select to authenticated
    using (user_id = auth.uid());

create policy notification_deliveries_own_or_staff on public.notification_deliveries
    for select to authenticated
    using (user_id = auth.uid() or private.is_staff(organization_id));

create policy backup_runs_staff on public.backup_runs
    for select to authenticated
    using (exists (
        select 1 from public.organization_memberships m
        where m.user_id = auth.uid()
          and m.status = 'active'
          and m.role in ('owner', 'coordinator')
    ));

create policy server_job_runs_staff on public.server_job_runs
    for select to authenticated
    using (exists (
        select 1 from public.organization_memberships m
        where m.user_id = auth.uid()
          and m.status = 'active'
          and m.role in ('owner', 'coordinator')
    ));

grant select on public.notification_preferences to authenticated;
grant select on public.push_subscriptions to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.backup_runs to authenticated;
grant select on public.server_job_runs to authenticated;

grant execute on function public.register_device(uuid, uuid, text, text) to authenticated;
grant execute on function public.report_device_state(uuid, uuid, bigint, integer, timestamptz, text) to authenticated;
grant execute on function public.save_notification_preferences(uuid, boolean, boolean, boolean, boolean, time, time, integer) to authenticated;
grant execute on function public.register_push_subscription(uuid, text, text, text, text) to authenticated;
grant execute on function public.revoke_push_subscription(text) to authenticated;
grant execute on function public.health_snapshot(uuid) to authenticated;
grant execute on function public.ensure_profile(text) to authenticated;

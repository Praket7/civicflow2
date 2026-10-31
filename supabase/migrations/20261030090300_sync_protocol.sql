-- The change log is the only thing a client pulls. Realtime is a hint to call
-- pull; it is never the truth. A device that slept through a websocket still
-- converges because the cursor, not a timestamp, says what it has seen.

create table sync.entity_tables (
    entity_type text primary key,
    table_name text not null
);

insert into sync.entity_tables (entity_type, table_name) values
    ('organization', 'organizations'),
    ('organization_contact', 'organization_contacts'),
    ('membership', 'organization_memberships'),
    ('invite', 'organization_invites'),
    ('organization_update', 'organization_updates'),
    ('organization_update_read', 'organization_update_reads'),
    ('volunteer', 'volunteers'),
    ('volunteer_skill', 'volunteer_skills'),
    ('availability_rule', 'availability_rules'),
    ('credential_type', 'credential_types'),
    ('credential', 'volunteer_credentials'),
    ('opportunity', 'opportunities'),
    ('shift_series', 'shift_series'),
    ('shift_series_role', 'shift_series_roles'),
    ('shift', 'shifts'),
    ('shift_role', 'shift_roles'),
    ('role_requirement', 'role_requirements'),
    ('registration', 'registrations'),
    ('waitlist_entry', 'waitlist_entries'),
    ('attendance', 'attendance_events'),
    ('attendance_ledger', 'attendance_ledger'),
    ('hour_entry', 'hour_entries'),
    ('service_verification', 'service_verifications'),
    ('roster_policy', 'organization_roster_policies'),
    ('application', 'applications'),
    ('stage_history', 'volunteer_stage_history'),
    ('saved_opportunity', 'saved_opportunities'),
    ('report_view', 'report_saved_views'),
    ('impact_definition', 'impact_metric_definitions'),
    ('impact_result', 'impact_results'),
    ('audit_event', 'audit_events'),
    ('activity_event', 'activity_events'),
    ('checkin_code', 'checkin_codes'),
    ('notification_rule', 'notification_rules'),
    ('notification', 'notifications');

-- No foreign key on purpose: an organization delete cascades through every
-- child table, and those AFTER DELETE triggers would otherwise fail against a
-- parent that is already gone. Orphaned log rows are only reachable by members
-- of an organization that no longer exists.
create table sync.sync_changes (
    sequence bigint generated always as identity primary key,
    organization_id uuid not null,
    entity_type text not null,
    entity_id uuid not null,
    operation text not null check (operation in ('insert', 'update', 'delete')),
    row_version integer,
    actor_id uuid,
    replica_id uuid,
    operation_id uuid,
    changed_at timestamptz not null default now()
);

create index sync_changes_organization on sync.sync_changes (organization_id, sequence);
create index sync_changes_entity on sync.sync_changes (organization_id, entity_type, entity_id);

comment on table sync.sync_changes is
    'Append-only. Clients pull sequence > cursor; deletes are tombstones.';

-- Idempotency ledger. One row per operation ever accepted, holding the exact
-- response that was returned. A retry after a lost response reads this instead
-- of running the command a second time.
create table sync.processed_operations (
    operation_id uuid primary key,
    organization_id uuid not null,
    actor_id uuid not null,
    replica_id uuid,
    command_type text not null,
    result_status text not null,
    result_payload jsonb,
    processed_at timestamptz not null default now()
);

create index processed_operations_organization
    on sync.processed_operations (organization_id, processed_at desc);

-- ---------------------------------------------------------------------------
-- Logging triggers
-- ---------------------------------------------------------------------------

create or replace function sync.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_entity text := tg_argv[0];
    v_bump text := coalesce(tg_argv[1], 'none');
    v_row jsonb;
    v_org uuid;
    v_id uuid;
    v_version integer;
    v_replica uuid;
    v_operation uuid;
begin
    v_replica := nullif(current_setting('civicflow.replica_id', true), '')::uuid;
    v_operation := nullif(current_setting('civicflow.operation_id', true), '')::uuid;

    if tg_op = 'DELETE' then
        -- An organization's own deletion ends access for everyone; there is no
        -- client left that could apply a tombstone.
        if v_entity = 'organization' then
            return old;
        end if;

        v_row := to_jsonb(old);
        v_org := (v_row ->> 'organization_id')::uuid;
        v_id := (v_row ->> 'id')::uuid;

        insert into sync.sync_changes
            (organization_id, entity_type, entity_id, operation, row_version,
             actor_id, replica_id, operation_id)
        values (v_org, v_entity, v_id, 'delete', null, auth.uid(), v_replica, v_operation);

        return old;
    end if;

    v_row := to_jsonb(new);
    v_org := coalesce(
        (v_row ->> 'organization_id')::uuid,
        case when v_entity = 'organization' then (v_row ->> 'id')::uuid end
    );
    v_id := (v_row ->> 'id')::uuid;
    v_version := (v_row ->> 'row_version')::integer;

    if v_org is null then
        return new;
    end if;

    insert into sync.sync_changes
        (organization_id, entity_type, entity_id, operation, row_version,
         actor_id, replica_id, operation_id)
    values (v_org, v_entity, v_id, lower(tg_op), v_version, auth.uid(), v_replica, v_operation);

    if v_bump = 'revision' and exists (select 1 from public.organizations where id = v_org) then
        insert into public.organization_revisions (organization_id, revision, updated_at)
        values (v_org, 1, now())
        on conflict (organization_id) do update
            set revision = public.organization_revisions.revision + 1,
                updated_at = now();
    end if;

    return new;
end;
$$;

do $$
declare
    r record;
begin
    for r in
        select * from (values
            ('organization', 'organizations', true, false),
            ('organization_contact', 'organization_contacts', false, false),
            ('membership', 'organization_memberships', true, false),
            ('invite', 'organization_invites', false, false),
            ('organization_update', 'organization_updates', false, false),
            ('organization_update_read', 'organization_update_reads', false, false),
            ('volunteer', 'volunteers', true, true),
            ('volunteer_skill', 'volunteer_skills', false, false),
            ('availability_rule', 'availability_rules', false, false),
            ('credential_type', 'credential_types', false, false),
            ('credential', 'volunteer_credentials', true, true),
            ('opportunity', 'opportunities', true, false),
            ('shift_series', 'shift_series', false, false),
            ('shift_series_role', 'shift_series_roles', false, false),
            ('shift', 'shifts', true, true),
            ('shift_role', 'shift_roles', false, true),
            ('role_requirement', 'role_requirements', false, false),
            ('registration', 'registrations', true, true),
            ('waitlist_entry', 'waitlist_entries', true, true),
            ('attendance', 'attendance_events', true, false),
            ('attendance_ledger', 'attendance_ledger', false, false),
            ('hour_entry', 'hour_entries', true, false),
            ('service_verification', 'service_verifications', false, false),
            ('roster_policy', 'organization_roster_policies', true, false),
            ('application', 'applications', true, false),
            ('stage_history', 'volunteer_stage_history', false, false),
            ('saved_opportunity', 'saved_opportunities', false, false),
            ('report_view', 'report_saved_views', false, false),
            ('impact_definition', 'impact_metric_definitions', false, false),
            ('impact_result', 'impact_results', false, false),
            ('audit_event', 'audit_events', false, false),
            ('activity_event', 'activity_events', false, false),
            ('checkin_code', 'checkin_codes', false, false),
            ('notification_rule', 'notification_rules', false, false),
            ('notification', 'notifications', true, false)
        ) as t(entity, table_name, has_version, bumps_revision)
    loop
        if r.has_version then
            execute format(
                'create trigger %I_row_version before update on public.%I
                 for each row execute function private.touch_row_version()',
                r.table_name, r.table_name
            );
        end if;

        if r.table_name = 'organizations' then
            execute format(
                'create trigger %I_change after insert or update on public.%I
                 for each row execute function sync.log_change(%L, %L)',
                r.table_name, r.table_name, r.entity,
                case when r.bumps_revision then 'revision' else 'none' end
            );
        else
            execute format(
                'create trigger %I_change after insert or update or delete on public.%I
                 for each row execute function sync.log_change(%L, %L)',
                r.table_name, r.table_name, r.entity,
                case when r.bumps_revision then 'revision' else 'none' end
            );
        end if;
    end loop;
end;
$$;

create or replace function private.start_organization_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.organization_revisions (organization_id, revision, updated_at)
    values (new.id, 1, now())
    on conflict (organization_id) do nothing;
    return new;
end;
$$;

create trigger organizations_start_revision
after insert on public.organizations
for each row execute function private.start_organization_revision();

-- ---------------------------------------------------------------------------
-- Pull
-- ---------------------------------------------------------------------------

create or replace function sync.change_row(
    p_entity text,
    p_id uuid,
    p_operation text,
    p_row_version integer,
    p_sequence bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_table text;
    v_payload jsonb;
begin
    if p_operation = 'delete' then
        return jsonb_build_object(
            'sequence', p_sequence,
            'entity', p_entity,
            'id', p_id,
            'operation', 'delete',
            'rowVersion', p_row_version
        );
    end if;

    select table_name into v_table
    from sync.entity_tables
    where entity_type = p_entity;

    if v_table is null then
        return null;
    end if;

    -- The table name comes from the whitelist above, never from a client.
    execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table)
        into v_payload
        using p_id;

    if v_payload is null then
        return null;
    end if;

    return jsonb_build_object(
        'sequence', p_sequence,
        'entity', p_entity,
        'id', p_id,
        'operation', p_operation,
        'rowVersion', p_row_version,
        'payload', v_payload
    );
end;
$$;

create or replace function public.pull_changes(
    p_organization_id uuid,
    p_after bigint default 0,
    p_limit integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
    v_changes jsonb := '[]'::jsonb;
    v_count integer := 0;
    v_next bigint := coalesce(p_after, 0);
    v_revision bigint;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden');
    end if;

    with batch as (
        select sequence, entity_type, entity_id, operation, row_version
        from sync.sync_changes
        where organization_id = p_organization_id
          and sequence > coalesce(p_after, 0)
        order by sequence
        limit v_limit
    ),
    resolved as (
        select b.sequence,
               sync.change_row(b.entity_type, b.entity_id, b.operation,
                               b.row_version, b.sequence) as payload
        from batch b
    )
    select coalesce(jsonb_agg(payload order by sequence) filter (where payload is not null),
                    '[]'::jsonb)
    into v_changes
    from resolved;

    select count(*), coalesce(max(sequence), coalesce(p_after, 0))
    into v_count, v_next
    from (
        select sequence from sync.sync_changes
        where organization_id = p_organization_id
          and sequence > coalesce(p_after, 0)
        order by sequence
        limit v_limit
    ) s;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    return jsonb_build_object(
        'status', 'ok',
        'organizationId', p_organization_id,
        'cursor', v_next,
        'hasMore', v_count = v_limit,
        'revision', coalesce(v_revision, 0),
        'changes', v_changes
    );
end;
$$;

-- The membership that decides which workspace the app opens. A volunteer may
-- belong to several organizations; each is returned with its own epoch.
create or replace function public.my_workspaces()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_rows jsonb;
begin
    if auth.uid() is null then
        return jsonb_build_object('status', 'forbidden');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'organizationId', m.organization_id,
        'role', m.role,
        'status', m.status,
        'membershipEpoch', m.membership_epoch,
        'volunteerId', m.volunteer_id,
        'joinedAt', m.joined_at,
        'organization', jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'initials', o.initials,
            'timezone', o.timezone,
            'visibility', o.visibility,
            'image', o.image
        )
    ) order by o.name), '[]'::jsonb)
    into v_rows
    from public.organization_memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid();

    return jsonb_build_object('status', 'ok', 'workspaces', v_rows);
end;
$$;

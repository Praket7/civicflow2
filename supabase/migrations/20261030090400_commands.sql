-- The command authority.
--
-- Clients do not write rows. They submit an intent, and the server decides
-- whether the organization's rules allow it. That distinction is what keeps two
-- offline devices from both claiming the last seat: the server serialises the
-- decision, not a row replacement.
--
-- Every function here is SECURITY DEFINER and reachable only through
-- public.apply_command, which authenticates, checks membership, records the
-- operation in an idempotency ledger, and maps failures onto protocol statuses.

-- ---------------------------------------------------------------------------
-- Shared checks
-- ---------------------------------------------------------------------------

create or replace function sync.fail(
    p_code text,
    p_message text,
    p_authoritative jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- RAISE rejects a null option value, so the hint is only attached when the
    -- command has something authoritative to show the client.
    if p_authoritative is null then
        raise exception '%', p_code
            using errcode = 'P0001', detail = p_message;
    else
        raise exception '%', p_code
            using errcode = 'P0001', detail = p_message,
                  hint = p_authoritative::text;
    end if;

    -- Unreachable: the raise above always exits. The return type lets a
    -- dispatch CASE mix fail() with commands that return a result.
    return null;
end;
$$;

create or replace function sync.error_status(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when p_code in ('forbidden', 'not_a_member', 'unauthenticated') then 'forbidden'
        when p_code = 'stale_authority' then 'stale_authority'
        when p_code = 'plan_stale' then 'stale_plan'
        when p_code in (
            'row_version_conflict', 'capacity_full', 'capacity_below_confirmed',
            'shift_overlap', 'already_registered', 'credential_missing',
            'skill_missing', 'age_requirement', 'shift_canceled', 'role_in_use',
            'assignment_locked', 'shift_started', 'already_waitlisted'
        ) then 'conflict'
        when p_code in ('serialization_failure', 'deadlock_detected') then 'retryable_error'
        else 'validation_error'
    end
$$;

create or replace function sync.check_version(
    p_versions jsonb,
    p_id uuid,
    p_current integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_expected integer;
begin
    if p_versions is null then
        return;
    end if;

    v_expected := nullif((p_versions ->> (p_id::text)), '')::integer;

    -- A caller that names a version gets strict behaviour. A caller that does
    -- not is trusted to the command's own invariant checks, never to a row
    -- replacement.
    if v_expected is not null and v_expected <> p_current then
        perform sync.fail(
            'row_version_conflict',
            format('This record changed elsewhere (server version %s, you had %s).',
                   p_current, v_expected),
            jsonb_build_object('rowVersion', p_current)
        );
    end if;
end;
$$;

create or replace function sync.volunteer_for(
    p_organization_id uuid,
    p_actor uuid,
    p_role text,
    p_requested uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_own uuid;
begin
    if p_requested is not null then
        if p_role in ('owner', 'coordinator') then
            if not exists (
                select 1 from public.volunteers
                where id = p_requested and organization_id = p_organization_id
            ) then
                perform sync.fail('not_found', 'That volunteer is not in this organization.');
            end if;
            return p_requested;
        end if;

        select m.volunteer_id into v_own
        from public.organization_memberships m
        where m.organization_id = p_organization_id
          and m.user_id = p_actor
          and m.status = 'active';

        if v_own is distinct from p_requested then
            perform sync.fail('forbidden', 'You can only change your own volunteer record.');
        end if;
        return p_requested;
    end if;

    select m.volunteer_id into v_own
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_actor
      and m.status = 'active';

    if v_own is null then
        perform sync.fail(
            'no_volunteer_profile',
            'This account has no volunteer profile in that organization.'
        );
    end if;

    return v_own;
end;
$$;

create or replace function sync.assert_eligible(
    p_organization_id uuid,
    p_shift_id uuid,
    p_volunteer_id uuid,
    p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    r record;
    v_age integer;
begin
    if p_role is null or btrim(p_role) = '' then
        return;
    end if;

    if not exists (
        select 1 from public.shift_roles
        where shift_id = p_shift_id and name = p_role
    ) then
        perform sync.fail('unknown_role', 'That shift does not have the requested role.');
    end if;

    for r in
        select * from public.role_requirements
        where shift_id = p_shift_id and role_name = p_role
    loop
        if r.skill is not null and not exists (
            select 1 from public.volunteer_skills
            where volunteer_id = p_volunteer_id and skill = r.skill
        ) then
            perform sync.fail('skill_missing', format('This role needs the %s skill.', r.skill));
        end if;

        if r.credential_type_id is not null and not exists (
            select 1 from public.volunteer_credentials c
            where c.volunteer_id = p_volunteer_id
              and c.credential_type_id = r.credential_type_id
              and c.valid_from <= current_date
              and c.valid_through >= current_date
        ) then
            perform sync.fail('credential_missing', 'This role needs a current credential.');
        end if;

        if r.minimum_age is not null then
            select case when birthdate is null then null
                        else date_part('year', age(current_date, birthdate))::integer end
            into v_age
            from public.volunteers
            where id = p_volunteer_id;

            if v_age is null or v_age < r.minimum_age then
                perform sync.fail('age_requirement',
                    format('This role is limited to volunteers aged %s or older.', r.minimum_age));
            end if;
        end if;
    end loop;
end;
$$;

create or replace function sync.assert_no_overlap(
    p_organization_id uuid,
    p_volunteer_id uuid,
    p_shift_id uuid,
    p_starts_at timestamptz,
    p_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if exists (
        select 1
        from public.registrations r
        join public.shifts s on s.id = r.shift_id
        where r.organization_id = p_organization_id
          and r.volunteer_id = p_volunteer_id
          and r.shift_id <> p_shift_id
          and r.status in ('registered', 'confirmed')
          and s.status = 'scheduled'
          and s.starts_at < p_ends_at
          and s.ends_at > p_starts_at
    ) then
        perform sync.fail(
            'shift_overlap',
            'This volunteer is already scheduled for an overlapping shift.'
        );
    end if;
end;
$$;

create or replace function sync.notify(
    p_organization_id uuid,
    p_volunteer_id uuid,
    p_kind text,
    p_title text,
    p_body text,
    p_href text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := gen_random_uuid();
begin
    if p_volunteer_id is null then
        return null;
    end if;

    insert into public.notifications
        (id, organization_id, kind, title, body, priority, href, audience, volunteer_id)
    values
        (v_id, p_organization_id, p_kind, p_title, p_body, 'normal', p_href, 'volunteer', p_volunteer_id);

    return v_id;
end;
$$;

create or replace function sync.audit(
    p_organization_id uuid,
    p_actor uuid,
    p_action text,
    p_entity_type text,
    p_entity_id text,
    p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.audit_events
        (organization_id, actor_type, actor_id, action, entity_type, entity_id, summary)
    values
        (p_organization_id, 'user', coalesce(p_actor::text, ''), p_action,
         p_entity_type, p_entity_id, p_summary);
end;
$$;

create or replace function sync.change(p_entity text, p_id uuid, p_operation text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select jsonb_build_object('entity', p_entity, 'id', p_id, 'operation', p_operation)
$$;

create or replace function sync.applied(
    p_changes jsonb default '[]'::jsonb,
    p_data jsonb default '{}'::jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
    select jsonb_build_object(
        'status', 'applied',
        'changes', coalesce(p_changes, '[]'::jsonb),
        'data', coalesce(p_data, '{}'::jsonb)
    )
$$;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

create or replace function sync.cmd_create_opportunity(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, gen_random_uuid());
    v_title text := btrim(coalesce(p_payload ->> 'title', ''));
    v_slug text := btrim(coalesce(p_payload ->> 'slug', ''));
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can create an opportunity.');
    end if;

    if v_title = '' then
        perform sync.fail('title_required', 'Give the opportunity a title.');
    end if;

    if v_slug = '' then
        v_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
        v_slug := btrim(v_slug, '-');
    end if;

    if exists (
        select 1 from public.opportunities
        where organization_id = p_org and slug = v_slug and id <> v_id
    ) then
        perform sync.fail('slug_taken', 'Another opportunity already uses that address.');
    end if;

    insert into public.opportunities
        (id, organization_id, slug, title, cause, organization_name, image, image_alt,
         description, address, distance_miles, coordinator, capacity, duration,
         training, requirements, impact_metric)
    values
        (v_id, p_org, v_slug, v_title,
         coalesce(p_payload ->> 'cause', ''),
         coalesce(p_payload ->> 'organizationName', ''),
         coalesce(p_payload ->> 'image', ''),
         coalesce(p_payload ->> 'imageAlt', ''),
         coalesce(p_payload ->> 'description', ''),
         coalesce(p_payload ->> 'address', ''),
         coalesce((p_payload ->> 'distanceMiles')::numeric, 0),
         coalesce(p_payload ->> 'coordinator', ''),
         greatest(coalesce((p_payload ->> 'capacity')::integer, 1), 1),
         coalesce(p_payload ->> 'duration', ''),
         coalesce(p_payload -> 'training', '[]'::jsonb),
         coalesce(p_payload -> 'requirements', '[]'::jsonb),
         coalesce(p_payload ->> 'impactMetric', ''))
    on conflict (id) do nothing;

    if not found then
        perform sync.fail('duplicate_opportunity', 'That opportunity id already exists.');
    end if;

    perform sync.audit(p_org, p_actor, 'opportunity.create', 'opportunity', v_id::text, v_title);

    return sync.applied(
        jsonb_build_array(sync.change('opportunity', v_id, 'insert')),
        jsonb_build_object('id', v_id, 'slug', v_slug)
    );
end;
$$;

create or replace function sync.cmd_update_opportunity(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
    v_current integer;
    v_after integer;
    v_slug text := btrim(coalesce(p_payload ->> 'slug', ''));
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can edit an opportunity.');
    end if;

    select row_version into v_current
    from public.opportunities
    where id = v_id and organization_id = p_org
    for update;

    if not found then
        perform sync.fail('not_found', 'That opportunity is not in this organization.');
    end if;

    perform sync.check_version(p_versions, v_id, v_current);

    if v_slug <> '' and exists (
        select 1 from public.opportunities
        where organization_id = p_org and slug = v_slug and id <> v_id
    ) then
        perform sync.fail('slug_taken', 'Another opportunity already uses that address.');
    end if;

    update public.opportunities
    set title = coalesce(p_payload ->> 'title', title),
        slug = case when v_slug = '' then slug else v_slug end,
        cause = coalesce(p_payload ->> 'cause', cause),
        organization_name = coalesce(p_payload ->> 'organizationName', organization_name),
        image = coalesce(p_payload ->> 'image', image),
        image_alt = coalesce(p_payload ->> 'imageAlt', image_alt),
        description = coalesce(p_payload ->> 'description', description),
        address = coalesce(p_payload ->> 'address', address),
        distance_miles = coalesce((p_payload ->> 'distanceMiles')::numeric, distance_miles),
        coordinator = coalesce(p_payload ->> 'coordinator', coordinator),
        capacity = coalesce((p_payload ->> 'capacity')::integer, capacity),
        duration = coalesce(p_payload ->> 'duration', duration),
        training = coalesce(p_payload -> 'training', training),
        requirements = coalesce(p_payload -> 'requirements', requirements),
        impact_metric = coalesce(p_payload ->> 'impactMetric', impact_metric)
    where id = v_id;

    select row_version into v_after from public.opportunities where id = v_id;

    perform sync.audit(p_org, p_actor, 'opportunity.update', 'opportunity', v_id::text,
                       coalesce(p_payload ->> 'title', ''));

    return sync.applied(
        jsonb_build_array(sync.change('opportunity', v_id, 'update')),
        jsonb_build_object('id', v_id, 'rowVersion', v_after)
    );
end;
$$;

create or replace function sync.cmd_create_shift(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, gen_random_uuid());
    v_opportunity uuid := nullif(p_payload ->> 'opportunityId', '')::uuid;
    v_starts timestamptz := (p_payload ->> 'startsAt')::timestamptz;
    v_ends timestamptz := (p_payload ->> 'endsAt')::timestamptz;
    v_capacity integer := coalesce((p_payload ->> 'capacity')::integer, 0);
    v_role record;
    v_changes jsonb := '[]'::jsonb;
    v_role_id uuid;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can create a shift.');
    end if;

    if not exists (
        select 1 from public.opportunities
        where id = v_opportunity and organization_id = p_org
    ) then
        perform sync.fail('not_found', 'That opportunity is not in this organization.');
    end if;

    if v_starts is null or v_ends is null or v_ends <= v_starts then
        perform sync.fail('invalid_window', 'A shift has to end after it starts.');
    end if;

    if v_capacity < 1 then
        perform sync.fail('invalid_capacity', 'A shift needs at least one seat.');
    end if;

    insert into public.shifts
        (id, organization_id, opportunity_id, starts_at, ends_at, capacity,
         series_id, occurrence_date)
    values
        (v_id, p_org, v_opportunity, v_starts, v_ends, v_capacity,
         nullif(p_payload ->> 'seriesId', '')::uuid,
         nullif(p_payload ->> 'occurrenceDate', '')::date)
    on conflict (id) do nothing;

    if not found then
        perform sync.fail('duplicate_shift', 'That shift id already exists.');
    end if;

    v_changes := v_changes || jsonb_build_array(sync.change('shift', v_id, 'insert'));

    for v_role in
        select * from jsonb_to_recordset(coalesce(p_payload -> 'roles', '[]'::jsonb))
            as r(name text, required integer)
    loop
        if btrim(coalesce(v_role.name, '')) <> '' then
            insert into public.shift_roles (organization_id, shift_id, name, required)
            values (p_org, v_id, v_role.name, greatest(coalesce(v_role.required, 0), 0))
            on conflict (shift_id, name) do update set required = excluded.required
            returning id into v_role_id;

            v_changes := v_changes || jsonb_build_array(sync.change('shift_role', v_role_id, 'insert'));
        end if;
    end loop;

    perform sync.audit(p_org, p_actor, 'shift.create', 'shift', v_id::text,
                       format('%s to %s', v_starts, v_ends));

    return sync.applied(v_changes, jsonb_build_object('id', v_id));
end;
$$;

create or replace function sync.cmd_update_shift(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := nullif(p_payload ->> 'id', '')::uuid;
    v_current integer;
    v_after integer;
    v_shift public.shifts%rowtype;
    v_capacity integer;
    v_status text;
    v_changes jsonb := '[]'::jsonb;
    v_role record;
    r record;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can edit a shift.');
    end if;

    select * into v_shift
    from public.shifts
    where id = v_id and organization_id = p_org
    for update;

    if not found then
        perform sync.fail('not_found', 'That shift is not in this organization.');
    end if;

    v_current := v_shift.row_version;
    perform sync.check_version(p_versions, v_id, v_current);

    v_capacity := coalesce((p_payload ->> 'capacity')::integer, v_shift.capacity);
    if v_capacity < v_shift.confirmed then
        perform sync.fail(
            'capacity_below_confirmed',
            format('%s volunteers already hold seats; cancel some before shrinking the shift.',
                   v_shift.confirmed),
            jsonb_build_object('rowVersion', v_current, 'confirmed', v_shift.confirmed)
        );
    end if;

    v_status := coalesce(p_payload ->> 'status', v_shift.status);

    if v_status = 'canceled' and v_shift.status <> 'canceled' then
        -- A canceled shift cannot strand confirmed volunteers in a seat that no
        -- longer exists. Every active registration is canceled and the waitlist
        -- is closed in the same transaction.
        for r in
            select * from public.registrations
            where shift_id = v_id and status in ('registered', 'confirmed')
        loop
            perform sync.notify(
                p_org, r.volunteer_id, 'shift_canceled',
                'Shift canceled',
                format('%s was canceled.', coalesce(
                    (select title from public.opportunities o
                     join public.shifts s on s.opportunity_id = o.id
                     where s.id = v_id), 'A shift')),
                '/volunteer/schedule'
            );
        end loop;

        update public.registrations
        set status = 'canceled', updated_at = now()
        where shift_id = v_id and status in ('registered', 'confirmed');

        update public.waitlist_entries
        set status = 'expired'
        where shift_id = v_id and status = 'waiting';
    end if;

    update public.shifts
    set starts_at = coalesce((p_payload ->> 'startsAt')::timestamptz, starts_at),
        ends_at = coalesce((p_payload ->> 'endsAt')::timestamptz, ends_at),
        capacity = v_capacity,
        status = v_status
    where id = v_id;

    v_changes := v_changes || jsonb_build_array(sync.change('shift', v_id, 'update'));

    if p_payload ? 'roles' then
        for r in
            select name from public.shift_roles
            where shift_id = v_id
              and name not in (
                  select name from jsonb_to_recordset(coalesce(p_payload -> 'roles', '[]'::jsonb))
                      as x(name text)
              )
        loop
            if exists (select 1 from public.registrations where shift_id = v_id and role = r.name) then
                perform sync.fail('role_in_use',
                    format('The %s role still has volunteers assigned.', r.name));
            end if;
            delete from public.shift_roles where shift_id = v_id and name = r.name;
        end loop;

        for v_role in
            select * from jsonb_to_recordset(coalesce(p_payload -> 'roles', '[]'::jsonb))
                as x(name text, required integer)
        loop
            if btrim(coalesce(v_role.name, '')) <> '' then
                insert into public.shift_roles (organization_id, shift_id, name, required)
                values (p_org, v_id, v_role.name, greatest(coalesce(v_role.required, 0), 0))
                on conflict (shift_id, name) do update set required = excluded.required;
            end if;
        end loop;
    end if;

    select row_version into v_after from public.shifts where id = v_id;

    perform sync.audit(p_org, p_actor, 'shift.update', 'shift', v_id::text, v_status);

    return sync.applied(v_changes, jsonb_build_object('id', v_id, 'rowVersion', v_after));
end;
$$;

-- ---------------------------------------------------------------------------
-- Seats and waitlist
-- ---------------------------------------------------------------------------

create or replace function sync.promote_waitlist(p_org uuid, p_shift uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift public.shifts%rowtype;
    v_next public.waitlist_entries%rowtype;
    v_seats integer;
begin
    select * into v_shift from public.shifts where id = p_shift for update;
    if not found or v_shift.status <> 'scheduled' then
        return null;
    end if;

    if v_shift.confirmed >= v_shift.capacity then
        return null;
    end if;

    select * into v_next
    from public.waitlist_entries
    where shift_id = p_shift and status = 'waiting'
    order by position
    limit 1
    for update;

    if not found then
        return null;
    end if;

    insert into public.registrations (organization_id, shift_id, volunteer_id, role, status)
    values (p_org, p_shift, v_next.volunteer_id, v_next.eligible_role, 'registered')
    on conflict (shift_id, volunteer_id) do update
        set status = 'registered', updated_at = now();

    update public.waitlist_entries
    set status = 'promoted'
    where id = v_next.id;

    perform sync.notify(
        p_org, v_next.volunteer_id, 'waitlist_promoted',
        'A seat opened up',
        'You were moved from the waitlist into a confirmed seat.',
        '/volunteer/schedule'
    );

    select * into v_shift from public.shifts where id = p_shift;
    return v_next.volunteer_id;
end;
$$;

create or replace function sync.cmd_register(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift_id uuid := nullif(p_payload ->> 'shiftId', '')::uuid;
    v_volunteer uuid;
    v_shift public.shifts%rowtype;
    v_registration public.registrations%rowtype;
    v_existing boolean := false;
    v_role_name text := coalesce(p_payload ->> 'role', '');
    v_allow_waitlist boolean := coalesce((p_payload ->> 'allowWaitlist')::boolean, false);
    v_waitlist public.waitlist_entries%rowtype;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    select * into v_shift
    from public.shifts
    where id = v_shift_id and organization_id = p_org
    for update;

    if not found then
        perform sync.fail('not_found', 'That shift is not in this organization.');
    end if;

    if v_shift.status <> 'scheduled' then
        perform sync.fail('shift_canceled', 'That shift is no longer open.', 
            jsonb_build_object('status', v_shift.status));
    end if;

    if v_shift.ends_at < now() and p_role not in ('owner', 'coordinator') then
        perform sync.fail('shift_started', 'That shift has already finished.');
    end if;

    select * into v_registration
    from public.registrations
    where shift_id = v_shift_id and volunteer_id = v_volunteer
    for update;

    v_existing := found;

    if v_existing and v_registration.status in ('registered', 'confirmed') then
        return sync.applied('[]'::jsonb, jsonb_build_object(
            'registrationId', v_registration.id, 'noOp', true,
            'message', 'You are already registered for this shift.'));
    end if;

    perform sync.assert_eligible(p_org, v_shift_id, v_volunteer, v_role_name);
    perform sync.assert_no_overlap(p_org, v_volunteer, v_shift_id, v_shift.starts_at, v_shift.ends_at);

    if v_shift.confirmed >= v_shift.capacity then
        if not v_allow_waitlist then
            perform sync.fail(
                'capacity_full',
                'Every seat on this shift is taken.',
                jsonb_build_object('capacity', v_shift.capacity,
                                   'confirmed', v_shift.confirmed)
            );
        end if;

        insert into public.waitlist_entries
            (organization_id, shift_id, volunteer_id, eligible_role, position)
        values (p_org, v_shift_id, v_volunteer, v_role_name, 1)
        on conflict (shift_id, volunteer_id) do update
            set status = 'waiting'
        returning * into v_waitlist;

        return sync.applied(
            jsonb_build_array(sync.change('waitlist_entry', v_waitlist.id, 'insert')),
            jsonb_build_object('waitlisted', true, 'position', v_waitlist.position)
        );
    end if;

    if v_existing then
        update public.registrations
        set status = 'registered', role = v_role_name, updated_at = now()
        where id = v_registration.id
        returning * into v_registration;
    else
        insert into public.registrations
            (organization_id, shift_id, volunteer_id, role, status)
        values (p_org, v_shift_id, v_volunteer, v_role_name, 'registered')
        returning * into v_registration;
    end if;

    insert into public.attendance_events
        (organization_id, shift_id, volunteer_id, role, status, recorded_at)
    values (p_org, v_shift_id, v_volunteer, v_role_name, 'expected', now())
    on conflict (shift_id, volunteer_id) do nothing;

    perform sync.audit(p_org, p_actor, 'registration.create', 'registration',
                       v_registration.id::text, 'Seat confirmed');

    return sync.applied(
        jsonb_build_array(
            sync.change('registration', v_registration.id, 'insert'),
            sync.change('attendance', (
                select id from public.attendance_events
                where shift_id = v_shift_id and volunteer_id = v_volunteer), 'insert')
        ),
        jsonb_build_object('registrationId', v_registration.id,
                           'startsAt', v_shift.starts_at)
    );
end;
$$;

create or replace function sync.cmd_cancel_registration(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift_id uuid := nullif(p_payload ->> 'shiftId', '')::uuid;
    v_volunteer uuid;
    v_registration public.registrations%rowtype;
    v_promoted uuid;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    -- Lock the shift before the seat so every command takes the same order.
    perform 1 from public.shifts
    where id = v_shift_id and organization_id = p_org
    for update;

    select * into v_registration
    from public.registrations
    where shift_id = v_shift_id
      and organization_id = p_org
      and volunteer_id = v_volunteer
    for update;

    if not found or v_registration.status in ('canceled', 'no_show') then
        return sync.applied('[]'::jsonb, jsonb_build_object('noOp', true));
    end if;

    update public.registrations
    set status = 'canceled', updated_at = now()
    where id = v_registration.id;

    delete from public.attendance_events
    where shift_id = v_shift_id
      and volunteer_id = v_volunteer
      and status = 'expected';

    v_promoted := sync.promote_waitlist(p_org, v_shift_id);

    perform sync.audit(p_org, p_actor, 'registration.cancel', 'registration',
                       v_registration.id::text, 'Seat released');

    return sync.applied(
        jsonb_build_array(sync.change('registration', v_registration.id, 'update')),
        jsonb_build_object('promoted', v_promoted)
    );
end;
$$;

create or replace function sync.cmd_join_waitlist(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift_id uuid := nullif(p_payload ->> 'shiftId', '')::uuid;
    v_volunteer uuid;
    v_entry public.waitlist_entries%rowtype;
    v_registration public.registrations%rowtype;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    if not exists (select 1 from public.shifts where id = v_shift_id and organization_id = p_org) then
        perform sync.fail('not_found', 'That shift is not in this organization.');
    end if;

    select * into v_registration
    from public.registrations
    where shift_id = v_shift_id and volunteer_id = v_volunteer;

    if found and v_registration.status in ('registered', 'confirmed') then
        perform sync.fail('already_registered', 'You already hold a seat on this shift.');
    end if;

    insert into public.waitlist_entries
        (organization_id, shift_id, volunteer_id, eligible_role, position)
    values (p_org, v_shift_id, v_volunteer, coalesce(p_payload ->> 'role', ''), 1)
    on conflict (shift_id, volunteer_id) do update
        set status = 'waiting'
    returning * into v_entry;

    return sync.applied(
        jsonb_build_array(sync.change('waitlist_entry', v_entry.id, 'insert')),
        jsonb_build_object('position', v_entry.position)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------

create or replace function sync.cmd_check_in(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift_id uuid := nullif(p_payload ->> 'shiftId', '')::uuid;
    v_volunteer uuid;
    v_staff boolean := p_role in ('owner', 'coordinator');
    v_shift public.shifts%rowtype;
    v_registration public.registrations%rowtype;
    v_attendance public.attendance_events%rowtype;
    v_code_id uuid;
    v_now timestamptz := now();
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    select * into v_shift
    from public.shifts
    where id = v_shift_id and organization_id = p_org
    for update;

    if not found then
        perform sync.fail('not_found', 'That shift is not in this organization.');
    end if;

    if v_now < v_shift.starts_at - interval '60 minutes' then
        perform sync.fail('check_in_not_open',
            'Check-in opens an hour before the shift starts.',
            jsonb_build_object('opensAt', v_shift.starts_at - interval '60 minutes'));
    end if;

    if v_now > v_shift.ends_at then
        perform sync.fail('check_in_closed', 'That shift has already ended.');
    end if;

    if not v_staff then
        if coalesce(p_payload ->> 'code', '') = '' then
            perform sync.fail('code_required', 'Scan the shift code to check in.');
        end if;

        select id into v_code_id
        from public.checkin_codes
        where organization_id = p_org
          and shift_id = v_shift_id
          and active
          and consumed_at is null
          and expires_at > v_now
          and (token = p_payload ->> 'code' or code = p_payload ->> 'code')
        for update;

        if not found then
            perform sync.fail('invalid_code', 'That code has expired. Ask for the current one.');
        end if;

        update public.checkin_codes
        set consumed_at = v_now, active = false
        where id = v_code_id;
    end if;

    select * into v_registration
    from public.registrations
    where shift_id = v_shift_id and volunteer_id = v_volunteer;

    if not found or v_registration.status not in ('registered', 'confirmed') then
        perform sync.fail('not_registered', 'Only a registered volunteer can check in.');
    end if;

    select * into v_attendance
    from public.attendance_events
    where shift_id = v_shift_id and volunteer_id = v_volunteer
    for update;

    if found and v_attendance.status in ('checked_in', 'completed') then
        return sync.applied('[]'::jsonb, jsonb_build_object(
            'attendanceId', v_attendance.id, 'noOp', true,
            'checkedInAt', v_attendance.checked_in_at));
    end if;

    insert into public.attendance_events
        (organization_id, shift_id, volunteer_id, role, status, checked_in_at, recorded_at)
    values (p_org, v_shift_id, v_volunteer, v_registration.role, 'checked_in', v_now, v_now)
    on conflict (shift_id, volunteer_id) do update
        set status = 'checked_in',
            checked_in_at = excluded.checked_in_at,
            checked_out_at = null,
            role = excluded.role
    returning * into v_attendance;

    insert into public.attendance_ledger
        (organization_id, shift_id, volunteer_id, event_type, actor, note, at)
    values (p_org, v_shift_id, v_volunteer,
            case when v_staff then 'manual_check_in' else 'check_in' end,
            p_actor::text, p_payload ->> 'clientAt', v_now);

    perform sync.audit(p_org, p_actor, 'attendance.check_in', 'attendance',
                       v_attendance.id::text, 'Checked in');

    return sync.applied(
        jsonb_build_array(sync.change('attendance', v_attendance.id, 'update')),
        jsonb_build_object('attendanceId', v_attendance.id, 'checkedInAt', v_now)
    );
end;
$$;

create or replace function sync.cmd_check_out(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift_id uuid := nullif(p_payload ->> 'shiftId', '')::uuid;
    v_volunteer uuid;
    v_shift public.shifts%rowtype;
    v_attendance public.attendance_events%rowtype;
    v_hours public.hour_entries%rowtype;
    v_minutes integer;
    v_scheduled integer;
    v_now timestamptz := now();
    v_opportunity uuid;
    v_date date;
    v_timezone text;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    select * into v_shift
    from public.shifts
    where id = v_shift_id and organization_id = p_org
    for update;

    select timezone into v_timezone
    from public.organizations
    where id = p_org;

    if not found then
        perform sync.fail('not_found', 'That shift is not in this organization.');
    end if;

    select * into v_attendance
    from public.attendance_events
    where shift_id = v_shift_id and volunteer_id = v_volunteer
    for update;

    if not found then
        perform sync.fail('not_checked_in', 'Check in before checking out.');
    end if;

    if v_attendance.status = 'completed' then
        return sync.applied('[]'::jsonb, jsonb_build_object(
            'attendanceId', v_attendance.id, 'noOp', true));
    end if;

    if v_attendance.status <> 'checked_in' then
        perform sync.fail('not_checked_in', 'Check in before checking out.');
    end if;

    update public.attendance_events
    set status = 'completed', checked_out_at = v_now
    where id = v_attendance.id
    returning * into v_attendance;

    v_minutes := greatest(1, round(extract(epoch from (v_now - v_attendance.checked_in_at)) / 60));
    v_scheduled := round(extract(epoch from (v_shift.ends_at - v_shift.starts_at)) / 60);
    v_opportunity := v_shift.opportunity_id;
    v_date := (v_shift.starts_at at time zone coalesce(v_timezone, 'America/New_York'))::date;

    insert into public.attendance_ledger
        (organization_id, shift_id, volunteer_id, event_type, actor, note, at)
    values (p_org, v_shift_id, v_volunteer,
            case when p_role in ('owner', 'coordinator') then 'manual_check_out' else 'check_out' end,
            p_actor::text, p_payload ->> 'clientAt', v_now);

    select * into v_hours
    from public.hour_entries
    where source_shift_id = v_shift_id and volunteer_id = v_volunteer;

    if found then
        update public.hour_entries
        set minutes = v_minutes,
            calculated_minutes = v_minutes,
            scheduled_minutes = v_scheduled
        where id = v_hours.id;
    else
        insert into public.hour_entries
            (organization_id, volunteer_id, opportunity_id, date, minutes, status,
             scheduled_minutes, calculated_minutes, source_shift_id)
        values
            (p_org, v_volunteer, v_opportunity, v_date, v_minutes, 'pending',
             v_scheduled, v_minutes, v_shift_id)
        returning * into v_hours;
    end if;

    perform sync.audit(p_org, p_actor, 'attendance.check_out', 'attendance',
                       v_attendance.id::text, format('%s minutes recorded', v_minutes));

    return sync.applied(
        jsonb_build_array(
            sync.change('attendance', v_attendance.id, 'update'),
            sync.change('hour_entry', v_hours.id, 'insert')
        ),
        jsonb_build_object('attendanceId', v_attendance.id,
                           'minutes', v_minutes, 'hourEntryId', v_hours.id)
    );
end;
$$;

create or replace function sync.cmd_mark_no_show(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_shift_id uuid := nullif(p_payload ->> 'shiftId', '')::uuid;
    v_volunteer uuid;
    v_attendance public.attendance_events%rowtype;
    v_registration public.registrations%rowtype;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can record a no-show.');
    end if;

    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    perform 1 from public.shifts
    where id = v_shift_id and organization_id = p_org
    for update;

    select * into v_registration
    from public.registrations
    where shift_id = v_shift_id and volunteer_id = v_volunteer
    for update;

    if not found then
        perform sync.fail('not_registered', 'That volunteer is not registered for the shift.');
    end if;

    insert into public.attendance_events
        (organization_id, shift_id, volunteer_id, role, status, recorded_at)
    values (p_org, v_shift_id, v_volunteer, v_registration.role, 'no_show', now())
    on conflict (shift_id, volunteer_id) do update
        set status = 'no_show', checked_out_at = null
    returning * into v_attendance;

    update public.registrations
    set status = 'no_show', updated_at = now()
    where id = v_registration.id;

    insert into public.attendance_ledger
        (organization_id, shift_id, volunteer_id, event_type, actor, note, at)
    values (p_org, v_shift_id, v_volunteer, 'marked_no_show', p_actor::text,
            p_payload ->> 'note', now());

    perform sync.audit(p_org, p_actor, 'attendance.no_show', 'attendance',
                       v_attendance.id::text, 'Marked no-show');

    return sync.applied(
        jsonb_build_array(
            sync.change('attendance', v_attendance.id, 'update'),
            sync.change('registration', v_registration.id, 'update')
        ),
        jsonb_build_object('attendanceId', v_attendance.id)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile, credentials and hours
-- ---------------------------------------------------------------------------

create or replace function sync.cmd_save_volunteer_profile(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_volunteer uuid;
    v_current integer;
    v_after integer;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    select row_version into v_current
    from public.volunteers
    where id = v_volunteer and organization_id = p_org
    for update;

    if not found then
        perform sync.fail('not_found', 'That volunteer is not in this organization.');
    end if;

    perform sync.check_version(p_versions, v_volunteer, v_current);

    if coalesce(p_payload ->> 'email', '') <> '' and exists (
        select 1 from public.volunteers
        where organization_id = p_org
          and lower(email) = lower(p_payload ->> 'email')
          and id <> v_volunteer
    ) then
        perform sync.fail('email_taken', 'Another volunteer already uses that email address.');
    end if;

    update public.volunteers
    set name = coalesce(p_payload ->> 'name', name),
        first_name = coalesce(p_payload ->> 'firstName', first_name),
        initials = coalesce(p_payload ->> 'initials', initials),
        email = coalesce(p_payload ->> 'email', email),
        phone = coalesce(p_payload ->> 'phone', phone),
        role = coalesce(p_payload ->> 'role', role),
        tone = coalesce(p_payload ->> 'tone', tone),
        interests = coalesce(p_payload ->> 'interests', interests),
        photo = coalesce(p_payload ->> 'photo', photo),
        birthdate = coalesce((p_payload ->> 'birthdate')::date, birthdate),
        onboarding_completed = coalesce((p_payload ->> 'onboardingCompleted')::boolean,
                                        onboarding_completed),
        languages = coalesce(p_payload -> 'languages', languages),
        causes = coalesce(p_payload -> 'causes', causes),
        availability = coalesce(p_payload -> 'availability', availability)
    where id = v_volunteer;

    select row_version into v_after from public.volunteers where id = v_volunteer;

    return sync.applied(
        jsonb_build_array(sync.change('volunteer', v_volunteer, 'update')),
        jsonb_build_object('rowVersion', v_after)
    );
end;
$$;

create or replace function sync.cmd_update_credential(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_staff boolean := p_role in ('owner', 'coordinator');
    v_credential_id uuid := nullif(p_payload ->> 'id', '')::uuid;
    v_volunteer uuid;
    v_type uuid := nullif(p_payload ->> 'credentialTypeId', '')::uuid;
    v_current integer;
    v_after integer;
    v_exists boolean := false;
    v_changes jsonb := '[]'::jsonb;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    if v_credential_id is not null then
        select row_version into v_current
        from public.volunteer_credentials
        where id = v_credential_id
          and organization_id = p_org
          and volunteer_id = v_volunteer
        for update;

        if not found then
            perform sync.fail('not_found', 'That credential is not on this volunteer.');
        end if;

        perform sync.check_version(p_versions, v_credential_id, v_current);
        v_exists := true;
    end if;

    if v_type is null or not exists (
        select 1 from public.credential_types where id = v_type and organization_id = p_org
    ) then
        perform sync.fail('not_found', 'Choose a credential type for this organization.');
    end if;

    if v_exists then
        update public.volunteer_credentials
        set credential_type_id = v_type,
            identifier = coalesce(p_payload ->> 'identifier', identifier),
            issued_at = coalesce((p_payload ->> 'issuedAt')::date, issued_at),
            valid_from = coalesce((p_payload ->> 'validFrom')::date, valid_from),
            valid_through = coalesce((p_payload ->> 'validThrough')::date, valid_through),
            notes = coalesce(p_payload ->> 'notes', notes),
            verified_at = case when v_staff and coalesce((p_payload ->> 'verified')::boolean, false)
                               then now() else verified_at end,
            verified_by = case when v_staff and coalesce((p_payload ->> 'verified')::boolean, false)
                               then p_actor::text else verified_by end
        where id = v_credential_id;
    else
        v_credential_id := gen_random_uuid();
        insert into public.volunteer_credentials
            (id, organization_id, volunteer_id, credential_type_id, identifier,
             issued_at, valid_from, valid_through, notes, verified_at, verified_by)
        values
            (v_credential_id, p_org, v_volunteer, v_type,
             coalesce(p_payload ->> 'identifier', ''),
             coalesce((p_payload ->> 'issuedAt')::date, current_date),
             coalesce((p_payload ->> 'validFrom')::date, current_date),
             coalesce((p_payload ->> 'validThrough')::date, current_date + 365),
             p_payload ->> 'notes',
             case when v_staff and coalesce((p_payload ->> 'verified')::boolean, false)
                  then now() end,
             case when v_staff and coalesce((p_payload ->> 'verified')::boolean, false)
                  then p_actor::text end);
    end if;

    select row_version into v_after
    from public.volunteer_credentials where id = v_credential_id;

    v_changes := jsonb_build_array(sync.change('credential', v_credential_id,
        case when v_exists then 'update' else 'insert' end));

    return sync.applied(v_changes, jsonb_build_object(
        'id', v_credential_id, 'rowVersion', v_after));
end;
$$;

create or replace function sync.cmd_review_hours(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := nullif(p_payload ->> 'hourEntryId', '')::uuid;
    v_status text := coalesce(p_payload ->> 'status', '');
    v_entry public.hour_entries%rowtype;
    v_minutes integer;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can review hours.');
    end if;

    if v_status not in ('verified', 'rejected', 'pending') then
        perform sync.fail('invalid_status', 'A review is verified, rejected, or returned to pending.');
    end if;

    select * into v_entry
    from public.hour_entries
    where id = v_id and organization_id = p_org
    for update;

    if not found then
        perform sync.fail('not_found', 'That hour entry is not in this organization.');
    end if;

    v_minutes := coalesce((p_payload ->> 'approvedMinutes')::integer, v_entry.minutes);

    if v_status = 'verified' and (v_minutes < 0 or v_minutes > v_entry.minutes) then
        perform sync.fail('invalid_minutes',
            'Approved minutes have to fall between zero and the submitted total.');
    end if;

    update public.hour_entries
    set status = v_status,
        approved_minutes = case when v_status = 'verified' then v_minutes else null end,
        reviewed_at = now(),
        reviewer = p_actor::text,
        review_reason = p_payload ->> 'reason'
    where id = v_id;

    perform sync.audit(p_org, p_actor, 'hours.review', 'hour_entry', v_id::text, v_status);

    return sync.applied(
        jsonb_build_array(sync.change('hour_entry', v_id, 'update')),
        jsonb_build_object('status', v_status, 'approvedMinutes', v_minutes)
    );
end;
$$;

create or replace function sync.cmd_update_roster_policy(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_version integer;
    v_id uuid;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can change roster policy.');
    end if;

    if coalesce(p_payload -> 'policy', 'null'::jsonb) = 'null'::jsonb then
        perform sync.fail('policy_required', 'Send the policy document with the command.');
    end if;

    select coalesce(max(version), 0) + 1 into v_version
    from public.organization_roster_policies
    where organization_id = p_org;

    insert into public.organization_roster_policies
        (organization_id, version, policy, updated_by)
    values (p_org, v_version, p_payload -> 'policy', p_actor)
    returning id into v_id;

    perform sync.audit(p_org, p_actor, 'roster_policy.update', 'roster_policy',
                       v_id::text, format('version %s', v_version));

    return sync.applied(
        jsonb_build_array(sync.change('roster_policy', v_id, 'insert')),
        jsonb_build_object('id', v_id, 'version', v_version)
    );
end;
$$;

create or replace function sync.cmd_apply_roster_plan(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_revision bigint;
    v_assignment record;
    v_shift public.shifts%rowtype;
    v_registration public.registrations%rowtype;
    v_applied integer := 0;
    v_canceled integer := 0;
    v_changes jsonb := '[]'::jsonb;
    v_plan_shifts uuid[] := array[]::uuid[];
    v_had_registration boolean := false;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can apply a roster plan.');
    end if;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_org
    for update;

    if v_revision is null then
        perform sync.fail('not_found', 'This organization has no revision yet.');
    end if;

    -- A plan is generated against a revision and applied only to that
    -- revision. There is no attempt to merge two competing plans.
    if p_revision is null or p_revision <> v_revision then
        perform sync.fail(
            'plan_stale',
            'The schedule changed while this plan was being generated. Generate it again.',
            jsonb_build_object('revision', v_revision)
        );
    end if;

    for v_assignment in
        select *
        from jsonb_to_recordset(coalesce(p_payload -> 'assignments', '[]'::jsonb))
            as a("shiftId" uuid, "volunteerId" uuid, role text)
        order by "shiftId", "volunteerId"
    loop
        select * into v_shift
        from public.shifts
        where id = v_assignment."shiftId" and organization_id = p_org
        for update;

        if not found then
            perform sync.fail('not_found', 'The plan names a shift that no longer exists.');
        end if;

        if v_shift.status <> 'scheduled' then
            perform sync.fail('shift_canceled', 'The plan names a canceled shift.');
        end if;

        if not exists (
            select 1 from public.volunteers
            where id = v_assignment."volunteerId" and organization_id = p_org
        ) then
            perform sync.fail('not_found', 'The plan names a volunteer outside this organization.');
        end if;

        select * into v_registration
        from public.registrations
        where shift_id = v_assignment."shiftId"
          and volunteer_id = v_assignment."volunteerId"
        for update;

        v_had_registration := found;

        if v_had_registration and v_registration.locked then
            if v_registration.role is distinct from coalesce(v_assignment.role, '') then
                perform sync.fail('assignment_locked',
                    'A coordinator locked this assignment; the plan cannot move it.');
            end if;
        elsif v_had_registration and v_registration.status in ('registered', 'confirmed') then
            continue;
        elsif v_shift.confirmed >= v_shift.capacity then
            perform sync.fail('capacity_full',
                'The plan would overfill a shift.',
                jsonb_build_object('shiftId', v_shift.id));
        end if;

        perform sync.assert_eligible(p_org, v_assignment."shiftId",
            v_assignment."volunteerId", v_assignment.role);
        perform sync.assert_no_overlap(p_org, v_assignment."volunteerId",
            v_assignment."shiftId", v_shift.starts_at, v_shift.ends_at);

        if v_had_registration then
            update public.registrations
            set status = 'registered', role = coalesce(v_assignment.role, role), updated_at = now()
            where id = v_registration.id
            returning * into v_registration;
        else
            insert into public.registrations
                (organization_id, shift_id, volunteer_id, role, status)
            values (p_org, v_assignment."shiftId", v_assignment."volunteerId",
                    coalesce(v_assignment.role, ''), 'registered')
            returning * into v_registration;

            insert into public.attendance_events
                (organization_id, shift_id, volunteer_id, role, status)
            values (p_org, v_assignment."shiftId", v_assignment."volunteerId",
                    coalesce(v_assignment.role, ''), 'expected')
            on conflict (shift_id, volunteer_id) do nothing;
        end if;

        v_applied := v_applied + 1;
        v_plan_shifts := v_plan_shifts || v_assignment."shiftId";
        v_changes := v_changes || jsonb_build_array(
            sync.change('registration', v_registration.id, 'update'));
    end loop;

    if coalesce((p_payload ->> 'replaceUnlisted')::boolean, false) then
        for v_registration in
            select r.*
            from public.registrations r
            where r.organization_id = p_org
              and r.status in ('registered', 'confirmed')
              and not r.locked
              and r.shift_id = any(v_plan_shifts)
              and not exists (
                  select 1
                  from jsonb_to_recordset(coalesce(p_payload -> 'assignments', '[]'::jsonb))
                      as a("shiftId" uuid, "volunteerId" uuid)
                  where a."shiftId" = r.shift_id and a."volunteerId" = r.volunteer_id
              )
        loop
            update public.registrations
            set status = 'canceled', updated_at = now()
            where id = v_registration.id;
            v_canceled := v_canceled + 1;
            v_changes := v_changes || jsonb_build_array(
                sync.change('registration', v_registration.id, 'update'));
        end loop;
    end if;

    perform sync.audit(p_org, p_actor, 'roster.apply', 'organization', p_org::text,
                       format('%s assignments, %s released', v_applied, v_canceled));

    return sync.applied(v_changes, jsonb_build_object(
        'assigned', v_applied,
        'canceled', v_canceled,
        'revision', v_revision
    ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Dispatch and the public entry point
-- ---------------------------------------------------------------------------

create or replace function sync.dispatch(
    p_org uuid,
    p_actor uuid,
    p_role text,
    p_command text,
    p_payload jsonb,
    p_versions jsonb,
    p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    return case p_command
        when 'CREATE_OPPORTUNITY' then
            sync.cmd_create_opportunity(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'UPDATE_OPPORTUNITY' then
            sync.cmd_update_opportunity(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'CREATE_SHIFT' then
            sync.cmd_create_shift(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'UPDATE_SHIFT' then
            sync.cmd_update_shift(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'REGISTER_FOR_SHIFT' then
            sync.cmd_register(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'CANCEL_REGISTRATION' then
            sync.cmd_cancel_registration(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'JOIN_WAITLIST' then
            sync.cmd_join_waitlist(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'CHECK_IN' then
            sync.cmd_check_in(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'CHECK_OUT' then
            sync.cmd_check_out(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'MARK_NO_SHOW' then
            sync.cmd_mark_no_show(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'SAVE_VOLUNTEER_PROFILE' then
            sync.cmd_save_volunteer_profile(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'UPDATE_CREDENTIAL' then
            sync.cmd_update_credential(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'REVIEW_HOURS' then
            sync.cmd_review_hours(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'UPDATE_ROSTER_POLICY' then
            sync.cmd_update_roster_policy(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'APPLY_ROSTER_PLAN' then
            sync.cmd_apply_roster_plan(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        else
            sync.fail('unknown_command',
                format('The command %s is not part of this protocol.', p_command))
    end;
end;
$$;

create or replace function public.apply_command(
    p_operation_id uuid,
    p_organization_id uuid,
    p_replica_id uuid,
    p_command text,
    p_base_revision bigint,
    p_entity_versions jsonb,
    p_payload jsonb,
    p_client_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_role text;
    v_status text;
    v_epoch integer;
    v_claimed_epoch integer;
    v_result jsonb;
    v_existing jsonb;
    v_code text;
    v_detail text;
    v_hint text;
    v_revision bigint;
    v_cursor bigint;
begin
    if v_actor is null then
        return jsonb_build_object(
            'status', 'forbidden',
            'code', 'unauthenticated',
            'message', 'Sign in to change this organization.'
        );
    end if;

    -- The membership is read regardless of status: a device whose access was
    -- revoked has to be told that its queued work is stale, not simply that the
    -- organization is missing. The two answers lead to different recovery.
    select m.role, m.status, m.membership_epoch into v_role, v_status, v_epoch
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_actor;

    if v_role is null then
        return jsonb_build_object(
            'status', 'forbidden',
            'code', 'not_a_member',
            'message', 'You are not a member of this organization.'
        );
    end if;

    v_claimed_epoch := nullif(p_payload ->> 'membershipEpoch', '')::integer;

    if v_status <> 'active' then
        if v_claimed_epoch is not null then
            return jsonb_build_object(
                'status', 'stale_authority',
                'code', 'stale_authority',
                'message', 'Your access was changed while this device was offline.',
                'membershipEpoch', v_epoch,
                'operationId', p_operation_id
            );
        end if;

        return jsonb_build_object(
            'status', 'forbidden',
            'code', 'membership_inactive',
            'message', 'Your access to this organization is not active.'
        );
    end if;

    -- A device that queued work while it had access cannot keep that access by
    -- replaying it later. This check runs before the ledger so a refused
    -- command is never recorded as if it were a duplicate.
    if v_claimed_epoch is not null and v_claimed_epoch <> v_epoch then
        return jsonb_build_object(
            'status', 'stale_authority',
            'code', 'stale_authority',
            'message', 'Your access changed while this device was offline. Sign in again.',
            'membershipEpoch', v_epoch,
            'operationId', p_operation_id
        );
    end if;

    -- One command at a time per organization. Commands touch several tables and
    -- a deterministic order is cheaper than resolving deadlocks later.
    perform 1 from public.organization_revisions
    where organization_id = p_organization_id
    for update;

    insert into sync.processed_operations
        (operation_id, organization_id, actor_id, replica_id, command_type,
         result_status, result_payload)
    values
        (p_operation_id, p_organization_id, v_actor, p_replica_id, p_command,
         'pending', null)
    on conflict (operation_id) do nothing;

    if not found then
        select result_payload into v_existing
        from sync.processed_operations
        where operation_id = p_operation_id;

        if v_existing is null then
            return jsonb_build_object(
                'status', 'retryable_error',
                'code', 'operation_in_flight',
                'message', 'That operation is still being processed.'
            );
        end if;

        return v_existing || jsonb_build_object('status', 'already_applied');
    end if;

    perform set_config('civicflow.operation_id', p_operation_id::text, true);
    if p_replica_id is not null then
        perform set_config('civicflow.replica_id', p_replica_id::text, true);
    end if;

    begin
        v_result := sync.dispatch(
            p_organization_id, v_actor, v_role, p_command,
            coalesce(p_payload, '{}'::jsonb),
            coalesce(p_entity_versions, '{}'::jsonb),
            p_base_revision
        );
    exception when others then
        get stacked diagnostics
            v_code = message_text,
            v_detail = pg_exception_detail,
            v_hint = pg_exception_hint;

        v_result := jsonb_build_object(
            'status', sync.error_status(v_code),
            'code', v_code,
            'message', coalesce(nullif(v_detail, ''), v_code)
        );

        if v_hint is not null and left(btrim(v_hint), 1) = '{' then
            v_result := v_result || jsonb_build_object('authoritative', v_hint::jsonb);
        end if;
    end;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    select coalesce(max(sequence), 0) into v_cursor from sync.sync_changes;

    v_result := v_result || jsonb_build_object(
        'operationId', p_operation_id,
        'command', p_command,
        'serverRevision', coalesce(v_revision, 0),
        'cursor', coalesce(v_cursor, 0),
        'serverTime', now()
    );

    update sync.processed_operations
    set result_status = v_result ->> 'status',
        result_payload = v_result
    where operation_id = p_operation_id;

    -- A retryable failure is not a recorded outcome. Leaving the ledger row
    -- would turn the next attempt into "already applied" and hide the work.
    if v_result ->> 'status' = 'retryable_error' then
        delete from sync.processed_operations where operation_id = p_operation_id;
    end if;

    if p_replica_id is not null then
        insert into sync.devices (id, organization_id, user_id, platform, last_seen_at)
        values (p_replica_id, p_organization_id, v_actor, '', now())
        on conflict (id) do update
            set last_seen_at = now(),
                user_id = excluded.user_id,
                organization_id = excluded.organization_id;
    end if;

    return v_result;
end;
$$;

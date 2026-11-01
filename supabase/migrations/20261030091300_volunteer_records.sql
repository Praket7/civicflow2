-- Volunteer records are the coordinator half of the shared workspace. A
-- profile, its skills and its weekly availability are separate intents so two
-- devices cannot overwrite one another with a stale copy of the whole record.
-- Each command still names the volunteer, and the server decides whether the
-- caller is staff or that volunteer.

-- ---------------------------------------------------------------------------
-- Entity versions are namespaced on the wire
-- ---------------------------------------------------------------------------
--
-- Clients send `entity:<uuid>` (and the contract fixtures require the colon),
-- while this lookup used to read a bare uuid. A stale edit therefore reached
-- the table with no version check. Both spellings are accepted here; the
-- namespace is a client convenience, not a second identity.

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
    if p_versions is null or jsonb_typeof(p_versions) <> 'object' then
        return;
    end if;

    v_expected := nullif(p_versions ->> p_id::text, '')::integer;

    if v_expected is null then
        select nullif(value, '')::integer
        into v_expected
        from jsonb_each_text(p_versions)
        where key like '%:' || p_id::text
        limit 1;
    end if;

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

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------

create or replace function sync.cmd_set_volunteer_skills(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_volunteer uuid;
    v_skills text[] := array[]::text[];
    v_current text[] := array[]::text[];
    v_skill text;
    v_id uuid;
    v_changes jsonb := '[]'::jsonb;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    if jsonb_typeof(coalesce(p_payload -> 'skills', '[]'::jsonb)) <> 'array' then
        perform sync.fail('invalid_skills', 'Skills have to be a list of names.');
    end if;

    -- Duplicates are collapsed before the unique key sees them. An empty list
    -- is a valid command: it clears every skill on the volunteer.
    select coalesce(array_agg(distinct btrim(skill)), array[]::text[])
    into v_skills
    from jsonb_array_elements_text(coalesce(p_payload -> 'skills', '[]'::jsonb)) as skill;

    if coalesce(array_length(v_skills, 1), 0) > 24 then
        perform sync.fail('too_many_skills', 'A volunteer can list at most 24 skills.');
    end if;

    if exists (
        select 1 from unnest(v_skills) as skill
        where skill = '' or length(skill) > 60
    ) then
        perform sync.fail('invalid_skill', 'Each skill needs a name of 60 characters or fewer.');
    end if;

    select coalesce(array_agg(skill), array[]::text[])
    into v_current
    from public.volunteer_skills
    where volunteer_id = v_volunteer;

    for v_skill in
        select unnest(v_current) except select unnest(v_skills)
    loop
        delete from public.volunteer_skills
        where volunteer_id = v_volunteer and skill = v_skill
        returning id into v_id;

        if v_id is not null then
            v_changes := v_changes || jsonb_build_array(
                sync.change('volunteer_skill', v_id, 'delete'));
        end if;
    end loop;

    for v_skill in
        select unnest(v_skills) except select unnest(v_current)
    loop
        insert into public.volunteer_skills (organization_id, volunteer_id, skill)
        values (p_org, v_volunteer, v_skill)
        returning id into v_id;

        v_changes := v_changes || jsonb_build_array(
            sync.change('volunteer_skill', v_id, 'insert'));
    end loop;

    perform sync.audit(p_org, p_actor, 'volunteer.skills', 'volunteer', v_volunteer::text,
                       array_to_string(v_skills, ', '));

    return sync.applied(v_changes, jsonb_build_object('skills', to_jsonb(v_skills)));
end;
$$;

-- ---------------------------------------------------------------------------
-- Weekly availability
-- ---------------------------------------------------------------------------

create or replace function sync.cmd_set_volunteer_availability(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_volunteer uuid;
    v_slots jsonb := coalesce(p_payload -> 'slots', '[]'::jsonb);
    v_slot record;
    v_rule record;
    v_id uuid;
    v_changes jsonb := '[]'::jsonb;
begin
    v_volunteer := sync.volunteer_for(p_org, p_actor, p_role,
        nullif(p_payload ->> 'volunteerId', '')::uuid);

    if jsonb_typeof(v_slots) <> 'array' then
        perform sync.fail('invalid_availability', 'Availability has to be a list of slots.');
    end if;

    if exists (
        select 1
        from jsonb_to_recordset(v_slots) as s(day text, period text)
        where day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
           or period not in ('morning', 'afternoon', 'evening')
    ) then
        perform sync.fail('invalid_availability',
            'Each slot is one of mon to sun and morning, afternoon, or evening.');
    end if;

    if (
        select count(*) from (
            select distinct day, period
            from jsonb_to_recordset(v_slots) as s(day text, period text)
        ) slots
    ) > 21 then
        perform sync.fail('invalid_availability', 'A week has only 21 three-hour slots.');
    end if;

    for v_rule in
        select id, day, period
        from public.availability_rules
        where volunteer_id = v_volunteer
          and not exists (
              select 1
              from (
                  select distinct day, period
                  from jsonb_to_recordset(v_slots) as s(day text, period text)
              ) wanted
              where wanted.day = availability_rules.day
                and wanted.period = availability_rules.period
          )
    loop
        delete from public.availability_rules where id = v_rule.id;
        v_changes := v_changes || jsonb_build_array(
            sync.change('availability_rule', v_rule.id, 'delete'));
    end loop;

    for v_slot in
        select distinct day, period
        from jsonb_to_recordset(v_slots) as s(day text, period text)
    loop
        if not exists (
            select 1 from public.availability_rules
            where volunteer_id = v_volunteer
              and day = v_slot.day
              and period = v_slot.period
        ) then
            insert into public.availability_rules
                (organization_id, volunteer_id, day, period)
            values (p_org, v_volunteer, v_slot.day, v_slot.period)
            returning id into v_id;

            v_changes := v_changes || jsonb_build_array(
                sync.change('availability_rule', v_id, 'insert'));
        end if;
    end loop;

    perform sync.audit(p_org, p_actor, 'volunteer.availability', 'volunteer',
                       v_volunteer::text, format('%s slots', jsonb_array_length(v_slots)));

    return sync.applied(v_changes, jsonb_build_object(
        'slots', v_slots
    ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Credential types
-- ---------------------------------------------------------------------------

create or replace function sync.cmd_create_credential_type(
    p_org uuid, p_actor uuid, p_role text, p_payload jsonb, p_versions jsonb, p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, gen_random_uuid());
    v_name text := btrim(coalesce(p_payload ->> 'name', ''));
    v_months integer := coalesce((p_payload ->> 'validityMonths')::integer, 0);
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can add a credential type.');
    end if;

    if v_name = '' or length(v_name) > 80 then
        perform sync.fail('name_required', 'Give the credential type a name of 80 characters or fewer.');
    end if;

    if v_months < 1 or v_months > 120 then
        perform sync.fail('invalid_validity', 'Validity has to be between one and 120 months.');
    end if;

    if exists (
        select 1 from public.credential_types
        where organization_id = p_org and lower(name) = lower(v_name)
    ) then
        perform sync.fail('credential_type_exists', 'A credential type with that name already exists.');
    end if;

    insert into public.credential_types (id, organization_id, name, validity_months)
    values (v_id, p_org, v_name, v_months);

    perform sync.audit(p_org, p_actor, 'credential_type.create', 'credential_type',
                       v_id::text, v_name);

    return sync.applied(
        jsonb_build_array(sync.change('credential_type', v_id, 'insert')),
        jsonb_build_object('id', v_id)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile status
-- ---------------------------------------------------------------------------
--
-- The profile command already carries the descriptive fields. Status is added
-- here so a coordinator can take someone off the roster without deleting their
-- history. It is validated rather than handed to the table's CHECK.

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
    v_status text := nullif(btrim(coalesce(p_payload ->> 'status', '')), '');
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

    if v_status is not null and p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can change roster status.');
    end if;

    if v_status is not null and v_status not in ('active', 'onboarding', 'inactive') then
        perform sync.fail('invalid_status', 'A volunteer is active, onboarding, or inactive.');
    end if;

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
        status = coalesce(v_status, status),
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

-- ---------------------------------------------------------------------------
-- Dispatch
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
        when 'CREATE_SHIFT_SERIES' then
            sync.cmd_create_shift_series(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
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
        when 'SET_VOLUNTEER_SKILLS' then
            sync.cmd_set_volunteer_skills(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'SET_VOLUNTEER_AVAILABILITY' then
            sync.cmd_set_volunteer_availability(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
        when 'CREATE_CREDENTIAL_TYPE' then
            sync.cmd_create_credential_type(p_org, p_actor, p_role, p_payload, p_versions, p_revision)
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

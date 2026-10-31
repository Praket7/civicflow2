-- A repeating schedule is one decision, not a batch of unrelated shifts.
-- CREATE_SHIFT_SERIES writes the rule, its roles, and every occurrence in one
-- transaction, so a device never sees half a series after a dropped response.
--
-- Occurrences are computed by the client in the organization's own clock and
-- sent as absolute instants. The server checks the shape and the limits; it
-- does not re-derive a calendar from a time zone name, which keeps the result
-- identical for every client and every future locale.

create or replace function sync.cmd_create_shift_series(
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
    v_rule jsonb := coalesce(p_payload -> 'recurrence', '{}'::jsonb);
    v_kind text := coalesce(v_rule ->> 'kind', 'weekly');
    v_interval integer := coalesce((v_rule ->> 'intervalWeeks')::integer, 1);
    v_weekdays jsonb := coalesce(v_rule -> 'weekdays', '[]'::jsonb);
    v_starts_local text := btrim(coalesce(v_rule ->> 'startsLocalTime', ''));
    v_duration integer := coalesce((v_rule ->> 'durationMinutes')::integer, 0);
    v_starts_on date := nullif(v_rule ->> 'startsOn', '')::date;
    v_ends_on date := nullif(v_rule ->> 'endsOn', '')::date;
    v_occurrence_count integer := nullif(v_rule ->> 'occurrenceCount', '')::integer;
    v_timezone text := coalesce(nullif(p_payload ->> 'timezone', ''), 'America/New_York');
    v_capacity integer := coalesce((p_payload ->> 'capacity')::integer, 0);
    v_occurrences jsonb := coalesce(p_payload -> 'occurrences', '[]'::jsonb);
    v_count integer;
    v_index integer := 0;
    v_occurrence jsonb;
    v_shift_id uuid;
    v_start timestamptz;
    v_end timestamptz;
    v_occurrence_date date;
    v_role record;
    v_role_id uuid;
    v_changes jsonb := '[]'::jsonb;
    v_shift_ids jsonb := '[]'::jsonb;
begin
    if p_role not in ('owner', 'coordinator') then
        perform sync.fail('forbidden', 'Only coordinators can create a repeating schedule.');
    end if;

    if not exists (
        select 1 from public.opportunities
        where id = v_opportunity and organization_id = p_org
    ) then
        perform sync.fail('not_found', 'That opportunity is not in this organization.');
    end if;

    if v_kind <> 'weekly' then
        perform sync.fail('invalid_series', 'Only a weekly repeat is supported.');
    end if;

    if v_interval < 1 or v_interval > 8 then
        perform sync.fail('invalid_series', 'A repeat interval must be between one and eight weeks.');
    end if;

    if jsonb_typeof(v_weekdays) <> 'array' or jsonb_array_length(v_weekdays) < 1 then
        perform sync.fail('invalid_series', 'Choose at least one weekday for the repeat.');
    end if;

    if v_starts_local !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        perform sync.fail('invalid_series', 'The start time has to be written as HH:MM.');
    end if;

    if v_duration < 15 or v_duration > 1440 then
        perform sync.fail('invalid_series', 'An occurrence must last between fifteen minutes and a day.');
    end if;

    if v_starts_on is null then
        perform sync.fail('invalid_series', 'A repeat needs a first day.');
    end if;

    if (v_ends_on is null) = (v_occurrence_count is null) then
        perform sync.fail(
            'invalid_series',
            'Give the repeat an end date or a number of occurrences, not both.'
        );
    end if;

    if v_capacity < 1 then
        perform sync.fail('invalid_capacity', 'A shift needs at least one seat.');
    end if;

    v_count := jsonb_array_length(v_occurrences);
    if v_count < 1 or v_count > 60 then
        perform sync.fail('invalid_series', 'A repeat can publish between one and sixty occurrences.');
    end if;

    insert into public.shift_series
        (id, organization_id, opportunity_id, timezone, recurrence_kind,
         interval_weeks, weekdays, starts_local_time, duration_minutes,
         starts_on, ends_on, occurrence_count)
    values
        (v_id, p_org, v_opportunity, v_timezone, v_kind,
         v_interval, v_weekdays, v_starts_local, v_duration,
         v_starts_on, v_ends_on, v_occurrence_count);

    v_changes := v_changes || jsonb_build_array(sync.change('shift_series', v_id, 'insert'));

    for v_role in
        select * from jsonb_to_recordset(coalesce(p_payload -> 'roles', '[]'::jsonb))
            as r(name text, required integer)
    loop
        if btrim(coalesce(v_role.name, '')) <> '' then
            insert into public.shift_series_roles
                (organization_id, series_id, name, required)
            values
                (p_org, v_id, btrim(v_role.name), greatest(coalesce(v_role.required, 0), 0))
            on conflict (series_id, name) do update set required = excluded.required
            returning id into v_role_id;

            v_changes := v_changes || jsonb_build_array(
                sync.change('shift_series_role', v_role_id, 'insert'));
        end if;
    end loop;

    for v_occurrence in select * from jsonb_array_elements(v_occurrences)
    loop
        v_index := v_index + 1;
        v_shift_id := coalesce(nullif(v_occurrence ->> 'id', '')::uuid, gen_random_uuid());
        v_start := nullif(v_occurrence ->> 'startsAt', '')::timestamptz;
        v_end := nullif(v_occurrence ->> 'endsAt', '')::timestamptz;

        if v_start is null or v_end is null or v_end <= v_start then
            perform sync.fail(
                'invalid_series',
                format('Occurrence %s has to end after it starts.', v_index)
            );
        end if;

        -- A drifted occurrence is the sign of a client bug, not a preference:
        -- the instant must be the rule's local start, not a near miss.
        if v_start < v_starts_on::timestamptz - interval '2 days'
           or v_start > v_starts_on::timestamptz + (v_count * v_interval * 7 + 9) * interval '1 day'
        then
            perform sync.fail(
                'invalid_series',
                format('Occurrence %s falls outside the published window.', v_index)
            );
        end if;

        if round(extract(epoch from (v_end - v_start)) / 60) <> v_duration then
            perform sync.fail(
                'invalid_series',
                format('Occurrence %s does not match the repeat duration.', v_index)
            );
        end if;

        v_occurrence_date := coalesce(
            nullif(v_occurrence ->> 'date', '')::date,
            v_starts_on
        );

        insert into public.shifts
            (id, organization_id, opportunity_id, starts_at, ends_at, capacity,
             series_id, occurrence_date)
        values
            (v_shift_id, p_org, v_opportunity, v_start, v_end, v_capacity,
             v_id, v_occurrence_date)
        on conflict (id) do nothing;

        if not found then
            perform sync.fail(
                'duplicate_shift',
                format('Occurrence %s already exists.', v_index)
            );
        end if;

        v_changes := v_changes || jsonb_build_array(
            sync.change('shift', v_shift_id, 'insert'));
        v_shift_ids := v_shift_ids || jsonb_build_array(v_shift_id);

        for v_role in
            select * from jsonb_to_recordset(coalesce(p_payload -> 'roles', '[]'::jsonb))
                as r(name text, required integer)
        loop
            if btrim(coalesce(v_role.name, '')) <> '' then
                insert into public.shift_roles (organization_id, shift_id, name, required)
                values (p_org, v_shift_id, btrim(v_role.name), greatest(coalesce(v_role.required, 0), 0))
                on conflict (shift_id, name) do update set required = excluded.required
                returning id into v_role_id;

                v_changes := v_changes || jsonb_build_array(
                    sync.change('shift_role', v_role_id, 'insert'));
            end if;
        end loop;
    end loop;

    perform sync.audit(
        p_org, p_actor, 'series.create', 'shift_series', v_id::text,
        format('%s occurrences starting %s', v_count, v_starts_on)
    );

    return sync.applied(v_changes, jsonb_build_object(
        'id', v_id,
        'occurrences', v_count,
        'shiftIds', v_shift_ids
    ));
end;
$$;

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

comment on function sync.cmd_create_shift_series(uuid, uuid, text, jsonb, jsonb, bigint) is
    'Publishes a repeat rule, its roles, and every occurrence atomically; a bad occurrence refuses the whole series.';

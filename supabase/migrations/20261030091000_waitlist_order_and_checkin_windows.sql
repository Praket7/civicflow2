-- Two rules that the desktop already enforces, applied to the hosted commands.
--
-- 1. A waitlist is a line. Positions used to be supplied by the caller (always
--    1), so "first in line" was really "whatever order the planner happened to
--    return". The trigger now assigns the position, and rejoining after being
--    promoted or removed puts the person at the back.
-- 2. Self check-in opens 30 minutes before a shift and closes 15 minutes after
--    it starts. A coordinator recording an arrival by hand may do so until the
--    shift ends. The hosted command used one wider window for both.

create or replace function private.assign_waitlist_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        select coalesce(max(position), 0) + 1 into new.position
        from public.waitlist_entries
        where shift_id = new.shift_id;
        return new;
    end if;
    -- A role change while still waiting keeps the place; coming back after a
    -- promotion, removal or decline is a new wait and takes the back.
    if new.status = 'waiting' and old.status <> 'waiting' then
        select coalesce(max(position), 0) + 1 into new.position
        from public.waitlist_entries
        where shift_id = new.shift_id and id <> new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists waitlist_position on public.waitlist_entries;
create trigger waitlist_position
before insert or update on public.waitlist_entries
for each row execute function private.assign_waitlist_position();

-- Ties are possible in rows written before positions were assigned, so break
-- them by arrival rather than by physical row order.
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
    order by position, created_at, id
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

    if v_now < v_shift.starts_at - interval '30 minutes' then
        perform sync.fail('check_in_not_open',
            'Check-in opens 30 minutes before the shift starts.',
            jsonb_build_object('opensAt', v_shift.starts_at - interval '30 minutes'));
    end if;

    if v_staff then
        if v_now > v_shift.ends_at then
            perform sync.fail('check_in_closed',
                'This shift has ended and can no longer accept check-ins.');
        end if;
    elsif v_now > v_shift.starts_at + interval '15 minutes' then
        perform sync.fail('check_in_closed',
            'Self check-in closed 15 minutes after the shift started. Ask a coordinator to record your arrival.');
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

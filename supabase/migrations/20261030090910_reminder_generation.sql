-- Preference-aware queueing and idempotent reminder generation.
-- ---------------------------------------------------------------------------
-- Queueing
-- ---------------------------------------------------------------------------

-- The notification row is the fire. Its dedupe key is what makes a second
-- generation pass silent; only a fresh fire creates deliveries.
create or replace function private.queue_notification(
    p_organization_id uuid,
    p_volunteer_id uuid,
    p_audience text,
    p_kind text,
    p_title text,
    p_body text,
    p_priority text,
    p_href text,
    p_rule_id uuid,
    p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    insert into public.notifications
        (organization_id, kind, title, body, priority, href, audience,
         volunteer_id, rule_id, dedupe_key)
    values
        (p_organization_id, p_kind, p_title, p_body, p_priority, p_href,
         p_audience, p_volunteer_id, p_rule_id, p_dedupe_key)
    on conflict (dedupe_key) do nothing
    returning id into v_id;

    if v_id is null then
        return null;
    end if;

    -- In-app is delivered by the pull itself; the row records that the channel
    -- was used so the health view can explain what happened.
    insert into public.notification_deliveries
        (organization_id, notification_id, user_id, channel, dedupe_key,
         status, attempts, scheduled_at, sent_at)
    select
        p_organization_id, v_id, m.user_id, 'in_app',
        p_dedupe_key || ':in_app', 'sent', 1, now(), now()
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.status = 'active'
      and ((p_volunteer_id is not null and m.volunteer_id = p_volunteer_id)
           or (p_volunteer_id is null
               and exists (
                   select 1 from public.organization_memberships staff
                   where staff.organization_id = m.organization_id
                     and staff.user_id = m.user_id
                     and staff.role in ('owner', 'coordinator')
               )))
    on conflict (dedupe_key) do nothing;

    return v_id;
end;
$$;

create or replace function private.queue_channel_delivery(
    p_organization_id uuid,
    p_notification_id uuid,
    p_user_id uuid,
    p_channel text,
    p_dedupe_key text,
    p_preference_on boolean,
    p_available boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_scheduled timestamptz;
begin
    if not p_preference_on or not p_available then
        return;
    end if;

    v_scheduled := private.quiet_hours_end(p_organization_id, p_user_id, now());

    insert into public.notification_deliveries
        (organization_id, notification_id, user_id, channel, dedupe_key,
         status, attempts, scheduled_at)
    values
        (p_organization_id, p_notification_id, p_user_id, p_channel,
         p_dedupe_key || ':' || p_channel, 'scheduled', 0, v_scheduled)
    on conflict (dedupe_key) do nothing;
end;
$$;

-- Preference-aware fan-out for one volunteer's fire.
create or replace function private.queue_volunteer_channels(
    p_organization_id uuid,
    p_notification_id uuid,
    p_volunteer_id uuid,
    p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_membership record;
    v_pref record;
    v_email text;
    v_phone text;
    v_push boolean;
begin
    select m.user_id, m.id as membership_id
    into v_membership
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.status = 'active'
      and m.volunteer_id = p_volunteer_id
    limit 1;

    if not found then
        return;
    end if;

    select * into v_pref
    from public.notification_preferences
    where organization_id = p_organization_id and user_id = v_membership.user_id;

    select email into v_email from public.profiles where id = v_membership.user_id;
    select phone into v_phone from public.volunteers where id = p_volunteer_id;

    select exists (
        select 1 from public.push_subscriptions
        where organization_id = p_organization_id
          and user_id = v_membership.user_id
          and revoked_at is null
    ) into v_push;

    perform private.queue_channel_delivery(
        p_organization_id, p_notification_id, v_membership.user_id, 'push',
        p_dedupe_key, coalesce(v_pref.push, false), v_push);

    perform private.queue_channel_delivery(
        p_organization_id, p_notification_id, v_membership.user_id, 'email',
        p_dedupe_key, coalesce(v_pref.email, false), coalesce(v_email, '') <> '');

    perform private.queue_channel_delivery(
        p_organization_id, p_notification_id, v_membership.user_id, 'sms',
        p_dedupe_key, coalesce(v_pref.sms, false), coalesce(v_phone, '') <> '');
end;
$$;

-- ---------------------------------------------------------------------------
-- Generation
-- ---------------------------------------------------------------------------

create or replace function private.generate_reminders(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    r record;
    v record;
    v_key text;
    v_id uuid;
    v_count integer := 0;
    v_count_text text;
begin
    for r in
        select nr.id, nr.organization_id, nr.trigger_type, nr.offset_minutes, nr.audience,
               o.name as organization_name, o.timezone
        from public.notification_rules nr
        join public.organizations o on o.id = nr.organization_id
        where nr.enabled
    loop
        if r.trigger_type = 'shift_reminder' then
            for v in
                select s.id as shift_id, s.starts_at, op.title,
                       reg.volunteer_id
                from public.registrations reg
                join public.shifts s on s.id = reg.shift_id
                join public.opportunities op on op.id = s.opportunity_id
                join public.organization_memberships m
                    on m.organization_id = reg.organization_id
                   and m.volunteer_id = reg.volunteer_id
                   and m.status = 'active'
                left join public.notification_preferences pref
                    on pref.organization_id = reg.organization_id
                   and pref.user_id = m.user_id
                where reg.organization_id = r.organization_id
                  and reg.status in ('registered', 'confirmed')
                  and s.status = 'scheduled'
                  and s.starts_at > p_now
                  and s.starts_at - make_interval(
                          mins => coalesce(pref.reminder_minutes, r.offset_minutes)) <= p_now
            loop
                v_key := format('shift_reminder:%s:%s:%s',
                                v.shift_id, v.volunteer_id, r.id);
                v_id := private.queue_notification(
                    r.organization_id, v.volunteer_id, 'volunteer', 'reminder',
                    'Your shift is coming up',
                    format('%s starts %s. Everything you need is in the app.',
                           coalesce(nullif(v.title, ''), 'Your shift'),
                           to_char(v.starts_at at time zone r.timezone,
                                   'FMDy FMMon FMDD at FMHH12:MI AM')),
                    'high', '/schedule', r.id, v_key);
                if v_id is not null then
                    perform private.queue_volunteer_channels(
                        r.organization_id, v_id, v.volunteer_id, v_key);
                    v_count := v_count + 1;
                end if;
            end loop;

        elsif r.trigger_type = 'checkin_soon' then
            for v in
                select s.id as shift_id, s.starts_at, op.title, reg.volunteer_id
                from public.registrations reg
                join public.shifts s on s.id = reg.shift_id
                join public.opportunities op on op.id = s.opportunity_id
                where reg.organization_id = r.organization_id
                  and reg.status in ('registered', 'confirmed')
                  and s.status = 'scheduled'
                  and s.starts_at > p_now
                  and s.starts_at - make_interval(mins => r.offset_minutes) <= p_now
                  and not exists (
                      select 1 from public.attendance_events a
                      where a.shift_id = s.id
                        and a.volunteer_id = reg.volunteer_id
                        and a.status in ('checked_in', 'completed')
                  )
            loop
                v_key := format('checkin_soon:%s:%s:%s',
                                v.shift_id, v.volunteer_id, r.id);
                v_id := private.queue_notification(
                    r.organization_id, v.volunteer_id, 'volunteer', 'checkin',
                    'Check-in opens soon',
                    format('%s begins at %s. Open CivicFlow at the door to check in.',
                           coalesce(nullif(v.title, ''), 'Your shift'),
                           to_char(v.starts_at at time zone r.timezone, 'FMHH12:MI AM')),
                    'high', '/checkin/' || v.shift_id, r.id, v_key);
                if v_id is not null then
                    perform private.queue_volunteer_channels(
                        r.organization_id, v_id, v.volunteer_id, v_key);
                    v_count := v_count + 1;
                end if;
            end loop;

        elsif r.trigger_type = 'missed_shift_follow_up' then
            for v in
                select s.id as shift_id, s.ends_at, op.title, count(*)::integer as missing
                from public.registrations reg
                join public.shifts s on s.id = reg.shift_id
                join public.opportunities op on op.id = s.opportunity_id
                where reg.organization_id = r.organization_id
                  and reg.status in ('registered', 'confirmed')
                  and s.status = 'scheduled'
                  and s.ends_at <= p_now
                  and s.ends_at > p_now - make_interval(mins => greatest(r.offset_minutes, 60))
                  and not exists (
                      select 1 from public.attendance_events a
                      where a.shift_id = s.id
                        and a.volunteer_id = reg.volunteer_id
                        and a.status in ('checked_in', 'completed')
                  )
                group by s.id, s.ends_at, op.title
            loop
                v_key := format('missed_shift:%s:%s', v.shift_id, r.id);
                v_id := private.queue_notification(
                    r.organization_id, null, 'coordinator', 'follow_up',
                    'A shift ended without a check-in',
                    format('%s ended at %s with %s registered volunteer%s who never checked in. Record attendance or excuse them.',
                           coalesce(nullif(v.title, ''), 'A shift'),
                           to_char(v.ends_at at time zone r.timezone, 'FMDy FMMon FMDD FMHH12:MI AM'),
                           v.missing, case when v.missing = 1 then '' else 's' end),
                    'high', '/attendance', r.id, v_key);
                if v_id is not null then
                    v_count := v_count + 1;
                end if;
            end loop;

        elsif r.trigger_type = 'credential_expiring' then
            for v in
                select c.id as credential_id, c.volunteer_id, c.valid_through,
                       ct.name as credential_name, vol.name as volunteer_name
                from public.volunteer_credentials c
                join public.credential_types ct on ct.id = c.credential_type_id
                join public.volunteers vol on vol.id = c.volunteer_id
                where c.organization_id = r.organization_id
                  and c.valid_through >= (p_now at time zone r.timezone)::date
                  and c.valid_through <= ((p_now + make_interval(mins => r.offset_minutes))
                                          at time zone r.timezone)::date
            loop
                v_key := format('credential:%s:%s:%s', v.credential_id, r.audience, r.id);
                if r.audience = 'volunteer' then
                    v_id := private.queue_notification(
                        r.organization_id, v.volunteer_id, 'volunteer', 'credential',
                        'Your ' || v.credential_name || ' expires soon',
                        format('It is valid through %s. Send an updated copy to your coordinator.',
                               to_char(v.valid_through, 'FMMon FMDD, FMYYYY')),
                        'normal', '/profile', r.id, v_key);
                    if v_id is not null then
                        perform private.queue_volunteer_channels(
                            r.organization_id, v_id, v.volunteer_id, v_key);
                        v_count := v_count + 1;
                    end if;
                else
                    v_id := private.queue_notification(
                        r.organization_id, null, 'coordinator', 'credential',
                        v.volunteer_name || '''s ' || v.credential_name || ' expires soon',
                        format('Valid through %s. Ask for a renewal before it lapses.',
                               to_char(v.valid_through, 'FMMon FMDD, FMYYYY')),
                        'normal', '/credentials', r.id, v_key);
                    if v_id is not null then
                        v_count := v_count + 1;
                    end if;
                end if;
            end loop;
        end if;
    end loop;

    return v_count;
end;
$$;


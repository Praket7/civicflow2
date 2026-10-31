-- Delivery claiming, completion, read state and the health view.
-- ---------------------------------------------------------------------------
-- Dispatch
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_reminders(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_generated integer;
    v_jobs jsonb;
begin
    perform private.require_service();

    if not pg_try_advisory_xact_lock(hashtext('civicflow.reminders')) then
        return jsonb_build_object('status', 'busy');
    end if;

    v_generated := private.generate_reminders(now());

    with due as (
        select d.id
        from public.notification_deliveries d
        where d.status = 'scheduled'
          and d.scheduled_at <= now()
        order by d.scheduled_at
        limit greatest(coalesce(p_limit, 50), 0)
        for update skip locked
    ),
    claimed as (
        update public.notification_deliveries d
        set status = 'sending', attempts = d.attempts + 1
        from due
        where d.id = due.id
        returning d.id, d.notification_id, d.organization_id, d.user_id,
                  d.channel, d.attempts
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'deliveryId', c.id,
        'channel', c.channel,
        'attempts', c.attempts,
        'title', n.title,
        'body', n.body,
        'href', n.href,
        'priority', n.priority,
        'email', coalesce(p.email, ''),
        'phone', coalesce(v.phone, ''),
        'push', coalesce((
            select jsonb_agg(jsonb_build_object(
                'endpoint', ps.endpoint,
                'p256dh', ps.p256dh,
                'auth', ps.auth))
            from public.push_subscriptions ps
            where ps.organization_id = c.organization_id
              and ps.user_id = c.user_id
              and ps.revoked_at is null
        ), '[]'::jsonb)
    )), '[]'::jsonb)
    into v_jobs
    from claimed c
    join public.notifications n on n.id = c.notification_id
    left join public.profiles p on p.id = c.user_id
    left join public.organization_memberships m
        on m.organization_id = c.organization_id and m.user_id = c.user_id
    left join public.volunteers v on v.id = m.volunteer_id;

    return jsonb_build_object(
        'status', 'ok',
        'generated', v_generated,
        'claimed', jsonb_array_length(v_jobs),
        'jobs', v_jobs
    );
end;
$$;

create or replace function public.complete_delivery(
    p_id uuid,
    p_status text,
    p_error text default null,
    p_provider text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row record;
    v_attempts integer;
begin
    perform private.require_service();

    if p_status not in ('sent', 'failed', 'skipped', 'deferred') then
        return jsonb_build_object('status', 'validation_error', 'code', 'unknown_status');
    end if;

    select attempts into v_attempts
    from public.notification_deliveries
    where id = p_id and status = 'sending';

    if not found then
        return jsonb_build_object('status', 'not_found');
    end if;

    if p_status = 'sent' then
        update public.notification_deliveries
        set status = 'sent', sent_at = now(), provider = coalesce(p_provider, ''),
            last_error = null
        where id = p_id;
        return jsonb_build_object('status', 'ok', 'state', 'sent');

    elsif p_status = 'skipped' then
        update public.notification_deliveries
        set status = 'skipped', last_error = p_error, provider = coalesce(p_provider, '')
        where id = p_id;
        return jsonb_build_object('status', 'ok', 'state', 'skipped');

    elsif p_status = 'deferred' then
        update public.notification_deliveries
        set status = 'scheduled', scheduled_at = now() + interval '1 hour',
            last_error = p_error, provider = coalesce(p_provider, '')
        where id = p_id;
        return jsonb_build_object('status', 'ok', 'state', 'deferred');

    else
        -- Two failures are worth retrying; the third is a state an operator has
        -- to see, so it stops moving and shows up in the health view.
        if v_attempts >= 3 then
            update public.notification_deliveries
            set status = 'failed', failed_at = now(), last_error = p_error,
                provider = coalesce(p_provider, '')
            where id = p_id;
            return jsonb_build_object('status', 'ok', 'state', 'failed');
        end if;

        update public.notification_deliveries
        set status = 'scheduled',
            scheduled_at = now() + make_interval(mins => v_attempts * v_attempts * 5),
            last_error = p_error,
            provider = coalesce(p_provider, '')
        where id = p_id;
        return jsonb_build_object('status', 'ok', 'state', 'retry');
    end if;
end;
$$;

create or replace function public.record_server_job(
    p_job text,
    p_status text,
    p_detail text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    perform private.require_service();

    if p_status not in ('succeeded', 'failed', 'running') then
        return jsonb_build_object('status', 'validation_error', 'code', 'unknown_status');
    end if;

    insert into public.server_job_runs (job, status, detail, finished_at)
    values (p_job, p_status, coalesce(p_detail, ''),
            case when p_status = 'running' then null else now() end)
    returning id into v_id;

    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Volunteer-facing reads and read state
-- ---------------------------------------------------------------------------

create or replace function public.my_notification_preferences(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pref record;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    select * into v_pref
    from public.notification_preferences
    where organization_id = p_organization_id and user_id = auth.uid();

    if not found then
        return jsonb_build_object(
            'status', 'ok',
            'preferences', jsonb_build_object(
                'inApp', true, 'push', false, 'email', false, 'sms', false,
                'quietHoursStart', null, 'quietHoursEnd', null,
                'reminderMinutes', 1440)
        );
    end if;

    return jsonb_build_object(
        'status', 'ok',
        'preferences', jsonb_build_object(
            'inApp', v_pref.in_app,
            'push', v_pref.push,
            'email', v_pref.email,
            'sms', v_pref.sms,
            'quietHoursStart', to_char(v_pref.quiet_hours_start, 'HH24:MI'),
            'quietHoursEnd', to_char(v_pref.quiet_hours_end, 'HH24:MI'),
            'reminderMinutes', v_pref.reminder_minutes)
    );
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    update public.notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id
      and (private.is_staff(n.organization_id)
           or (n.audience in ('volunteer', 'all')
               and (n.volunteer_id is null
                    or n.volunteer_id = private.own_volunteer_id(n.organization_id))))
    returning n.id into v_id;

    if v_id is null then
        return jsonb_build_object('status', 'not_found');
    end if;

    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

create or replace function public.mark_all_notifications_read(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    update public.notifications n
    set read_at = now()
    where n.organization_id = p_organization_id
      and n.read_at is null
      and (private.is_staff(p_organization_id)
           or (n.audience in ('volunteer', 'all')
               and (n.volunteer_id is null
                    or n.volunteer_id = private.own_volunteer_id(p_organization_id))));

    get diagnostics v_count = row_count;
    return jsonb_build_object('status', 'ok', 'read', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Health view additions
-- ---------------------------------------------------------------------------

create or replace function public.delivery_health(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_by_status jsonb;
    v_recent jsonb;
begin
    if not private.is_staff(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
    into v_by_status
    from (
        select status, count(*)::integer as n
        from public.notification_deliveries
        where organization_id = p_organization_id
        group by status
    ) t;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id,
        'channel', d.channel,
        'status', d.status,
        'attempts', d.attempts,
        'scheduledAt', d.scheduled_at,
        'sentAt', d.sent_at,
        'lastError', d.last_error,
        'title', n.title
    ) order by d.scheduled_at desc), '[]'::jsonb)
    into v_recent
    from (
        select * from public.notification_deliveries
        where organization_id = p_organization_id
        order by scheduled_at desc
        limit 20
    ) d
    join public.notifications n on n.id = d.notification_id;

    return jsonb_build_object('status', 'ok', 'byStatus', v_by_status, 'recent', v_recent);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant execute on function public.vapid_public_key() to anon, authenticated;
grant execute on function public.save_vapid_keys(text, text) to authenticated, anon;
grant execute on function public.read_vapid_keys() to authenticated, anon;
grant execute on function public.dispatch_reminders(integer) to authenticated, anon;
grant execute on function public.complete_delivery(uuid, text, text, text) to authenticated, anon;
grant execute on function public.record_server_job(text, text, text) to authenticated, anon;
grant execute on function public.my_notification_preferences(uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;
grant execute on function public.delivery_health(uuid) to authenticated;


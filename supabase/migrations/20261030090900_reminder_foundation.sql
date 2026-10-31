-- Reminder fire identity, default rules, VAPID storage and quiet hours.
-- Reminder generation and delivery.
--
-- A device never decides when a reminder is owed. Rules live in the database,
-- generation is idempotent through a per-fire dedupe key, and a delivery row is
-- the only thing a dispatcher can claim. Running the dispatcher twice therefore
-- sends once, and a lost response is a retry of the same row rather than a
-- second message.

-- ---------------------------------------------------------------------------
-- Fire identity
-- ---------------------------------------------------------------------------

alter table public.notifications
    add column dedupe_key text;

comment on column public.notifications.dedupe_key is
    'One row per reminder that fired. The dispatcher inserts with ON CONFLICT DO NOTHING, so a second generation pass is silent.';

create unique index notifications_dedupe on public.notifications (dedupe_key);

-- ---------------------------------------------------------------------------
-- Default rules
-- ---------------------------------------------------------------------------

create or replace function private.seed_notification_rules(p_organization_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.notification_rules
        (organization_id, trigger_type, offset_minutes, audience, enabled)
    values
        (p_organization_id, 'shift_reminder', 1440, 'volunteer', true),
        (p_organization_id, 'checkin_soon', 60, 'volunteer', true),
        (p_organization_id, 'missed_shift_follow_up', 120, 'coordinator', true),
        (p_organization_id, 'credential_expiring', 10080, 'coordinator', true),
        (p_organization_id, 'credential_expiring', 10080, 'volunteer', true)
    on conflict (organization_id, trigger_type, audience) do nothing;
$$;

create or replace function private.after_organization_insert_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.seed_notification_rules(new.id);
    return new;
end;
$$;

create trigger organizations_seed_notification_rules
after insert on public.organizations
for each row execute function private.after_organization_insert_rules();

do $$
declare
    r record;
begin
    for r in select id from public.organizations loop
        perform private.seed_notification_rules(r.id);
    end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- VAPID keys
-- ---------------------------------------------------------------------------
--
-- The dispatcher owns the push credential so no operator has to paste a key
-- into a chat window. Only the public half is ever readable by a client.

create table private.push_keys (
    id boolean primary key default true check (id),
    public_key text not null,
    private_key text not null,
    created_at timestamptz not null default now()
);

create or replace function private.require_service()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
    v_role text;
begin
    -- SECURITY DEFINER resets current_user to the function owner, so the
    -- request's role has to come from the claim or from the role GUC PostgREST
    -- set for this transaction. Falling back to current_user would make every
    -- definer function look like it ran as the owner.
    v_role := coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        nullif(current_setting('role', true), 'none'),
        current_user::text
    );

    if v_role not in ('service_role', 'postgres', 'supabase_admin', 'postgresql') then
        raise exception 'service_role_required' using errcode = 'insufficient_privilege';
    end if;
end;
$$;

create or replace function public.vapid_public_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select public_key from private.push_keys where id;
$$;

create or replace function public.save_vapid_keys(p_public text, p_private text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.require_service();

    if coalesce(btrim(p_public), '') = '' or coalesce(btrim(p_private), '') = '' then
        return jsonb_build_object('status', 'validation_error', 'code', 'keys_required');
    end if;

    insert into private.push_keys (public_key, private_key)
    values (p_public, p_private)
    on conflict (id) do nothing;

    return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.read_vapid_keys()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row record;
begin
    perform private.require_service();

    select public_key, private_key into v_row from private.push_keys where id;
    if not found then
        return jsonb_build_object('status', 'missing');
    end if;

    return jsonb_build_object(
        'status', 'ok',
        'publicKey', v_row.public_key,
        'privateKey', v_row.private_key
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Quiet hours
-- ---------------------------------------------------------------------------

create or replace function private.quiet_hours_end(
    p_organization_id uuid,
    p_user_id uuid,
    p_at timestamptz
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_pref record;
    v_timezone text;
    v_local timestamp;
    v_time time;
    v_date date;
begin
    select quiet_hours_start, quiet_hours_end
    into v_pref
    from public.notification_preferences
    where organization_id = p_organization_id and user_id = p_user_id;

    if not found or v_pref.quiet_hours_start is null or v_pref.quiet_hours_end is null then
        return p_at;
    end if;
    if v_pref.quiet_hours_start = v_pref.quiet_hours_end then
        return p_at;
    end if;

    select timezone into v_timezone from public.organizations where id = p_organization_id;
    v_local := p_at at time zone coalesce(v_timezone, 'UTC');
    v_time := v_local::time;

    if (v_pref.quiet_hours_start < v_pref.quiet_hours_end
            and v_time >= v_pref.quiet_hours_start and v_time < v_pref.quiet_hours_end)
       or (v_pref.quiet_hours_start > v_pref.quiet_hours_end
            and (v_time >= v_pref.quiet_hours_start or v_time < v_pref.quiet_hours_end)) then
        v_date := v_local::date;
        if v_pref.quiet_hours_start > v_pref.quiet_hours_end
           and v_time >= v_pref.quiet_hours_start then
            v_date := v_date + 1;
        end if;
        return (v_date + v_pref.quiet_hours_end) at time zone coalesce(v_timezone, 'UTC');
    end if;

    return p_at;
end;
$$;


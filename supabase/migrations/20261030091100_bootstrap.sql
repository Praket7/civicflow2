-- A fresh device cannot replay an entire change history to open a workspace.
-- It asks for the current state once, saves the cursor from the same snapshot,
-- and then uses `pull_changes` for everything after it.
--
-- The rows, cursor and revision are built by one SELECT, so a device that
-- crashes during bootstrap keeps its old replica and retries, and a device that
-- finishes has a cursor that is exactly the state it just stored.
--
-- `sync.entity_tables` is the server-owned whitelist. The union below must list
-- every entity in it, including the ones a member may not see; row-level
-- security decides which rows come back, and an empty array is a valid answer.

create or replace function public.bootstrap_workspace(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if auth.uid() is null or private.is_member(p_organization_id) is not true then
        return jsonb_build_object('status', 'forbidden');
    end if;

    with visible as (
        select 'organization'::text as entity, to_jsonb(t) as row
        from public.organizations t
        where t.id = p_organization_id

        union all
        select 'organization_contact', to_jsonb(t)
        from public.organization_contacts t
        where t.organization_id = p_organization_id

        union all
        select 'membership', to_jsonb(t)
        from public.organization_memberships t
        where t.organization_id = p_organization_id

        union all
        select 'invite', to_jsonb(t)
        from public.organization_invites t
        where t.organization_id = p_organization_id

        union all
        select 'organization_update', to_jsonb(t)
        from public.organization_updates t
        where t.organization_id = p_organization_id

        union all
        select 'organization_update_read', to_jsonb(t)
        from public.organization_update_reads t
        where t.organization_id = p_organization_id

        union all
        select 'volunteer', to_jsonb(t)
        from public.volunteers t
        where t.organization_id = p_organization_id

        union all
        select 'volunteer_skill', to_jsonb(t)
        from public.volunteer_skills t
        where t.organization_id = p_organization_id

        union all
        select 'availability_rule', to_jsonb(t)
        from public.availability_rules t
        where t.organization_id = p_organization_id

        union all
        select 'credential_type', to_jsonb(t)
        from public.credential_types t
        where t.organization_id = p_organization_id

        union all
        select 'credential', to_jsonb(t)
        from public.volunteer_credentials t
        where t.organization_id = p_organization_id

        union all
        select 'opportunity', to_jsonb(t)
        from public.opportunities t
        where t.organization_id = p_organization_id

        union all
        select 'shift_series', to_jsonb(t)
        from public.shift_series t
        where t.organization_id = p_organization_id

        union all
        select 'shift_series_role', to_jsonb(t)
        from public.shift_series_roles t
        where t.organization_id = p_organization_id

        union all
        select 'shift', to_jsonb(t)
        from public.shifts t
        where t.organization_id = p_organization_id

        union all
        select 'shift_role', to_jsonb(t)
        from public.shift_roles t
        where t.organization_id = p_organization_id

        union all
        select 'role_requirement', to_jsonb(t)
        from public.role_requirements t
        where t.organization_id = p_organization_id

        union all
        select 'registration', to_jsonb(t)
        from public.registrations t
        where t.organization_id = p_organization_id

        union all
        select 'waitlist_entry', to_jsonb(t)
        from public.waitlist_entries t
        where t.organization_id = p_organization_id

        union all
        select 'attendance', to_jsonb(t)
        from public.attendance_events t
        where t.organization_id = p_organization_id

        union all
        select 'attendance_ledger', to_jsonb(t)
        from public.attendance_ledger t
        where t.organization_id = p_organization_id

        union all
        select 'hour_entry', to_jsonb(t)
        from public.hour_entries t
        where t.organization_id = p_organization_id

        union all
        select 'service_verification', to_jsonb(t)
        from public.service_verifications t
        where t.organization_id = p_organization_id

        union all
        select 'roster_policy', to_jsonb(t)
        from public.organization_roster_policies t
        where t.organization_id = p_organization_id

        union all
        select 'application', to_jsonb(t)
        from public.applications t
        where t.organization_id = p_organization_id

        union all
        select 'stage_history', to_jsonb(t)
        from public.volunteer_stage_history t
        where t.organization_id = p_organization_id

        union all
        select 'saved_opportunity', to_jsonb(t)
        from public.saved_opportunities t
        where t.organization_id = p_organization_id

        union all
        select 'report_view', to_jsonb(t)
        from public.report_saved_views t
        where t.organization_id = p_organization_id

        union all
        select 'impact_definition', to_jsonb(t)
        from public.impact_metric_definitions t
        where t.organization_id = p_organization_id

        union all
        select 'impact_result', to_jsonb(t)
        from public.impact_results t
        where t.organization_id = p_organization_id

        union all
        select 'audit_event', to_jsonb(t)
        from public.audit_events t
        where t.organization_id = p_organization_id

        union all
        select 'activity_event', to_jsonb(t)
        from public.activity_events t
        where t.organization_id = p_organization_id

        union all
        select 'checkin_code', to_jsonb(t)
        from public.checkin_codes t
        where t.organization_id = p_organization_id

        union all
        select 'notification_rule', to_jsonb(t)
        from public.notification_rules t
        where t.organization_id = p_organization_id

        union all
        select 'notification', to_jsonb(t)
        from public.notifications t
        where t.organization_id = p_organization_id
    ),
    grouped as (
        select entity, jsonb_agg(row order by row ->> 'id') as rows
        from visible
        group by entity
    )
    select jsonb_build_object(
        'status', 'ok',
        'cursor', coalesce(
            (select max(c.sequence)
             from sync.sync_changes c
             where c.organization_id = p_organization_id),
            0
        ),
        'revision', coalesce(
            (select r.revision
             from public.organization_revisions r
             where r.organization_id = p_organization_id),
            0
        ),
        'entities', (
            select coalesce(
                jsonb_object_agg(e.entity_type, coalesce(g.rows, '[]'::jsonb)),
                '{}'::jsonb
            )
            from sync.entity_tables e
            left join grouped g on g.entity = e.entity_type
        )
    )
    into v_result;

    return v_result;
end;
$$;

comment on function public.bootstrap_workspace(uuid) is
    'Returns the current rows this account may read, with the cursor and revision from the same snapshot. History is not replayed.';

grant execute on function public.bootstrap_workspace(uuid) to authenticated;

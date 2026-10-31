-- A revoked member must be able to learn why the app stopped. The previous
-- `my_workspaces` joined `organizations` under the caller's RLS, and a disabled
-- membership has no organization SELECT, so the join dropped the row and the
-- client could only say "no workspace".
--
-- The function is SECURITY DEFINER but filtered to auth.uid(): it can return the
-- caller's own membership and the organization's display fields, never another
-- member's row and never the roster.

create or replace function public.my_workspaces()
returns jsonb
language plpgsql
security definer
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
            'name', coalesce(o.name, 'Organization'),
            'initials', coalesce(o.initials, ''),
            'timezone', coalesce(o.timezone, 'America/New_York'),
            'visibility', coalesce(o.visibility, 'private'),
            'image', o.image
        )
    ) order by coalesce(o.name, m.organization_id::text)), '[]'::jsonb)
    into v_rows
    from public.organization_memberships m
    left join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid();

    return jsonb_build_object('status', 'ok', 'workspaces', v_rows);
end;
$$;

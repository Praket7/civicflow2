-- The membership epoch is the defence against an offline device replaying
-- authority it no longer has. The bump function existed from the first migration
-- but nothing invoked it, so a role or status change left the epoch unchanged
-- and a queued command still looked current.
--
-- This trigger is intentionally narrow: it fires only when authority changes,
-- not on every membership read or metadata edit.

drop trigger if exists organization_memberships_bump_epoch
    on public.organization_memberships;

create trigger organization_memberships_bump_epoch
before update of role, status, volunteer_id
on public.organization_memberships
for each row execute function private.bump_membership_epoch();

-- A row that was already disabled before this trigger existed is still stale to
-- any device that created work while it was active. The status check catches
-- those; this backfill only makes the stored epoch agree with that fact.
update public.organization_memberships
set membership_epoch = membership_epoch + 1
where status <> 'active';

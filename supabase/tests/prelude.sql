-- Supabase-shaped prelude for a plain Postgres.
--
-- PGlite is real Postgres, so the migrations can be exercised without Docker.
-- It does not ship Supabase's auth plumbing, so the two pieces the schema
-- depends on are recreated here: the role set PostgREST switches into, and
-- auth.uid() reading the request claims.

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin;
    end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- PostgREST sets request.jwt.claim.sub for every request. Matching that here
-- means a policy cannot accidentally pass in tests for a reason it would not
-- pass in production.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;

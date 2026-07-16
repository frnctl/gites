create schema auth;
create schema storage;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table auth.users (
  id uuid primary key,
  email text not null unique
);

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id) on delete cascade,
  name text not null
);

alter table storage.objects enable row level security;

grant usage on schema storage to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when position('/' in name) = 0 then '{}'::text[]
    else (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1]
  end
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'email', current_setting('request.jwt.claim.email', true)
  )
$$;

create publication supabase_realtime;

insert into auth.users(id, email) values
  ('10000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'concierge@example.test'),
  ('30000000-0000-0000-0000-000000000003', 'outsider@example.test'),
  ('40000000-0000-0000-0000-000000000004', 'manager@example.test'),
  ('50000000-0000-0000-0000-000000000005', 'prepared-owner@example.test');

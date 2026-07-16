-- Best Friend v4 — fondation multi-tenant non destructive
--
-- Ce script crée de nouvelles tables préfixées `bf_`. Il ne modifie et ne
-- supprime aucune table du prototype v3 (`members`, `apartments`, etc.).
-- L'import des données historiques fera l'objet d'une migration séparée après
-- validation d'un export et d'une sauvegarde.

begin;

-- ---------------------------------------------------------------------------
-- Données de référence
-- ---------------------------------------------------------------------------

create table if not exists public.bf_organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default (
    'org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  ),
  provisioning_key text,
  name text not null check (char_length(trim(name)) between 2 and 120),
  brand_name text not null default 'Best Friend',
  owner_label text not null default 'Propriétaire',
  timezone text not null default 'Europe/Paris',
  currency text not null default 'EUR',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bf_organizations
  add column if not exists provisioning_key text;
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.bf_organizations'::regclass
       and conname = 'bf_organizations_provisioning_key_check'
  ) then
    alter table public.bf_organizations
      add constraint bf_organizations_provisioning_key_check check (
        provisioning_key is null
        or provisioning_key ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
      );
  end if;
end;
$$;
create unique index if not exists bf_organizations_provisioning_key_uidx
  on public.bf_organizations(provisioning_key)
  where provisioning_key is not null;

create table if not exists public.bf_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.bf_organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text not null default '',
  role text not null check (role in ('owner', 'admin', 'manager', 'concierge', 'viewer')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email),
  unique (org_id, user_id),
  check (email = lower(trim(email)))
);

create table if not exists public.bf_properties (
  org_id uuid not null references public.bf_organizations(id) on delete cascade,
  id text not null,
  name text not null,
  active boolean not null default true,
  doc jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

create table if not exists public.bf_property_members (
  org_id uuid not null,
  property_id text not null,
  member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (org_id, property_id, member_id),
  foreign key (org_id, property_id)
    references public.bf_properties(org_id, id) on delete cascade,
  foreign key (org_id, member_id)
    references public.bf_members(org_id, id) on delete cascade
);

create table if not exists public.bf_reservations (
  org_id uuid not null,
  id text not null,
  property_id text not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id),
  foreign key (org_id, property_id)
    references public.bf_properties(org_id, id) on delete cascade
);

create table if not exists public.bf_operations (
  org_id uuid not null,
  id text not null,
  property_id text not null,
  assigned_member_id uuid,
  kind text not null default 'intervention',
  status text not null default 'open',
  due_at timestamptz,
  completed_at timestamptz,
  doc jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id),
  foreign key (org_id, property_id)
    references public.bf_properties(org_id, id) on delete cascade,
  foreign key (org_id, assigned_member_id)
    references public.bf_members(org_id, id) on delete set null
);

create table if not exists public.bf_contacts (
  org_id uuid not null,
  id text not null,
  property_id text,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id),
  foreign key (org_id, property_id)
    references public.bf_properties(org_id, id) on delete cascade
);

-- Aucun secret fournisseur ne doit être placé dans `config`. Les clés API
-- restent côté serveur ; cette table ne conserve que les préférences métier.
create table if not exists public.bf_notification_channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.bf_organizations(id) on delete cascade,
  channel text not null check (channel in ('email', 'push', 'sms', 'whatsapp')),
  label text not null default '',
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bf_audit_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.bf_organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.bf_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.bf_organizations(id) on delete cascade,
  kind text not null default 'pre_replace'
    check (kind in ('pre_replace', 'manual')),
  counts jsonb not null default '{}'::jsonb,
  snapshot jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bf_members_user_idx
  on public.bf_members(user_id) where user_id is not null;
create index if not exists bf_property_members_member_idx
  on public.bf_property_members(member_id);
create index if not exists bf_reservations_property_idx
  on public.bf_reservations(org_id, property_id);
create index if not exists bf_operations_due_idx
  on public.bf_operations(org_id, status, due_at);
create index if not exists bf_audit_events_org_created_idx
  on public.bf_audit_events(org_id, created_at desc);
create index if not exists bf_snapshots_org_created_idx
  on public.bf_snapshots(org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Utilitaires et autorisations
-- ---------------------------------------------------------------------------

create or replace function public.bf_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'bf_organizations', 'bf_members', 'bf_properties', 'bf_reservations',
    'bf_operations', 'bf_contacts', 'bf_notification_channels'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I',
      table_name || '_touch_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.bf_touch_updated_at()',
      table_name || '_touch_updated_at', table_name
    );
  end loop;
end;
$$;

create or replace function public.bf_current_email()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.bf_is_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.bf_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create or replace function public.bf_has_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.bf_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(p_roles)
  )
$$;

create or replace function public.bf_can_manage(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.bf_has_role(p_org_id, array['owner', 'admin', 'manager'])
$$;

create or replace function public.bf_can_access_property(
  p_org_id uuid,
  p_property_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.bf_can_manage(p_org_id)
    or exists (
      select 1
      from public.bf_property_members pm
      join public.bf_members m
        on m.id = pm.member_id
       and m.org_id = pm.org_id
      where pm.org_id = p_org_id
        and pm.property_id = p_property_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
$$;

-- Création explicite d'une organisation. Il n'existe plus de règle
-- « premier inscrit = administrateur global ».
create or replace function public.bf_create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid := gen_random_uuid();
  v_email text := public.bf_current_email();
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'authentication_required';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'invalid_organization_name';
  end if;

  insert into public.bf_organizations(id, name, created_by)
  values (v_org_id, trim(p_name), auth.uid());

  insert into public.bf_members(
    org_id, user_id, email, role, status, invited_by
  ) values (
    v_org_id, auth.uid(), v_email, 'owner', 'active', auth.uid()
  );

  insert into public.bf_audit_events(
    org_id, actor_user_id, action, entity_type, entity_id
  ) values (
    v_org_id, auth.uid(), 'organization.created', 'organization', v_org_id::text
  );

  return v_org_id;
end;
$$;

-- Provisionnement initial réservé à l'opérateur serveur. Le propriétaire
-- reçoit un espace déjà prêt et n'a jamais à créer lui-même l'organisation.
-- La clé stable rend la commande relançable sans créer de doublon.
create or replace function public.bf_operator_provision_organization(
  p_provisioning_key text,
  p_owner_user_id uuid,
  p_owner_email text,
  p_name text,
  p_display_name text default '',
  p_brand_name text default 'Best Friend',
  p_owner_label text default 'Propriétaire'
)
returns table(org_id uuid, created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := lower(trim(coalesce(p_provisioning_key, '')));
  v_email text := lower(trim(coalesce(p_owner_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_brand_name text := trim(coalesce(p_brand_name, ''));
  v_owner_label text := trim(coalesce(p_owner_label, ''));
  v_auth_email text;
  v_org_id uuid;
  v_existing_owner_id uuid;
  v_existing_owner_email text;
begin
  if v_key !~ '^[a-z0-9][a-z0-9_-]{2,63}$' then
    raise exception 'invalid_provisioning_key';
  end if;
  if p_owner_user_id is null then
    raise exception 'owner_user_required';
  end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'invalid_owner_email';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_organization_name';
  end if;
  if char_length(v_display_name) > 120 then
    raise exception 'invalid_display_name';
  end if;
  if char_length(v_brand_name) not between 1 and 120 then
    raise exception 'invalid_brand_name';
  end if;
  if char_length(v_owner_label) not between 1 and 80 then
    raise exception 'invalid_owner_label';
  end if;

  select lower(trim(u.email))
    into v_auth_email
    from auth.users u
   where u.id = p_owner_user_id;
  if not found then
    raise exception 'owner_user_not_found';
  end if;
  if v_auth_email <> v_email then
    raise exception 'owner_email_mismatch';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('best-friend:provision:' || v_key, 0)
  );

  select o.id, m.user_id, lower(trim(m.email))
    into v_org_id, v_existing_owner_id, v_existing_owner_email
    from public.bf_organizations o
    left join public.bf_members m
      on m.org_id = o.id
     and m.role = 'owner'
   where o.provisioning_key = v_key
   order by m.created_at
   limit 1;

  if found then
    if v_existing_owner_id is distinct from p_owner_user_id
       or v_existing_owner_email is distinct from v_email then
      raise exception 'provisioning_key_conflict';
    end if;
    return query select v_org_id, false;
    return;
  end if;

  v_org_id := gen_random_uuid();
  insert into public.bf_organizations(
    id, provisioning_key, name, brand_name, owner_label, settings, created_by
  ) values (
    v_org_id, v_key, v_name, v_brand_name, v_owner_label,
    jsonb_build_object('provisioned_by', 'operator'),
    p_owner_user_id
  );

  insert into public.bf_members(
    org_id, user_id, email, display_name, role, status
  ) values (
    v_org_id, p_owner_user_id, v_email, v_display_name, 'owner', 'active'
  );

  insert into public.bf_audit_events(
    org_id, action, entity_type, entity_id, metadata
  ) values (
    v_org_id, 'organization.provisioned', 'organization', v_org_id::text,
    jsonb_build_object('mode', 'operator')
  );

  return query select v_org_id, true;
end;
$$;

-- Un utilisateur accepte uniquement les invitations correspondant à l'adresse
-- vérifiée présente dans son JWT Supabase.
create or replace function public.bf_accept_invitations()
returns table(org_id uuid, organization_name text, member_role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := public.bf_current_email();
begin
  if auth.uid() is null or v_email = '' then
    raise exception 'authentication_required';
  end if;

  update public.bf_members m
     set user_id = auth.uid(), status = 'active', updated_at = now()
   where m.email = v_email
     and (m.user_id is null or m.user_id = auth.uid())
     and m.status in ('invited', 'active');

  return query
    select o.id, o.name, m.role
      from public.bf_members m
      join public.bf_organizations o on o.id = m.org_id
     where m.user_id = auth.uid()
       and m.status = 'active'
     order by o.name;
end;
$$;

create or replace function public.bf_list_my_organizations()
returns table(
  org_id uuid,
  organization_name text,
  brand_name text,
  owner_label text,
  member_role text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.brand_name, o.owner_label, m.role
    from public.bf_members m
    join public.bf_organizations o on o.id = m.org_id
   where m.user_id = auth.uid()
     and m.status = 'active'
   order by o.name
$$;

create or replace function public.bf_invite_member(
  p_org_id uuid,
  p_email text,
  p_display_name text,
  p_role text,
  p_property_ids text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_member_id uuid;
  v_existing_role text;
  v_actor_role text;
begin
  select role into v_actor_role
    from public.bf_members
   where org_id = p_org_id
     and user_id = auth.uid()
     and status = 'active';

  if v_actor_role not in ('owner', 'admin', 'manager') then
    raise exception 'forbidden';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'invalid_email';
  end if;
  if p_role not in ('owner', 'admin', 'manager', 'concierge', 'viewer') then
    raise exception 'invalid_role';
  end if;
  if p_role in ('owner', 'admin') and v_actor_role <> 'owner' then
    raise exception 'only_owner_can_manage_privileged_roles';
  end if;
  if p_role = 'manager' and v_actor_role not in ('owner', 'admin') then
    raise exception 'manager_cannot_manage_manager';
  end if;

  select role into v_existing_role
    from public.bf_members
   where org_id = p_org_id and email = v_email;
  if v_existing_role in ('owner', 'admin') and v_actor_role <> 'owner' then
    raise exception 'only_owner_can_manage_privileged_roles';
  end if;
  if v_existing_role = 'manager'
     and v_actor_role not in ('owner', 'admin') then
    raise exception 'manager_cannot_manage_manager';
  end if;
  if v_existing_role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.bf_members
           where org_id = p_org_id and role = 'owner' and status = 'active') <= 1 then
    raise exception 'last_owner_cannot_be_demoted';
  end if;

  insert into public.bf_members(
    org_id, email, display_name, role, status, invited_by
  ) values (
    p_org_id, v_email, trim(coalesce(p_display_name, '')), p_role,
    'invited', auth.uid()
  )
  on conflict (org_id, email) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        status = case
          when public.bf_members.user_id is null then 'invited'
          else 'active'
        end,
        updated_at = now()
  returning id into v_member_id;

  delete from public.bf_property_members
   where org_id = p_org_id and member_id = v_member_id;

  insert into public.bf_property_members(org_id, property_id, member_id)
  select p_org_id, p.id, v_member_id
    from public.bf_properties p
   where p.org_id = p_org_id
     and p.id = any(coalesce(p_property_ids, '{}'::text[]))
  on conflict do nothing;

  insert into public.bf_audit_events(
    org_id, actor_user_id, action, entity_type, entity_id,
    metadata
  ) values (
    p_org_id, auth.uid(), 'member.invited', 'member', v_member_id::text,
    jsonb_build_object('role', p_role)
  );

  return v_member_id;
end;
$$;

create or replace function public.bf_remove_member(
  p_org_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member public.bf_members%rowtype;
  v_actor_role text;
begin
  select role into v_actor_role
    from public.bf_members
   where org_id = p_org_id
     and user_id = auth.uid()
     and status = 'active';

  if v_actor_role not in ('owner', 'admin') then
    raise exception 'forbidden';
  end if;

  select * into v_member
    from public.bf_members
   where org_id = p_org_id
     and email = lower(trim(coalesce(p_email, '')));

  if not found then
    return;
  end if;
  if v_member.role in ('owner', 'admin') and v_actor_role <> 'owner' then
    raise exception 'only_owner_can_remove_privileged_roles';
  end if;
  if v_member.user_id = auth.uid() and v_member.role = 'owner' then
    raise exception 'owner_cannot_remove_self';
  end if;

  delete from public.bf_members where id = v_member.id;

  insert into public.bf_audit_events(
    org_id, actor_user_id, action, entity_type, entity_id,
    metadata
  ) values (
    p_org_id, auth.uid(), 'member.removed', 'member', v_member.id::text,
    jsonb_build_object('role', v_member.role)
  );
end;
$$;

-- Remplacement transactionnel d'un instantané métier. Cette fonction est
-- réservée aux propriétaires et administrateurs : aucune suppression partielle
-- n'est laissée visible si une ligne du fichier est invalide.
create or replace function public.bf_replace_snapshot(
  p_org_id uuid,
  p_snapshot jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_properties integer;
  v_reservations integer;
  v_operations integer;
  v_contacts integer;
  v_counts jsonb;
  v_previous_snapshot jsonb;
  v_previous_counts jsonb;
  v_recovery_id uuid;
begin
  if not public.bf_has_role(p_org_id, array['owner', 'admin']) then
    raise exception 'forbidden';
  end if;
  if jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'invalid_snapshot';
  end if;
  if pg_column_size(p_snapshot) > 25 * 1024 * 1024 then
    raise exception 'snapshot_too_large';
  end if;
  if pg_column_size(coalesce(p_metadata, '{}'::jsonb)) > 32 * 1024 then
    raise exception 'snapshot_metadata_too_large';
  end if;
  if jsonb_typeof(p_snapshot -> 'apartments') <> 'array'
     or jsonb_typeof(p_snapshot -> 'reservations') <> 'array'
     or jsonb_typeof(p_snapshot -> 'interventions') <> 'array'
     or jsonb_typeof(p_snapshot -> 'contacts') <> 'array' then
    raise exception 'invalid_snapshot_collections';
  end if;

  v_properties := jsonb_array_length(p_snapshot -> 'apartments');
  v_reservations := jsonb_array_length(p_snapshot -> 'reservations');
  v_operations := jsonb_array_length(p_snapshot -> 'interventions');
  v_contacts := jsonb_array_length(p_snapshot -> 'contacts');
  if greatest(v_properties, v_reservations, v_operations, v_contacts) > 10000 then
    raise exception 'snapshot_collection_too_large';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_snapshot -> 'apartments') item
     where jsonb_typeof(item) <> 'object'
        or trim(coalesce(item ->> 'id', '')) = ''
        or char_length(trim(item ->> 'id')) > 200
        or trim(coalesce(item ->> 'name', '')) = ''
  ) then
    raise exception 'invalid_snapshot_properties';
  end if;
  if (
    select count(*) <> count(distinct trim(item ->> 'id'))
      from jsonb_array_elements(p_snapshot -> 'apartments') item
  ) then
    raise exception 'duplicate_snapshot_property';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_snapshot -> 'reservations') item
     where jsonb_typeof(item) <> 'object'
        or trim(coalesce(item ->> 'id', '')) = ''
        or char_length(trim(item ->> 'id')) > 200
        or not exists (
          select 1
            from jsonb_array_elements(p_snapshot -> 'apartments') property
           where trim(property ->> 'id') = trim(item ->> 'aptId')
        )
  ) then
    raise exception 'invalid_snapshot_reservations';
  end if;
  if (
    select count(*) <> count(distinct trim(item ->> 'id'))
      from jsonb_array_elements(p_snapshot -> 'reservations') item
  ) then
    raise exception 'duplicate_snapshot_reservation';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_snapshot -> 'interventions') item
     where jsonb_typeof(item) <> 'object'
        or trim(coalesce(item ->> 'id', '')) = ''
        or char_length(trim(item ->> 'id')) > 200
        or not exists (
          select 1
            from jsonb_array_elements(p_snapshot -> 'apartments') property
           where trim(property ->> 'id') = trim(item ->> 'aptId')
        )
  ) then
    raise exception 'invalid_snapshot_operations';
  end if;
  if (
    select count(*) <> count(distinct trim(item ->> 'id'))
      from jsonb_array_elements(p_snapshot -> 'interventions') item
  ) then
    raise exception 'duplicate_snapshot_operation';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_snapshot -> 'contacts') item
     where jsonb_typeof(item) <> 'object'
        or trim(coalesce(item ->> 'id', '')) = ''
        or char_length(trim(item ->> 'id')) > 200
        or (
          trim(coalesce(item ->> 'aptId', '')) <> ''
          and not exists (
            select 1
              from jsonb_array_elements(p_snapshot -> 'apartments') property
             where trim(property ->> 'id') = trim(item ->> 'aptId')
          )
        )
  ) then
    raise exception 'invalid_snapshot_contacts';
  end if;
  if (
    select count(*) <> count(distinct trim(item ->> 'id'))
      from jsonb_array_elements(p_snapshot -> 'contacts') item
  ) then
    raise exception 'duplicate_snapshot_contact';
  end if;

  -- Sérialise deux restaurations concurrentes pour la même organisation.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  v_previous_snapshot := jsonb_build_object(
    'organization', '{}'::jsonb,
    'apartments', coalesce((
      select jsonb_agg(
        property.doc || jsonb_build_object(
          'id', property.id,
          'name', property.name,
          'active', property.active
        )
        order by property.id
      )
      from public.bf_properties property
      where property.org_id = p_org_id
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(
        reservation.doc || jsonb_build_object(
          'id', reservation.id,
          'aptId', reservation.property_id
        )
        order by reservation.id
      )
      from public.bf_reservations reservation
      where reservation.org_id = p_org_id
    ), '[]'::jsonb),
    'interventions', coalesce((
      select jsonb_agg(
        operation.doc || jsonb_build_object(
          'id', operation.id,
          'aptId', operation.property_id,
          'kind', operation.kind,
          'planned', operation.status <> 'done'
        )
        order by operation.id
      )
      from public.bf_operations operation
      where operation.org_id = p_org_id
    ), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(
        contact.doc || jsonb_build_object(
          'id', contact.id,
          'aptId', contact.property_id
        )
        order by contact.id
      )
      from public.bf_contacts contact
      where contact.org_id = p_org_id
    ), '[]'::jsonb)
  );
  v_previous_counts := jsonb_build_object(
    'apartments', jsonb_array_length(v_previous_snapshot -> 'apartments'),
    'reservations', jsonb_array_length(v_previous_snapshot -> 'reservations'),
    'interventions', jsonb_array_length(v_previous_snapshot -> 'interventions'),
    'contacts', jsonb_array_length(v_previous_snapshot -> 'contacts')
  );
  insert into public.bf_snapshots(
    org_id, kind, counts, snapshot, metadata, created_by
  ) values (
    p_org_id,
    'pre_replace',
    v_previous_counts,
    v_previous_snapshot,
    jsonb_build_object('reason', 'before_snapshot_replace'),
    auth.uid()
  )
  returning id into v_recovery_id;

  delete from public.bf_reservations where org_id = p_org_id;
  delete from public.bf_operations where org_id = p_org_id;
  delete from public.bf_contacts where org_id = p_org_id;

  insert into public.bf_properties(org_id, id, name, active, doc)
  select
    p_org_id,
    trim(item ->> 'id'),
    trim(item ->> 'name'),
    case
      when jsonb_typeof(item -> 'active') = 'boolean'
        then (item ->> 'active')::boolean
      else true
    end,
    item
  from jsonb_array_elements(p_snapshot -> 'apartments') item
  on conflict (org_id, id) do update
    set name = excluded.name,
        active = excluded.active,
        doc = excluded.doc,
        updated_at = now();

  delete from public.bf_properties property
   where property.org_id = p_org_id
     and not exists (
       select 1
         from jsonb_array_elements(p_snapshot -> 'apartments') item
        where trim(item ->> 'id') = property.id
     );

  insert into public.bf_reservations(org_id, id, property_id, doc)
  select p_org_id, trim(item ->> 'id'), trim(item ->> 'aptId'), item
    from jsonb_array_elements(p_snapshot -> 'reservations') item;

  insert into public.bf_operations(
    org_id, id, property_id, kind, status, doc, created_by
  )
  select
    p_org_id,
    trim(item ->> 'id'),
    trim(item ->> 'aptId'),
    coalesce(nullif(trim(item ->> 'kind'), ''), nullif(trim(item ->> 'type'), ''), 'intervention'),
    case when item -> 'planned' = 'true'::jsonb then 'open' else 'done' end,
    item,
    auth.uid()
  from jsonb_array_elements(p_snapshot -> 'interventions') item;

  insert into public.bf_contacts(org_id, id, property_id, doc)
  select
    p_org_id,
    trim(item ->> 'id'),
    nullif(trim(item ->> 'aptId'), ''),
    item
  from jsonb_array_elements(p_snapshot -> 'contacts') item;

  v_counts := jsonb_build_object(
    'apartments', v_properties,
    'reservations', v_reservations,
    'interventions', v_operations,
    'contacts', v_contacts
  );
  insert into public.bf_audit_events(
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_org_id,
    auth.uid(),
    'snapshot.replaced',
    'organization',
    p_org_id::text,
    (case when jsonb_typeof(p_metadata) = 'object' then p_metadata else '{}'::jsonb end)
      || jsonb_build_object('counts', v_counts, 'recoveryId', v_recovery_id)
  );

  delete from public.bf_snapshots snapshot
   where snapshot.org_id = p_org_id
     and snapshot.id not in (
       select kept.id
         from public.bf_snapshots kept
        where kept.org_id = p_org_id
        order by kept.created_at desc, kept.id desc
        limit 3
     );

  return v_counts || jsonb_build_object('recoveryId', v_recovery_id);
end;
$$;

create or replace function public.bf_restore_snapshot(
  p_org_id uuid,
  p_snapshot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
begin
  if not public.bf_has_role(p_org_id, array['owner', 'admin']) then
    raise exception 'forbidden';
  end if;
  select snapshot.snapshot
    into v_snapshot
    from public.bf_snapshots snapshot
   where snapshot.org_id = p_org_id
     and snapshot.id = p_snapshot_id;
  if not found then
    raise exception 'snapshot_not_found';
  end if;
  return public.bf_replace_snapshot(
    p_org_id,
    v_snapshot,
    jsonb_build_object('restoredFrom', p_snapshot_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.bf_organizations enable row level security;
alter table public.bf_members enable row level security;
alter table public.bf_properties enable row level security;
alter table public.bf_property_members enable row level security;
alter table public.bf_reservations enable row level security;
alter table public.bf_operations enable row level security;
alter table public.bf_contacts enable row level security;
alter table public.bf_notification_channels enable row level security;
alter table public.bf_audit_events enable row level security;
alter table public.bf_snapshots enable row level security;

drop policy if exists bf_organizations_select on public.bf_organizations;
create policy bf_organizations_select on public.bf_organizations
  for select to authenticated
  using (public.bf_is_member(id));

drop policy if exists bf_organizations_update on public.bf_organizations;
create policy bf_organizations_update on public.bf_organizations
  for update to authenticated
  using (public.bf_has_role(id, array['owner', 'admin']))
  with check (public.bf_has_role(id, array['owner', 'admin']));

drop policy if exists bf_members_select on public.bf_members;
create policy bf_members_select on public.bf_members
  for select to authenticated
  using (user_id = auth.uid() or public.bf_can_manage(org_id));

drop policy if exists bf_properties_select on public.bf_properties;
create policy bf_properties_select on public.bf_properties
  for select to authenticated
  using (public.bf_can_access_property(org_id, id));

drop policy if exists bf_properties_insert on public.bf_properties;
create policy bf_properties_insert on public.bf_properties
  for insert to authenticated
  with check (public.bf_can_manage(org_id));

drop policy if exists bf_properties_update on public.bf_properties;
create policy bf_properties_update on public.bf_properties
  for update to authenticated
  using (public.bf_can_manage(org_id))
  with check (public.bf_can_manage(org_id));

drop policy if exists bf_properties_delete on public.bf_properties;
create policy bf_properties_delete on public.bf_properties
  for delete to authenticated
  using (public.bf_has_role(org_id, array['owner', 'admin']));

drop policy if exists bf_property_members_select on public.bf_property_members;
create policy bf_property_members_select on public.bf_property_members
  for select to authenticated
  using (
    public.bf_can_manage(org_id)
    or exists (
      select 1 from public.bf_members m
       where m.id = member_id and m.user_id = auth.uid()
    )
  );

drop policy if exists bf_reservations_select on public.bf_reservations;
create policy bf_reservations_select on public.bf_reservations
  for select to authenticated
  using (public.bf_can_access_property(org_id, property_id));

drop policy if exists bf_reservations_insert on public.bf_reservations;
create policy bf_reservations_insert on public.bf_reservations
  for insert to authenticated
  with check (public.bf_can_manage(org_id));

drop policy if exists bf_reservations_update on public.bf_reservations;
create policy bf_reservations_update on public.bf_reservations
  for update to authenticated
  using (public.bf_can_manage(org_id))
  with check (public.bf_can_manage(org_id));

drop policy if exists bf_reservations_delete on public.bf_reservations;
create policy bf_reservations_delete on public.bf_reservations
  for delete to authenticated
  using (public.bf_can_manage(org_id));

drop policy if exists bf_operations_select on public.bf_operations;
create policy bf_operations_select on public.bf_operations
  for select to authenticated
  using (public.bf_can_access_property(org_id, property_id));

drop policy if exists bf_operations_insert on public.bf_operations;
create policy bf_operations_insert on public.bf_operations
  for insert to authenticated
  with check (
    public.bf_can_access_property(org_id, property_id)
    and created_by = auth.uid()
  );

drop policy if exists bf_operations_update on public.bf_operations;
create policy bf_operations_update on public.bf_operations
  for update to authenticated
  using (public.bf_can_access_property(org_id, property_id))
  with check (public.bf_can_access_property(org_id, property_id));

drop policy if exists bf_operations_delete on public.bf_operations;
create policy bf_operations_delete on public.bf_operations
  for delete to authenticated
  using (public.bf_can_manage(org_id));

drop policy if exists bf_contacts_select on public.bf_contacts;
create policy bf_contacts_select on public.bf_contacts
  for select to authenticated
  using (
    public.bf_can_manage(org_id)
    or (property_id is not null and public.bf_can_access_property(org_id, property_id))
  );

drop policy if exists bf_contacts_write on public.bf_contacts;
create policy bf_contacts_write on public.bf_contacts
  for all to authenticated
  using (public.bf_can_manage(org_id))
  with check (public.bf_can_manage(org_id));

drop policy if exists bf_notification_channels_select on public.bf_notification_channels;
create policy bf_notification_channels_select on public.bf_notification_channels
  for select to authenticated
  using (public.bf_can_manage(org_id));

drop policy if exists bf_notification_channels_write on public.bf_notification_channels;
create policy bf_notification_channels_write on public.bf_notification_channels
  for all to authenticated
  using (public.bf_has_role(org_id, array['owner', 'admin']))
  with check (public.bf_has_role(org_id, array['owner', 'admin']));

drop policy if exists bf_audit_events_select on public.bf_audit_events;
create policy bf_audit_events_select on public.bf_audit_events
  for select to authenticated
  using (public.bf_can_manage(org_id));

drop policy if exists bf_snapshots_select on public.bf_snapshots;
create policy bf_snapshots_select on public.bf_snapshots
  for select to authenticated
  using (public.bf_has_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- Privilèges API
-- ---------------------------------------------------------------------------

revoke all on public.bf_organizations from anon;
revoke all on public.bf_members from anon;
revoke all on public.bf_properties from anon;
revoke all on public.bf_property_members from anon;
revoke all on public.bf_reservations from anon;
revoke all on public.bf_operations from anon;
revoke all on public.bf_contacts from anon;
revoke all on public.bf_notification_channels from anon;
revoke all on public.bf_audit_events from anon;
revoke all on public.bf_snapshots from anon;

grant select, update on public.bf_organizations to authenticated;
grant select on public.bf_members, public.bf_property_members to authenticated;
grant select, insert, update, delete on public.bf_properties to authenticated;
grant select, insert, update, delete on public.bf_reservations to authenticated;
grant select, insert, update, delete on public.bf_operations to authenticated;
grant select, insert, update, delete on public.bf_contacts to authenticated;
grant select, insert, update, delete on public.bf_notification_channels to authenticated;
grant select on public.bf_audit_events to authenticated;
grant select on public.bf_snapshots to authenticated;

-- Le rôle serveur est utilisé uniquement par les commandes opérateur
-- (provisionnement, recette et nettoyage). RLS continue de protéger tous les
-- utilisateurs métier ; cette clé ne quitte jamais l'environnement serveur.
grant select, insert, update, delete on public.bf_organizations to service_role;
grant select, insert, update, delete on public.bf_members to service_role;
grant select, insert, update, delete on public.bf_properties to service_role;
grant select, insert, update, delete on public.bf_property_members to service_role;
grant select, insert, update, delete on public.bf_reservations to service_role;
grant select, insert, update, delete on public.bf_operations to service_role;
grant select, insert, update, delete on public.bf_contacts to service_role;
grant select, insert, update, delete on public.bf_notification_channels to service_role;
grant select, insert, update, delete on public.bf_audit_events to service_role;
grant select, insert, update, delete on public.bf_snapshots to service_role;
grant usage, select on sequence public.bf_audit_events_id_seq to service_role;

revoke all on function public.bf_create_organization(text)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_operator_provision_organization(
  text, uuid, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.bf_accept_invitations()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_list_my_organizations()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_invite_member(uuid, text, text, text, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.bf_remove_member(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_replace_snapshot(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_restore_snapshot(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.bf_create_organization(text) to authenticated;
grant execute on function public.bf_operator_provision_organization(
  text, uuid, text, text, text, text, text
) to service_role;
grant execute on function public.bf_accept_invitations() to authenticated;
grant execute on function public.bf_list_my_organizations() to authenticated;
grant execute on function public.bf_invite_member(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.bf_remove_member(uuid, text) to authenticated;
grant execute on function public.bf_replace_snapshot(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.bf_restore_snapshot(uuid, uuid) to authenticated;

-- Les utilitaires SECURITY DEFINER ne sont jamais ouverts au rôle anonyme.
revoke all on function public.bf_touch_updated_at()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_current_email()
  from public, anon, authenticated, service_role;
revoke all on function public.bf_is_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_has_role(uuid, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.bf_can_manage(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.bf_can_access_property(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.bf_is_member(uuid) to authenticated;
grant execute on function public.bf_has_role(uuid, text[]) to authenticated;
grant execute on function public.bf_can_manage(uuid) to authenticated;
grant execute on function public.bf_can_access_property(uuid, text) to authenticated;

-- Realtime est ajouté seulement si la publication Supabase existe déjà.
do $$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'bf_members', 'bf_properties', 'bf_property_members',
      'bf_reservations', 'bf_operations', 'bf_contacts'
    ]
    loop
      begin
        execute format(
          'alter publication supabase_realtime add table public.%I',
          table_name
        );
      exception when duplicate_object then
        null;
      end;
    end loop;
  end if;
end;
$$;

commit;

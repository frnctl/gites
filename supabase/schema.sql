-- =====================================================================
-- Best Friend — schéma Supabase v3  (à coller UNE FOIS : SQL Editor → Run)
--
-- Modèle « espace partagé + accès par appartement » :
--   • Bruno = ADMIN ultime  → voit / édite TOUT.
--   • Concierges            → voient / éditent UNIQUEMENT leur(s) appart(s).
--   • Accès géré PAR EMAIL (table members) → Bruno ajoute ses concierges
--     facilement, même avant qu'elles aient créé leur compte.
--   • Le 1er utilisateur connecté devient automatiquement admin (Bruno).
--
-- ⚠️ Ce script REMET À ZÉRO les tables cloud (aucune donnée réelle encore).
-- =====================================================================

-- ---- Remise à plat (ancien modèle « owner ») ----
drop table if exists public.apartments    cascade;
drop table if exists public.reservations  cascade;
drop table if exists public.interventions cascade;
drop table if exists public.contacts      cascade;
drop table if exists public.members       cascade;

-- ---- Annuaire des accès (qui a le droit à quoi) ----
create table public.members (
  email      text primary key,                 -- en minuscules
  role       text not null default 'concierge',-- 'admin' | 'concierge'
  apt_ids    text[] not null default '{}',     -- appartements autorisés (concierge)
  name       text default '',
  updated_at timestamptz not null default now()
);

-- ---- Données ----
create table public.apartments (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table public.reservations (
  id text primary key, apt_id text, doc jsonb not null, updated_at timestamptz not null default now());
create table public.interventions (
  id text primary key, apt_id text, doc jsonb not null, updated_at timestamptz not null default now());
create table public.contacts (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now());

-- =====================================================================
-- Fonctions d'accès (SECURITY DEFINER → évitent la récursion RLS)
-- =====================================================================
create or replace function public.bf_email() returns text
  language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;

create or replace function public.bf_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where email = lower(auth.jwt() ->> 'email') and role = 'admin') $$;

create or replace function public.bf_my_apts() returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce((select apt_ids from public.members
                   where email = lower(auth.jwt() ->> 'email')), '{}') $$;

-- Le 1er utilisateur (Bruno) se déclare admin tout seul tant qu'aucun admin n'existe.
create or replace function public.bf_claim_admin() returns text
  language plpgsql security definer set search_path = public as $$
declare em text := lower(auth.jwt() ->> 'email');
begin
  if em is null then return 'no-email'; end if;
  if not exists (select 1 from public.members where role = 'admin') then
    insert into public.members(email, role) values (em, 'admin')
      on conflict (email) do update set role = 'admin';
    return 'admin';
  end if;
  return coalesce((select role from public.members where email = em), 'none');
end $$;

-- =====================================================================
-- Sécurité (RLS)
-- =====================================================================
alter table public.members       enable row level security;
alter table public.apartments    enable row level security;
alter table public.reservations  enable row level security;
alter table public.interventions enable row level security;
alter table public.contacts      enable row level security;

-- members : chacun lit sa propre ligne ; l'admin lit/écrit tout
drop policy if exists members_read on public.members;
create policy members_read on public.members for select
  using (email = public.bf_email() or public.bf_is_admin());
drop policy if exists members_write on public.members;
create policy members_write on public.members for all
  using (public.bf_is_admin()) with check (public.bf_is_admin());

-- apartments : admin = tout ; concierge = ses appart(s) ; édition admin only
drop policy if exists apt_read on public.apartments;
create policy apt_read on public.apartments for select
  using (public.bf_is_admin() or id = any(public.bf_my_apts()));
drop policy if exists apt_write on public.apartments;
create policy apt_write on public.apartments for all
  using (public.bf_is_admin()) with check (public.bf_is_admin());

-- reservations / interventions : admin = tout ; concierge = ses appart(s), lecture + écriture
drop policy if exists res_all on public.reservations;
create policy res_all on public.reservations for all
  using (public.bf_is_admin() or apt_id = any(public.bf_my_apts()))
  with check (public.bf_is_admin() or apt_id = any(public.bf_my_apts()));

drop policy if exists int_all on public.interventions;
create policy int_all on public.interventions for all
  using (public.bf_is_admin() or apt_id = any(public.bf_my_apts()))
  with check (public.bf_is_admin() or apt_id = any(public.bf_my_apts()));

-- contacts (annuaire) : lisible par tout connecté ; édition admin only
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select
  using (auth.role() = 'authenticated');
drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts for all
  using (public.bf_is_admin()) with check (public.bf_is_admin());

-- =====================================================================
-- Temps réel (ignore l'erreur "already member" si relancé)
-- =====================================================================
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.apartments;
alter publication supabase_realtime add table public.reservations;
alter publication supabase_realtime add table public.interventions;
alter publication supabase_realtime add table public.contacts;

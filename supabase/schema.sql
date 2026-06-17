-- =====================================================================
-- Gîtes — schéma Supabase (à coller UNE FOIS dans : SQL Editor → Run)
-- Crée 4 tables protégées par RLS (owner = utilisateur connecté) + temps réel.
-- =====================================================================

-- ---- Tables ----
create table if not exists public.apartments (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.reservations (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.interventions (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.contacts (
  id         text primary key,
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---- Sécurité : chacun ne voit/écrit que ses propres lignes ----
alter table public.apartments    enable row level security;
alter table public.reservations  enable row level security;
alter table public.interventions enable row level security;
alter table public.contacts      enable row level security;

drop policy if exists own_all on public.apartments;
create policy own_all on public.apartments    for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists own_all on public.reservations;
create policy own_all on public.reservations  for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists own_all on public.interventions;
create policy own_all on public.interventions for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists own_all on public.contacts;
create policy own_all on public.contacts      for all using (owner = auth.uid()) with check (owner = auth.uid());

-- ---- Temps réel (ignore l'erreur "already member" si relancé) ----
alter publication supabase_realtime add table public.apartments;
alter publication supabase_realtime add table public.reservations;
alter publication supabase_realtime add table public.interventions;
alter publication supabase_realtime add table public.contacts;

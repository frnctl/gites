-- Bugbox : boîte à rapports de bugs remontés depuis l'app.
-- Tout membre connecté peut déposer un rapport ; personne ne peut les
-- lire depuis l'app (pas de politique select) — la lecture se fait
-- côté administration (psql / service role).

create table if not exists public.bf_bugs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  org_id uuid,
  email text,
  page text,
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  status text not null default 'new'
);

alter table public.bf_bugs enable row level security;

drop policy if exists bf_bugs_insert on public.bf_bugs;
create policy bf_bugs_insert on public.bf_bugs
  for insert to authenticated
  with check (
    message is not null
    and length(message) between 3 and 4000
  );

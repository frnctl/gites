-- Annuaire des prestataires (plateforme, hors organisations) :
-- un artisan candidate avec sa fiche complète ; le référencement
-- n'est effectif qu'après validation manuelle (status 'approved').
-- Chaque prestataire ne voit et ne modifie que sa propre fiche ;
-- une fiche validée n'est plus modifiable par son auteur (elle
-- repasserait par la validation sinon).

create table if not exists public.bf_providers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  company text not null default '',
  trades text not null default '',
  presentation text not null default '',
  phone text not null default '',
  website text not null default '',
  zone text not null default '',
  files jsonb not null default '[]'::jsonb,
  charte_accepted_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected'))
);

alter table public.bf_providers enable row level security;

drop policy if exists bf_providers_select on public.bf_providers;
create policy bf_providers_select on public.bf_providers
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists bf_providers_insert on public.bf_providers;
create policy bf_providers_insert on public.bf_providers
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and charte_accepted_at is not null);

drop policy if exists bf_providers_update on public.bf_providers;
create policy bf_providers_update on public.bf_providers
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status = 'pending');

drop trigger if exists bf_providers_touch_updated_at on public.bf_providers;
create trigger bf_providers_touch_updated_at
  before update on public.bf_providers
  for each row execute function public.bf_touch_updated_at();

-- Stockage des pièces jointes (PDF / images d'entreprise) :
-- chaque prestataire écrit et lit uniquement dans son dossier <uid>/.
drop policy if exists bf_providers_files_insert on storage.objects;
create policy bf_providers_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bf-providers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists bf_providers_files_select on storage.objects;
create policy bf_providers_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'bf-providers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists bf_providers_files_delete on storage.objects;
create policy bf_providers_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'bf-providers' and (storage.foldername(name))[1] = auth.uid()::text);

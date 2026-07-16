-- Best Friend v4 — livraison privée et preuves photo hors JSON

begin;

-- Une organisation est toujours préparée par l'opérateur. Un compte connecté
-- sans espace ne peut pas transformer l'application privée en inscription
-- libre-service.
revoke all on function public.bf_create_organization(text)
  from public, anon, authenticated, service_role;

-- Les preuves photo sont privées. Le chemin canonique est :
--   <org_id>/<property_id>/<user_id>/<uuid>.jpg
insert into storage.buckets(
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'bf-proofs',
  'bf-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bf_proofs_select on storage.objects;
create policy bf_proofs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bf-proofs'
    and exists (
      select 1
        from public.bf_properties property
       where property.org_id::text = (storage.foldername(storage.objects.name))[1]
         and property.id = (storage.foldername(storage.objects.name))[2]
         and public.bf_can_access_property(property.org_id, property.id)
    )
  );

drop policy if exists bf_proofs_insert on storage.objects;
create policy bf_proofs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bf-proofs'
    and (storage.foldername(storage.objects.name))[3] = auth.uid()::text
    and exists (
      select 1
        from public.bf_properties property
       where property.org_id::text = (storage.foldername(storage.objects.name))[1]
         and property.id = (storage.foldername(storage.objects.name))[2]
         and public.bf_can_access_property(property.org_id, property.id)
    )
  );

drop policy if exists bf_proofs_delete on storage.objects;
create policy bf_proofs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bf-proofs'
    and exists (
      select 1
        from public.bf_properties property
       where property.org_id::text = (storage.foldername(storage.objects.name))[1]
         and property.id = (storage.foldername(storage.objects.name))[2]
         and (
           public.bf_can_manage(property.org_id)
           or (storage.foldername(storage.objects.name))[3] = auth.uid()::text
         )
    )
  );

commit;

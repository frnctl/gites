\set ON_ERROR_STOP on

-- Supabase géré ajoute des ACL explicites aux fonctions à leur création.
-- Les migrations doivent donc retirer anon/authenticated nommément.
do $$
begin
  if has_function_privilege(
    'anon',
    'public.bf_create_organization(text)',
    'execute'
  ) then
    raise exception 'Le rôle anon peut créer une organisation';
  end if;
  if has_function_privilege(
    'anon',
    'public.bf_current_email()',
    'execute'
  ) then
    raise exception 'Le rôle anon peut appeler un utilitaire interne';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.bf_operator_provision_organization(text,uuid,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'Le rôle authenticated peut provisionner un tenant';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.bf_operator_provision_organization(text,uuid,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'Le rôle serveur ne peut pas provisionner un tenant';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.bf_create_organization(text)',
    'execute'
  ) then
    raise exception 'Le rôle authenticated peut créer son espace';
  end if;
  if has_function_privilege(
    'service_role',
    'public.bf_create_organization(text)',
    'execute'
  ) then
    raise exception 'Le rôle serveur contourne le provisionnement opérateur';
  end if;
  if not exists (
    select 1 from storage.buckets
     where id = 'bf-proofs'
       and public = false
       and file_size_limit = 5242880
  ) then
    raise exception 'Le bucket privé de preuves est absent ou mal configuré';
  end if;
  if (
    select count(*) from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname in ('bf_proofs_select','bf_proofs_insert','bf_proofs_delete')
  ) <> 3 then
    raise exception 'Les politiques Storage privées sont incomplètes';
  end if;
end;
$$;

-- L'opérateur prépare un espace complet avant la première connexion du
-- propriétaire. La même clé peut être rejouée sans doublon.
set role service_role;
select *
  from public.bf_operator_provision_organization(
    'prepared-owner-validation',
    '50000000-0000-0000-0000-000000000005',
    'prepared-owner@example.test',
    'Espace déjà prêt',
    'Propriétaire préparé'
  );
select *
  from public.bf_operator_provision_organization(
    'prepared-owner-validation',
    '50000000-0000-0000-0000-000000000005',
    'prepared-owner@example.test',
    'Espace déjà prêt',
    'Propriétaire préparé'
  );
reset role;

do $$
begin
  if (
    select count(*)
      from public.bf_organizations
     where provisioning_key = 'prepared-owner-validation'
  ) <> 1 then
    raise exception 'Le provisionnement opérateur a créé un doublon';
  end if;
  if not exists (
    select 1
      from public.bf_members m
      join public.bf_organizations o on o.id = m.org_id
     where o.provisioning_key = 'prepared-owner-validation'
       and m.user_id = '50000000-0000-0000-0000-000000000005'
       and m.role = 'owner'
       and m.status = 'active'
  ) then
    raise exception 'Le propriétaire préparé n''est pas actif';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000005',
  false
);
select set_config(
  'request.jwt.claim.email',
  'prepared-owner@example.test',
  false
);
set role authenticated;
do $$
begin
  if (select count(*) from public.bf_list_my_organizations()) <> 1 then
    raise exception 'Le propriétaire préparé ne voit pas son espace';
  end if;
  begin
    perform public.bf_operator_provision_organization(
      'forbidden-operator-call',
      '50000000-0000-0000-0000-000000000005',
      'prepared-owner@example.test',
      'Interdit'
    );
    raise exception 'test_authenticated_operator_call';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

-- Organisation principale : l'opérateur prépare l'espace, puis le propriétaire
-- ne peut utiliser que l'organisation qui lui a été affectée.
set role service_role;
select org_id as owner_org_id
  from public.bf_operator_provision_organization(
    'owner-validation',
    '10000000-0000-0000-0000-000000000001',
    'owner@example.test',
    'Maison Test',
    'Propriétaire Test'
  ) \gset
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  false
);
select set_config('request.jwt.claim.email', 'owner@example.test', false);
set role authenticated;

do $$
begin
  begin
    perform public.bf_create_organization('Espace non autorisé');
    raise exception 'test_authenticated_created_organization';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

insert into public.bf_properties(org_id, id, name, doc)
values (
  :'owner_org_id', 'apt-1', 'Appartement test',
  '{"id":"apt-1","name":"Appartement test"}'::jsonb
);

insert into storage.objects(bucket_id, name)
values (
  'bf-proofs',
  :'owner_org_id' || '/apt-1/10000000-0000-0000-0000-000000000001/owner.jpg'
);

do $$
declare
  v_org_id uuid := (
    select id from public.bf_organizations where name = 'Maison Test'
  );
begin
  begin
    insert into storage.objects(bucket_id, name)
    values (
      'bf-proofs',
      v_org_id::text || '/apt-1/30000000-0000-0000-0000-000000000003/forbidden.jpg'
    );
    raise exception 'test_owner_spoofed_proof_uploader';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select public.bf_invite_member(
  :'owner_org_id',
  'concierge@example.test',
  'Concierge Test',
  'concierge',
  array['apt-1']
);

select public.bf_invite_member(
  :'owner_org_id',
  'manager@example.test',
  'Manager Test',
  'manager',
  array['apt-1']
);

select public.bf_replace_snapshot(
  :'owner_org_id',
  jsonb_build_object(
    'apartments', jsonb_build_array(
      jsonb_build_object('id', 'apt-1', 'name', 'Appartement test', 'active', true),
      jsonb_build_object('id', 'apt-2', 'name', 'Bien non affecté', 'active', true)
    ),
    'reservations', jsonb_build_array(
      jsonb_build_object(
        'id', 'booking-1', 'aptId', 'apt-1',
        'guest', 'Voyageur Test', 'status', 'Confirmé'
      )
    ),
    'interventions', jsonb_build_array(
      jsonb_build_object(
        'id', 'imported-task', 'aptId', 'apt-1',
        'type', 'Ménage', 'planned', false
      )
    ),
    'contacts', jsonb_build_array(
      jsonb_build_object(
        'id', 'contact-1', 'aptId', 'apt-1', 'name', 'Prestataire Test'
      )
    )
  ),
  '{"source":"schema-test"}'::jsonb
);

do $$
declare
  v_org_id uuid := (
    select id from public.bf_organizations where name = 'Maison Test'
  );
begin
  begin
    perform public.bf_replace_snapshot(
      v_org_id,
      jsonb_build_object(
        'apartments', '[]'::jsonb,
        'reservations', jsonb_build_array(
          jsonb_build_object('id', 'bad', 'aptId', 'missing')
        ),
        'interventions', '[]'::jsonb,
        'contacts', '[]'::jsonb
      )
    );
    raise exception 'test_invalid_snapshot_accepted';
  exception when others then
    if sqlerrm = 'test_invalid_snapshot_accepted'
       or sqlerrm <> 'invalid_snapshot_reservations' then
      raise;
    end if;
  end;
  if (select count(*) from public.bf_properties where org_id = v_org_id) <> 2 then
    raise exception 'Une restauration invalide a modifié les propriétés';
  end if;
  if not exists (
    select 1 from public.bf_property_members
     where org_id = v_org_id and property_id = 'apt-1'
  ) then
    raise exception 'La restauration a supprimé une affectation conservée';
  end if;
  if (select count(*) from public.bf_snapshots where org_id = v_org_id) <> 1 then
    raise exception 'La sauvegarde de récupération est absente ou dupliquée';
  end if;
end;
$$;

reset role;

-- Un manager peut gérer l'exploitation, mais ne peut pas fabriquer un admin
-- ni modifier un rôle de même niveau.
select set_config(
  'request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000004',
  false
);
select set_config('request.jwt.claim.email', 'manager@example.test', false);
set role authenticated;

select * from public.bf_accept_invitations();

do $$
declare
  v_org_id uuid := (
    select id from public.bf_organizations where name = 'Maison Test'
  );
begin
  if exists (select 1 from public.bf_snapshots) then
    raise exception 'Une concierge voit les sauvegardes de récupération';
  end if;
  begin
    perform public.bf_invite_member(
      v_org_id, 'rogue-admin@example.test', 'Rogue Admin',
      'admin', '{}'::text[]
    );
    raise exception 'test_manager_promoted_admin';
  exception when others then
    if sqlerrm = 'test_manager_promoted_admin'
       or sqlerrm <> 'only_owner_can_manage_privileged_roles' then
      raise;
    end if;
  end;

  begin
    perform public.bf_invite_member(
      v_org_id, 'manager-2@example.test', 'Manager 2',
      'manager', '{}'::text[]
    );
    raise exception 'test_manager_created_manager';
  exception when others then
    if sqlerrm = 'test_manager_created_manager'
       or sqlerrm <> 'manager_cannot_manage_manager' then
      raise;
    end if;
  end;
end;
$$;

reset role;

-- La concierge accepte uniquement l'invitation correspondant à son JWT.
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  false
);
select set_config('request.jwt.claim.email', 'concierge@example.test', false);
set role authenticated;

select * from public.bf_accept_invitations();

do $$
begin
  if (select count(*) from public.bf_properties) <> 1 then
    raise exception 'La concierge ne voit pas son bien affecté';
  end if;
end;
$$;

insert into storage.objects(bucket_id, name)
values (
  'bf-proofs',
  :'owner_org_id' || '/apt-1/20000000-0000-0000-0000-000000000002/concierge.jpg'
);

do $$
declare
  v_org_id uuid := (
    select id from public.bf_organizations where name = 'Maison Test'
  );
begin
  begin
    insert into storage.objects(bucket_id, name)
    values (
      'bf-proofs',
      v_org_id::text || '/apt-2/20000000-0000-0000-0000-000000000002/forbidden.jpg'
    );
    raise exception 'test_concierge_uploaded_unassigned_proof';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

insert into public.bf_operations(
  org_id, id, property_id, kind, status, doc, created_by
) values (
  :'owner_org_id', 'task-1', 'apt-1', 'cleaning', 'done',
  '{"label":"Ménage terminé"}'::jsonb,
  '20000000-0000-0000-0000-000000000002'
);

do $$
declare
  v_org_id uuid := (
    select id from public.bf_organizations where name = 'Maison Test'
  );
begin
  begin
    perform public.bf_replace_snapshot(
      v_org_id,
      jsonb_build_object(
        'apartments', '[]'::jsonb,
        'reservations', '[]'::jsonb,
        'interventions', '[]'::jsonb,
        'contacts', '[]'::jsonb
      )
    );
    raise exception 'test_concierge_replaced_snapshot';
  exception when others then
    if sqlerrm = 'test_concierge_replaced_snapshot'
       or sqlerrm <> 'forbidden' then
      raise;
    end if;
  end;
end;
$$;

-- Une concierge ne peut pas créer ou modifier une réservation.
do $$
begin
  begin
    insert into public.bf_reservations(org_id, id, property_id, doc)
    values (
      (select id from public.bf_organizations limit 1),
      'forbidden-booking', 'apt-1', '{}'::jsonb
    );
    raise exception 'Une concierge a pu créer une réservation';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- L'opérateur prépare aussi le second espace : aucune donnée ne doit traverser
-- les tenants.
set role service_role;
select org_id as outsider_org_id
  from public.bf_operator_provision_organization(
    'outsider-validation',
    '30000000-0000-0000-0000-000000000003',
    'outsider@example.test',
    'Autre société',
    'Propriétaire Tiers'
  ) \gset
reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000003',
  false
);
select set_config('request.jwt.claim.email', 'outsider@example.test', false);
set role authenticated;

insert into public.bf_properties(org_id, id, name, doc)
values (
  :'outsider_org_id', 'apt-1', 'Bien tiers',
  '{"id":"apt-1","name":"Bien tiers"}'::jsonb
);

do $$
begin
  if (select count(*) from public.bf_organizations) <> 1 then
    raise exception 'Isolation organisations défaillante';
  end if;
  if (select count(*) from public.bf_properties) <> 1 then
    raise exception 'Isolation propriétés défaillante';
  end if;
  if exists (
    select 1 from public.bf_operations where id = 'task-1'
  ) then
    raise exception 'Une opération du premier tenant est visible par le second';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'bf-proofs') then
    raise exception 'Une preuve photo du premier tenant est visible par le second';
  end if;
end;
$$;

reset role;

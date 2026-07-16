import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const projectId = 'best-friend';
const users = [];
const organizations = [];
const storageObjects = [];

function command(command, args, options={}){
  const result = spawnSync(command, args, {
    cwd:root,
    encoding:'utf8',
    ...options
  });
  if(result.status!==0){
    throw new Error(
      `${command} ${args.join(' ')} a échoué: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return result.stdout;
}

function localEnvironment(){
  const output = command('npx', [
    '--yes', 'supabase@2.109.1', 'status', '-o', 'env'
  ]);
  const values = {};
  for(const line of output.split(/\r?\n/)){
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(?:"([^"]*)"|(.*))$/);
    if(match) values[match[1]] = match[2] ?? match[3] ?? '';
  }
  for(const name of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']){
    assert.ok(values[name], `Variable Supabase locale absente: ${name}`);
  }
  return values;
}

const environment = localEnvironment();
const apiUrl = environment.API_URL.replace(/\/$/, '');
const anonKey = environment.ANON_KEY;
const serviceRoleKey = environment.SERVICE_ROLE_KEY;

async function request(path, {
  method='GET',
  body,
  token=anonKey,
  apiKey=anonKey,
  prefer,
  allowError=false
}={}){
  const headers = {
    apikey:apiKey,
    Authorization:`Bearer ${token}`,
    Accept:'application/json'
  };
  if(body!==undefined) headers['Content-Type']='application/json';
  if(prefer) headers.Prefer=prefer;

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body:body===undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  if(text){
    try{ data=JSON.parse(text); }
    catch{ data=text; }
  }
  if(!allowError && !response.ok){
    throw new Error(`${method} ${path}: HTTP ${response.status} — ${text.slice(0, 500)}`);
  }
  return {response, data, text};
}

async function createUser(label){
  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `${label}.${suffix}@best-friend.test`;
  const password = `Bf-${crypto.randomUUID()}-9!`;
  const created = await request('/auth/v1/admin/users', {
    method:'POST',
    body:{email, password, email_confirm:true},
    token:serviceRoleKey,
    apiKey:serviceRoleKey
  });
  assert.match(created.data?.id || '', /^[0-9a-f-]{36}$/);
  users.push(created.data.id);

  const session = await request('/auth/v1/token?grant_type=password', {
    method:'POST',
    body:{email, password}
  });
  assert.ok(session.data?.access_token, `Session absente pour ${label}`);
  return {email, id:created.data.id, token:session.data.access_token};
}

async function rpc(name, token, body={}){
  return request(`/rest/v1/rpc/${name}`, {
    method:'POST',
    token,
    body
  });
}

async function createOrganization(user, name){
  const result = await request(
    '/rest/v1/rpc/bf_operator_provision_organization',
    {
      method:'POST',
      token:serviceRoleKey,
      apiKey:serviceRoleKey,
      body:{
        p_provisioning_key:'integration-'+crypto.randomUUID(),
        p_owner_user_id:user.id,
        p_owner_email:user.email,
        p_name:name,
        p_display_name:'Propriétaire de test'
      }
    }
  );
  const orgId=result.data?.[0]?.org_id;
  assert.match(orgId || '', /^[0-9a-f-]{36}$/);
  organizations.push(orgId);
  return orgId;
}

async function insertRows(table, token, rows){
  const result = await request(`/rest/v1/${table}`, {
    method:'POST',
    token,
    body:rows,
    prefer:'return=representation'
  });
  assert.equal(result.response.status, 201);
  return result.data;
}

function ids(rows){
  return rows.map(row=>row.id).sort();
}

function storageObjectUrl(path){
  return `${apiUrl}/storage/v1/object/bf-proofs/${
    path.split('/').map(encodeURIComponent).join('/')
  }`;
}

async function uploadProof(token, path){
  const response=await fetch(storageObjectUrl(path), {
    method:'POST',
    headers:{
      apikey:anonKey,
      Authorization:`Bearer ${token}`,
      'Content-Type':'image/jpeg',
      'x-upsert':'false'
    },
    body:new Uint8Array([0xff,0xd8,0xff,0xd9])
  });
  if(response.ok) storageObjects.push(path);
  return response;
}

async function signProof(token, path){
  return fetch(
    `${apiUrl}/storage/v1/object/sign/bf-proofs/${
      path.split('/').map(encodeURIComponent).join('/')
    }`,
    {
      method:'POST',
      headers:{
        apikey:anonKey,
        Authorization:`Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({expiresIn:60})
    }
  );
}

async function cleanup(){
  if(storageObjects.length){
    try{
      await fetch(`${apiUrl}/storage/v1/object/bf-proofs`, {
        method:'DELETE',
        headers:{
          apikey:serviceRoleKey,
          Authorization:`Bearer ${serviceRoleKey}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({prefixes:storageObjects})
      });
    }catch(error){
      console.warn('Nettoyage Storage incomplet:', error.message);
    }
  }
  const validUuid = /^[0-9a-f-]{36}$/;
  const orgIds = organizations.filter(id=>validUuid.test(id));
  const userIds = users.filter(id=>validUuid.test(id));
  const statements = [];
  if(userIds.length){
    statements.push(
      `delete from public.bf_organizations where created_by in (${
        userIds.map(id=>`'${id}'::uuid`).join(',')
      });`
    );
  }
  if(orgIds.length){
    statements.push(
      `delete from public.bf_organizations where id in (${
        orgIds.map(id=>`'${id}'::uuid`).join(',')
      });`
    );
  }
  if(userIds.length){
    statements.push(
      `delete from auth.users where id in (${
        userIds.map(id=>`'${id}'::uuid`).join(',')
      });`
    );
  }
  if(!statements.length) return;
  const result = spawnSync('docker', [
    'exec', `supabase_db_${projectId}`,
    'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
    '-c', statements.join(' ')
  ], {cwd:root, encoding:'utf8'});
  if(result.status!==0){
    console.warn('Nettoyage du labo incomplet:', (result.stderr || '').trim());
  }
}

try{
  const owner = await createUser('owner');
  const concierge = await createUser('concierge');
  const manager = await createUser('manager');
  const outsider = await createUser('outsider');
  const preparedOwner = await createUser('prepared-owner');

  const provisioningKey='prepared-owner-'+crypto.randomUUID().slice(0, 12);
  const provisioned = await request(
    '/rest/v1/rpc/bf_operator_provision_organization',
    {
      method:'POST',
      token:serviceRoleKey,
      apiKey:serviceRoleKey,
      body:{
        p_provisioning_key:provisioningKey,
        p_owner_user_id:preparedOwner.id,
        p_owner_email:preparedOwner.email,
        p_name:'Espace propriétaire préparé',
        p_display_name:'Propriétaire préparé'
      }
    }
  );
  assert.equal(provisioned.data?.[0]?.created, true);
  assert.match(provisioned.data?.[0]?.org_id || '', /^[0-9a-f-]{36}$/);
  const preparedOrg=provisioned.data[0].org_id;
  organizations.push(preparedOrg);

  const replayedProvision = await request(
    '/rest/v1/rpc/bf_operator_provision_organization',
    {
      method:'POST',
      token:serviceRoleKey,
      apiKey:serviceRoleKey,
      body:{
        p_provisioning_key:provisioningKey,
        p_owner_user_id:preparedOwner.id,
        p_owner_email:preparedOwner.email,
        p_name:'Espace propriétaire préparé',
        p_display_name:'Propriétaire préparé'
      }
    }
  );
  assert.deepEqual(replayedProvision.data, [{
    org_id:preparedOrg,
    created:false
  }]);

  const preparedOrganizations = await rpc(
    'bf_list_my_organizations',
    preparedOwner.token
  );
  assert.deepEqual(
    preparedOrganizations.data.map(item=>item.org_id),
    [preparedOrg]
  );
  const forbiddenProvision = await request(
    '/rest/v1/rpc/bf_operator_provision_organization',
    {
      method:'POST',
      token:preparedOwner.token,
      body:{
        p_provisioning_key:'forbidden-'+crypto.randomUUID().slice(0, 12),
        p_owner_user_id:preparedOwner.id,
        p_owner_email:preparedOwner.email,
        p_name:'Interdit'
      },
      allowError:true
    }
  );
  assert.ok(forbiddenProvision.response.status>=400);

  const ownerOrg = await createOrganization(owner, 'Maison Atlas');
  const forbiddenSelfService = await request(
    '/rest/v1/rpc/bf_create_organization',
    {
      method:'POST',
      token:owner.token,
      body:{p_name:'Espace non autorisé'},
      allowError:true
    }
  );
  assert.ok(forbiddenSelfService.response.status>=400);
  await insertRows('bf_properties', owner.token, [
    {
      org_id:ownerOrg,
      id:'visible',
      name:'Appartement visible',
      doc:{id:'visible', name:'Appartement visible'}
    },
    {
      org_id:ownerOrg,
      id:'private',
      name:'Maison privée',
      doc:{id:'private', name:'Maison privée'}
    }
  ]);
  const ownerProof=`${ownerOrg}/visible/${owner.id}/${crypto.randomUUID()}.jpg`;
  const ownerUpload=await uploadProof(owner.token, ownerProof);
  assert.equal(ownerUpload.status, 200, await ownerUpload.text());
  const ownerSignature=await signProof(owner.token, ownerProof);
  assert.equal(ownerSignature.status, 200, await ownerSignature.text());
  const wrongOwnerSegment=`${ownerOrg}/visible/${outsider.id}/${crypto.randomUUID()}.jpg`;
  assert.ok(!(await uploadProof(owner.token, wrongOwnerSegment)).ok);
  const outsiderWrite=`${ownerOrg}/visible/${outsider.id}/${crypto.randomUUID()}.jpg`;
  assert.ok(!(await uploadProof(outsider.token, outsiderWrite)).ok);
  assert.ok(!(await signProof(outsider.token, ownerProof)).ok);
  await insertRows('bf_reservations', owner.token, [
    {
      org_id:ownerOrg,
      id:'reservation-visible',
      property_id:'visible',
      doc:{id:'reservation-visible', aptId:'visible', guest:'Voyageur A'}
    },
    {
      org_id:ownerOrg,
      id:'reservation-private',
      property_id:'private',
      doc:{id:'reservation-private', aptId:'private', guest:'Voyageur B'}
    }
  ]);

  const importedSnapshot = {
    organization:{name:'Source historique ignorée'},
    apartments:[
      {id:'visible', name:'Appartement visible importé', active:true},
      {id:'private', name:'Maison privée', active:true}
    ],
    reservations:[
      {
        id:'reservation-visible',
        aptId:'visible',
        guest:'Voyageur A',
        status:'Confirmé'
      },
      {
        id:'reservation-private',
        aptId:'private',
        guest:'Voyageur B',
        status:'Confirmé'
      }
    ],
    interventions:[
      {
        id:'operation-imported',
        aptId:'visible',
        type:'Ménage',
        planned:false
      }
    ],
    contacts:[
      {id:'contact-imported', aptId:'visible', name:'Prestataire'}
    ]
  };
  const replacement = await rpc('bf_replace_snapshot', owner.token, {
    p_org_id:ownerOrg,
    p_snapshot:importedSnapshot,
    p_metadata:{source:'integration-test'}
  });
  assert.deepEqual({
    apartments:replacement.data.apartments,
    reservations:replacement.data.reservations,
    interventions:replacement.data.interventions,
    contacts:replacement.data.contacts
  }, {
    apartments:2,
    reservations:2,
    interventions:1,
    contacts:1
  });
  assert.match(replacement.data.recoveryId || '', /^[0-9a-f-]{36}$/);
  const recoveryId=replacement.data.recoveryId;

  const recoveryRows = await request(
    `/rest/v1/bf_snapshots?org_id=eq.${ownerOrg}&select=id,counts`,
    {token:owner.token}
  );
  assert.equal(recoveryRows.data.length, 1);
  assert.equal(recoveryRows.data[0].id, recoveryId);

  const invalidReplacement = await request('/rest/v1/rpc/bf_replace_snapshot', {
    method:'POST',
    token:owner.token,
    body:{
      p_org_id:ownerOrg,
      p_snapshot:{
        apartments:[],
        reservations:[{id:'invalid', aptId:'missing'}],
        interventions:[],
        contacts:[]
      },
      p_metadata:{source:'invalid-test'}
    },
    allowError:true
  });
  assert.ok(invalidReplacement.response.status>=400);
  const propertiesAfterFailure = await request(
    `/rest/v1/bf_properties?org_id=eq.${ownerOrg}&select=id&order=id`,
    {token:owner.token}
  );
  assert.deepEqual(ids(propertiesAfterFailure.data), ['private', 'visible']);

  await rpc('bf_restore_snapshot', owner.token, {
    p_org_id:ownerOrg,
    p_snapshot_id:recoveryId
  });
  const restoredProperty = await request(
    `/rest/v1/bf_properties?org_id=eq.${ownerOrg}&id=eq.visible&select=name`,
    {token:owner.token}
  );
  assert.equal(restoredProperty.data[0].name, 'Appartement visible');
  await rpc('bf_replace_snapshot', owner.token, {
    p_org_id:ownerOrg,
    p_snapshot:importedSnapshot,
    p_metadata:{source:'integration-test-after-restore'}
  });

  await rpc('bf_invite_member', owner.token, {
    p_org_id:ownerOrg,
    p_email:concierge.email,
    p_display_name:'Conciergerie Test',
    p_role:'concierge',
    p_property_ids:['visible']
  });
  await rpc('bf_invite_member', owner.token, {
    p_org_id:ownerOrg,
    p_email:manager.email,
    p_display_name:'Manager Test',
    p_role:'manager',
    p_property_ids:['visible']
  });

  const acceptedConcierge = await rpc('bf_accept_invitations', concierge.token);
  assert.deepEqual(acceptedConcierge.data.map(item=>item.org_id), [ownerOrg]);

  const conciergeProperties = await request(
    '/rest/v1/bf_properties?select=id,name&order=id',
    {token:concierge.token}
  );
  assert.deepEqual(ids(conciergeProperties.data), ['visible']);

  const conciergeProof=`${ownerOrg}/visible/${concierge.id}/${crypto.randomUUID()}.jpg`;
  const conciergeUpload=await uploadProof(concierge.token, conciergeProof);
  assert.equal(conciergeUpload.status, 200, await conciergeUpload.text());
  const conciergeSignature=await signProof(concierge.token, ownerProof);
  assert.equal(conciergeSignature.status, 200, await conciergeSignature.text());
  const forbiddenConciergeProof=`${ownerOrg}/private/${concierge.id}/${crypto.randomUUID()}.jpg`;
  assert.ok(!(await uploadProof(concierge.token, forbiddenConciergeProof)).ok);

  const conciergeReservations = await request(
    '/rest/v1/bf_reservations?select=id,property_id&order=id',
    {token:concierge.token}
  );
  assert.deepEqual(ids(conciergeReservations.data), ['reservation-visible']);

  const conciergeMembers = await request(
    `/rest/v1/bf_members?org_id=eq.${ownerOrg}&select=email,role`,
    {token:concierge.token}
  );
  assert.deepEqual(
    conciergeMembers.data.map(item=>item.email),
    [concierge.email]
  );
  const conciergeRecoveries = await request(
    `/rest/v1/bf_snapshots?org_id=eq.${ownerOrg}&select=id`,
    {token:concierge.token}
  );
  assert.deepEqual(conciergeRecoveries.data, []);

  await insertRows('bf_operations', concierge.token, [{
    org_id:ownerOrg,
    id:'operation-visible',
    property_id:'visible',
    kind:'cleaning',
    status:'done',
    doc:{id:'operation-visible', aptId:'visible', label:'Ménage terminé'}
  }]);

  const forbiddenOperation = await request('/rest/v1/bf_operations', {
    method:'POST',
    token:concierge.token,
    body:[{
      org_id:ownerOrg,
      id:'operation-private',
      property_id:'private',
      kind:'cleaning',
      status:'done',
      doc:{id:'operation-private', aptId:'private'}
    }],
    allowError:true
  });
  assert.ok(forbiddenOperation.response.status>=400);

  const forbiddenReservation = await request('/rest/v1/bf_reservations', {
    method:'POST',
    token:concierge.token,
    body:[{
      org_id:ownerOrg,
      id:'reservation-forbidden',
      property_id:'visible',
      doc:{id:'reservation-forbidden', aptId:'visible'}
    }],
    allowError:true
  });
  assert.ok(forbiddenReservation.response.status>=400);

  const forbiddenReplacement = await request('/rest/v1/rpc/bf_replace_snapshot', {
    method:'POST',
    token:concierge.token,
    body:{
      p_org_id:ownerOrg,
      p_snapshot:{
        apartments:[],
        reservations:[],
        interventions:[],
        contacts:[]
      },
      p_metadata:{source:'forbidden-test'}
    },
    allowError:true
  });
  assert.ok(forbiddenReplacement.response.status>=400);
  assert.match(forbiddenReplacement.text, /forbidden/);
  const forbiddenRestore = await request('/rest/v1/rpc/bf_restore_snapshot', {
    method:'POST',
    token:concierge.token,
    body:{p_org_id:ownerOrg, p_snapshot_id:recoveryId},
    allowError:true
  });
  assert.ok(forbiddenRestore.response.status>=400);
  assert.match(forbiddenRestore.text, /forbidden/);

  await rpc('bf_accept_invitations', manager.token);
  const escalation = await request('/rest/v1/rpc/bf_invite_member', {
    method:'POST',
    token:manager.token,
    body:{
      p_org_id:ownerOrg,
      p_email:`rogue.${Date.now()}@best-friend.test`,
      p_display_name:'Rogue Admin',
      p_role:'admin',
      p_property_ids:[]
    },
    allowError:true
  });
  assert.ok(escalation.response.status>=400);
  assert.match(escalation.text, /only_owner_can_manage_privileged_roles/);

  const outsiderOrg = await createOrganization(outsider, 'Autre Propriétaire');
  await insertRows('bf_properties', outsider.token, [
    {
      org_id:outsiderOrg,
      id:'other-visible',
      name:'Bien du second propriétaire',
      doc:{id:'other-visible', name:'Bien du second propriétaire'}
    },
    {
      org_id:outsiderOrg,
      id:'other-private',
      name:'Bien tiers non assigné',
      doc:{id:'other-private', name:'Bien tiers non assigné'}
    }
  ]);

  await rpc('bf_invite_member', outsider.token, {
    p_org_id:outsiderOrg,
    p_email:concierge.email,
    p_display_name:'Conciergerie partagée',
    p_role:'concierge',
    p_property_ids:['other-visible']
  });
  const acceptedSecondOrganization = await rpc(
    'bf_accept_invitations',
    concierge.token
  );
  assert.deepEqual(
    acceptedSecondOrganization.data.map(item=>item.org_id).sort(),
    [ownerOrg, outsiderOrg].sort()
  );

  const conciergeOrganizations = await rpc(
    'bf_list_my_organizations',
    concierge.token
  );
  assert.deepEqual(
    conciergeOrganizations.data.map(item=>item.org_id).sort(),
    [ownerOrg, outsiderOrg].sort()
  );
  const conciergeOwnerProperties = await request(
    `/rest/v1/bf_properties?org_id=eq.${ownerOrg}&select=id&order=id`,
    {token:concierge.token}
  );
  assert.deepEqual(ids(conciergeOwnerProperties.data), ['visible']);
  const conciergeOtherProperties = await request(
    `/rest/v1/bf_properties?org_id=eq.${outsiderOrg}&select=id&order=id`,
    {token:concierge.token}
  );
  assert.deepEqual(ids(conciergeOtherProperties.data), ['other-visible']);
  const conciergeAllProperties = await request(
    '/rest/v1/bf_properties?select=id&order=id',
    {token:concierge.token}
  );
  assert.deepEqual(
    ids(conciergeAllProperties.data),
    ['other-visible', 'visible']
  );

  const leakedProperties = await request(
    `/rest/v1/bf_properties?org_id=eq.${ownerOrg}&select=id`,
    {token:outsider.token}
  );
  assert.deepEqual(leakedProperties.data, []);

  const outsiderOrganizations = await rpc(
    'bf_list_my_organizations',
    outsider.token
  );
  assert.deepEqual(
    outsiderOrganizations.data.map(item=>item.org_id),
    [outsiderOrg]
  );

  const ownerProperties = await request(
    `/rest/v1/bf_properties?org_id=eq.${ownerOrg}&select=id&order=id`,
    {token:owner.token}
  );
  assert.deepEqual(ids(ownerProperties.data), ['private', 'visible']);

  console.log('OK: Auth, API, restauration atomique, hiérarchie et isolation Supabase réelles validées');
}finally{
  await cleanup();
}

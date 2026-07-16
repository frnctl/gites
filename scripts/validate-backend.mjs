import {createClient} from '@supabase/supabase-js';

const env=process.env;
const confirmation=env.BF_BACKEND_VALIDATE;
const environment=(env.BF_BACKEND_ENVIRONMENT||'').trim().toLowerCase();
const expectedRef=(env.BF_EXPECTED_PROJECT_REF||'').trim().toLowerCase();
const backendUrl=(env.BF_SUPABASE_URL||'').trim().replace(/\/$/, '');
const anonKey=(env.BF_SUPABASE_ANON_KEY||'').trim();
const serviceRoleKey=(env.BF_SUPABASE_SERVICE_ROLE_KEY||'').trim();
const siteUrl=(env.BF_SITE_URL||'https://best-friend-app.pages.dev')
  .trim()
  .replace(/\/$/, '');
const allowLocal=env.BF_BACKEND_ALLOW_LOCAL==='YES';
const runId=(
  'bf-recipe-'+new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  +'-'+crypto.randomUUID().slice(0, 8)
).toLowerCase();
const provisioningKey=runId;
const emails={
  owner:runId+'-owner@best-friend.test',
  concierge:runId+'-concierge@best-friend.test',
  outsider:runId+'-outsider@best-friend.test'
};

let stage='preflight';
let service=null;
const userIds=[];
const organizationIds=new Set();

function fail(message){
  throw new Error(message);
}

function ensure(condition, message){
  if(!condition) fail(message);
}

function parseUrl(value, label, {localAllowed=false}={}){
  let parsed;
  try{ parsed=new URL(value); }
  catch{ fail(label+' invalide.'); }
  const local=localAllowed && ['127.0.0.1','localhost'].includes(parsed.hostname);
  if(parsed.protocol!=='https:' && !(local && parsed.protocol==='http:')){
    fail(label+' doit utiliser HTTPS.');
  }
  if(
    parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !['','/'].includes(parsed.pathname)
  ){
    fail(label+' doit être une origine sans identifiants ni paramètres.');
  }
  return parsed;
}

function targetGuard({executing=false}={}){
  ensure(
    ['validation','local'].includes(environment),
    'BF_BACKEND_ENVIRONMENT doit valoir validation ou local.'
  );
  ensure(expectedRef, 'BF_EXPECTED_PROJECT_REF absent.');
  const backend=parseUrl(
    backendUrl,
    'BF_SUPABASE_URL',
    {localAllowed:allowLocal}
  );
  parseUrl(siteUrl, 'BF_SITE_URL', {localAllowed:allowLocal});

  const local=['127.0.0.1','localhost'].includes(backend.hostname);
  if(local){
    ensure(environment==='local', 'Une URL locale exige l’environnement local.');
    ensure(allowLocal, 'BF_BACKEND_ALLOW_LOCAL=YES requis pour le labo.');
    ensure(expectedRef==='local', 'Le labo exige BF_EXPECTED_PROJECT_REF=local.');
  }else{
    ensure(environment==='validation', 'Une cible distante doit être validation.');
    ensure(
      backend.hostname===expectedRef+'.supabase.co',
      'La référence attendue ne correspond pas à BF_SUPABASE_URL.'
    );
    ensure(
      /^[a-z0-9]{8,40}$/.test(expectedRef),
      'BF_EXPECTED_PROJECT_REF invalide.'
    );
  }

  if(executing){
    ensure(anonKey, 'BF_SUPABASE_ANON_KEY absente.');
    ensure(serviceRoleKey, 'BF_SUPABASE_SERVICE_ROLE_KEY absente.');
  }
  return {local, host:backend.hostname};
}

function timedFetch(input, init={}){
  const timeout=AbortSignal.timeout(20_000);
  const signal=init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, {...init, signal});
}

function supabase(key){
  return createClient(backendUrl, key, {
    auth:{
      persistSession:false,
      autoRefreshToken:false,
      detectSessionInUrl:false
    },
    global:{fetch:timedFetch}
  });
}

function errorText(error){
  if(!error) return 'erreur inconnue';
  return [
    error.message,
    error.code,
    error.details,
    error.hint
  ].filter(Boolean).join(' — ') || String(error);
}

function unwrap(result, label){
  if(result.error) fail(label+' : '+errorText(result.error));
  return result.data;
}

function password(){
  return crypto.randomUUID()+'-Aa9!'+crypto.randomUUID().slice(0, 8);
}

async function createRecipeUser(label){
  stage='création du compte '+label;
  const credentials={email:emails[label], password:password()};
  const data=unwrap(
    await service.auth.admin.createUser({
      email:credentials.email,
      password:credentials.password,
      email_confirm:true,
      user_metadata:{source:'best-friend-hosted-recipe', run_id:runId}
    }),
    'Création Auth '+label
  );
  ensure(data?.user?.id, 'Identifiant Auth absent pour '+label+'.');
  userIds.push(data.user.id);
  return {...credentials, id:data.user.id};
}

async function authenticatedClient(credentials){
  const client=supabase(anonKey);
  const data=unwrap(
    await client.auth.signInWithPassword({
      email:credentials.email,
      password:credentials.password
    }),
    'Connexion '+credentials.email.split('@')[0]
  );
  ensure(data?.session?.access_token, 'Session Auth absente.');
  return client;
}

function sortedIds(rows){
  return (rows||[]).map(row=>row.id).sort();
}

async function validateBackend(){
  service=supabase(serviceRoleKey);
  const checks=[];

  const ownerAccount=await createRecipeUser('owner');
  const conciergeAccount=await createRecipeUser('concierge');
  const outsiderAccount=await createRecipeUser('outsider');

  stage='génération du lien magique';
  const magic=unwrap(
    await service.auth.admin.generateLink({
      type:'magiclink',
      email:ownerAccount.email,
      options:{redirectTo:siteUrl}
    }),
    'Génération du lien magique'
  );
  ensure(
    magic?.properties?.action_link || magic?.properties?.hashed_token,
    'Lien magique de recette absent.'
  );
  checks.push('auth-admin-et-lien-magique');

  stage='provisionnement propriétaire';
  const provisioned=unwrap(
    await service.rpc('bf_operator_provision_organization', {
      p_provisioning_key:provisioningKey,
      p_owner_user_id:ownerAccount.id,
      p_owner_email:ownerAccount.email,
      p_name:'Recette hébergée '+runId.slice(-8),
      p_display_name:'Propriétaire Recette',
      p_brand_name:'Best Friend',
      p_owner_label:'Propriétaire'
    }),
    'Provisionnement opérateur'
  )?.[0];
  ensure(provisioned?.created===true, 'Organisation de recette non créée.');
  ensure(provisioned?.org_id, 'Identifiant organisation absent.');
  const ownerOrg=provisioned.org_id;
  organizationIds.add(ownerOrg);

  const replayed=unwrap(
    await service.rpc('bf_operator_provision_organization', {
      p_provisioning_key:provisioningKey,
      p_owner_user_id:ownerAccount.id,
      p_owner_email:ownerAccount.email,
      p_name:'Recette hébergée '+runId.slice(-8),
      p_display_name:'Propriétaire Recette',
      p_brand_name:'Best Friend',
      p_owner_label:'Propriétaire'
    }),
    'Rejeu du provisionnement'
  )?.[0];
  ensure(
    replayed?.org_id===ownerOrg && replayed?.created===false,
    'Le provisionnement opérateur n’est pas idempotent.'
  );
  checks.push('provisionnement-idempotent');

  const owner=await authenticatedClient(ownerAccount);
  const concierge=await authenticatedClient(conciergeAccount);
  const outsider=await authenticatedClient(outsiderAccount);

  stage='contrôle des privilèges opérateur';
  const forbiddenOperator=await owner.rpc(
    'bf_operator_provision_organization',
    {
      p_provisioning_key:runId+'-forbidden',
      p_owner_user_id:ownerAccount.id,
      p_owner_email:ownerAccount.email,
      p_name:'Interdit'
    }
  );
  ensure(
    Boolean(forbiddenOperator.error),
    'Un utilisateur métier peut appeler le provisionnement opérateur.'
  );
  checks.push('service-role-seul');

  stage='données du propriétaire';
  unwrap(
    await owner.from('bf_properties').insert([
      {
        org_id:ownerOrg,
        id:'recipe-visible',
        name:'Bien affecté',
        doc:{id:'recipe-visible', name:'Bien affecté'}
      },
      {
        org_id:ownerOrg,
        id:'recipe-private',
        name:'Bien privé',
        doc:{id:'recipe-private', name:'Bien privé'}
      }
    ]),
    'Création des biens'
  );
  unwrap(
    await owner.from('bf_reservations').insert([
      {
        org_id:ownerOrg,
        id:'recipe-booking-visible',
        property_id:'recipe-visible',
        doc:{
          id:'recipe-booking-visible',
          aptId:'recipe-visible',
          guest:'Voyageur Recette'
        }
      },
      {
        org_id:ownerOrg,
        id:'recipe-booking-private',
        property_id:'recipe-private',
        doc:{
          id:'recipe-booking-private',
          aptId:'recipe-private',
          guest:'Voyageur Privé'
        }
      }
    ]),
    'Création des réservations'
  );

  stage='invitation et RLS concierge';
  unwrap(
    await owner.rpc('bf_invite_member', {
      p_org_id:ownerOrg,
      p_email:conciergeAccount.email,
      p_display_name:'Conciergerie Recette',
      p_role:'concierge',
      p_property_ids:['recipe-visible']
    }),
    'Invitation concierge'
  );
  unwrap(
    await concierge.rpc('bf_accept_invitations'),
    'Acceptation concierge'
  );
  const conciergeProperties=unwrap(
    await concierge.from('bf_properties').select('id').eq('org_id', ownerOrg),
    'Lecture des biens concierge'
  );
  ensure(
    JSON.stringify(sortedIds(conciergeProperties))===JSON.stringify(['recipe-visible']),
    'La concierge voit un bien non affecté ou perd son bien.'
  );
  const conciergeBookings=unwrap(
    await concierge.from('bf_reservations').select('id').eq('org_id', ownerOrg),
    'Lecture des réservations concierge'
  );
  ensure(
    JSON.stringify(sortedIds(conciergeBookings))
      ===JSON.stringify(['recipe-booking-visible']),
    'La concierge voit une réservation privée.'
  );
  unwrap(
    await concierge.from('bf_operations').insert({
      org_id:ownerOrg,
      id:'recipe-operation-visible',
      property_id:'recipe-visible',
      kind:'cleaning',
      status:'done',
      doc:{id:'recipe-operation-visible', aptId:'recipe-visible'}
    }),
    'Écriture opération concierge'
  );
  const forbiddenOperation=await concierge.from('bf_operations').insert({
    org_id:ownerOrg,
    id:'recipe-operation-private',
    property_id:'recipe-private',
    kind:'cleaning',
    status:'done',
    doc:{id:'recipe-operation-private', aptId:'recipe-private'}
  });
  ensure(
    Boolean(forbiddenOperation.error),
    'La concierge écrit sur un bien non affecté.'
  );
  checks.push('rls-concierge-par-bien');

  stage='restauration transactionnelle';
  const replacement=unwrap(
    await owner.rpc('bf_replace_snapshot', {
      p_org_id:ownerOrg,
      p_snapshot:{
        apartments:[
          {id:'recipe-visible', name:'Bien affecté importé', active:true},
          {id:'recipe-imported', name:'Bien importé', active:true}
        ],
        reservations:[
          {
            id:'recipe-booking-visible',
            aptId:'recipe-visible',
            guest:'Voyageur Recette',
            status:'Confirmé'
          }
        ],
        interventions:[],
        contacts:[]
      },
      p_metadata:{source:'hosted-validation-recipe', runId}
    }),
    'Remplacement transactionnel'
  );
  ensure(replacement?.recoveryId, 'Instantané de récupération absent.');
  unwrap(
    await owner.rpc('bf_restore_snapshot', {
      p_org_id:ownerOrg,
      p_snapshot_id:replacement.recoveryId
    }),
    'Restauration de l’instantané'
  );
  const restored=unwrap(
    await owner.from('bf_properties').select('id').eq('org_id', ownerOrg),
    'Contrôle après restauration'
  );
  ensure(
    JSON.stringify(sortedIds(restored))
      ===JSON.stringify(['recipe-private','recipe-visible']),
    'La restauration ne restitue pas l’état initial.'
  );
  checks.push('remplacement-et-retour-arrière');

  stage='second propriétaire et multi-organisations';
  const forbiddenSelfService=await outsider.rpc('bf_create_organization', {
    p_name:'Espace non autorisé'
  });
  ensure(
    Boolean(forbiddenSelfService.error),
    'Un utilisateur peut créer librement une organisation.'
  );
  const outsiderProvisioned=unwrap(
    await service.rpc('bf_operator_provision_organization', {
      p_provisioning_key:runId+'-outsider',
      p_owner_user_id:outsiderAccount.id,
      p_owner_email:outsiderAccount.email,
      p_name:'Autre recette '+runId.slice(-8),
      p_display_name:'Propriétaire Tiers',
      p_brand_name:'Best Friend',
      p_owner_label:'Propriétaire'
    }),
    'Provisionnement du second propriétaire'
  )?.[0];
  const outsiderOrg=outsiderProvisioned?.org_id;
  ensure(outsiderOrg, 'Organisation du second propriétaire absente.');
  organizationIds.add(outsiderOrg);
  unwrap(
    await outsider.from('bf_properties').insert({
      org_id:outsiderOrg,
      id:'recipe-other-visible',
      name:'Bien autre propriétaire',
      doc:{id:'recipe-other-visible', name:'Bien autre propriétaire'}
    }),
    'Création du bien tiers'
  );
  const outsiderLeak=unwrap(
    await outsider.from('bf_properties').select('id').eq('org_id', ownerOrg),
    'Contrôle isolation tiers'
  );
  ensure(outsiderLeak.length===0, 'Le second propriétaire voit le premier.');

  unwrap(
    await outsider.rpc('bf_invite_member', {
      p_org_id:outsiderOrg,
      p_email:conciergeAccount.email,
      p_display_name:'Conciergerie partagée',
      p_role:'concierge',
      p_property_ids:['recipe-other-visible']
    }),
    'Invitation concierge au second espace'
  );
  unwrap(
    await concierge.rpc('bf_accept_invitations'),
    'Acceptation du second espace'
  );
  const conciergeOrganizations=unwrap(
    await concierge.rpc('bf_list_my_organizations'),
    'Liste multi-organisations'
  );
  ensure(
    conciergeOrganizations.length===2,
    'La conciergerie partagée ne voit pas exactement deux espaces.'
  );
  const scopedOwner=unwrap(
    await concierge.from('bf_properties').select('id').eq('org_id', ownerOrg),
    'Lecture premier espace'
  );
  const scopedOutsider=unwrap(
    await concierge.from('bf_properties').select('id').eq('org_id', outsiderOrg),
    'Lecture second espace'
  );
  ensure(
    JSON.stringify(sortedIds(scopedOwner))===JSON.stringify(['recipe-visible'])
      && JSON.stringify(sortedIds(scopedOutsider))
        ===JSON.stringify(['recipe-other-visible']),
    'Les espaces de la conciergerie partagée se mélangent.'
  );
  checks.push('isolation-deux-proprietaires');

  return checks;
}

async function cleanup(){
  if(!service) return [];
  stage='nettoyage';
  const errors=[];
  try{
    if(userIds.length){
      const createdOrganizations=await service
        .from('bf_organizations')
        .select('id')
        .in('created_by', userIds);
      if(createdOrganizations.error){
        errors.push('inventaire organisations: '+errorText(createdOrganizations.error));
      }else{
        for(const item of createdOrganizations.data||[]){
          organizationIds.add(item.id);
        }
      }
    }
    const byKey=await service
      .from('bf_organizations')
      .select('id')
      .eq('provisioning_key', provisioningKey);
    if(byKey.error){
      errors.push('inventaire clé: '+errorText(byKey.error));
    }else{
      for(const item of byKey.data||[]) organizationIds.add(item.id);
    }
    if(organizationIds.size){
      const removed=await service
        .from('bf_organizations')
        .delete()
        .in('id', [...organizationIds]);
      if(removed.error) errors.push('organisations: '+errorText(removed.error));
    }
  }catch(error){
    errors.push('organisations: '+errorText(error));
  }

  for(const userId of [...userIds].reverse()){
    try{
      const removed=await service.auth.admin.deleteUser(userId);
      if(removed.error) errors.push('compte recette: '+errorText(removed.error));
    }catch(error){
      errors.push('compte recette: '+errorText(error));
    }
  }
  return errors;
}

function sanitize(message){
  let safe=String(message||'erreur inconnue');
  for(const secret of [serviceRoleKey, anonKey]){
    if(secret) safe=safe.replaceAll(secret, '[secret]');
  }
  return safe.slice(0, 600);
}

async function main(){
  const executing=confirmation==='RUN';
  const target=targetGuard({executing});
  if(!executing){
    console.log(JSON.stringify({
      dryRun:true,
      target:{
        environment,
        expectedRef,
        host:target.host,
        local:target.local
      },
      checks:[
        'Auth Admin, session et génération de lien magique',
        'provisionnement opérateur idempotent et non accessible aux métiers',
        'RLS concierge par bien et isolation entre propriétaires',
        'remplacement transactionnel et retour arrière',
        'conciergerie partagée entre deux espaces',
        'suppression finale des organisations et comptes de recette'
      ],
      confirmation:'Définir BF_BACKEND_VALIDATE=RUN pour créer des données jetables.'
    },null,2));
    return;
  }

  let checks=[];
  let failure=null;
  let failureStage=null;
  try{
    checks=await validateBackend();
  }catch(error){
    failure=error;
    failureStage=stage;
  }
  const cleanupErrors=await cleanup();

  if(failure || cleanupErrors.length){
    console.error(JSON.stringify({
      validated:false,
      target:expectedRef,
      failedStage:failureStage || stage,
      error:failure?sanitize(errorText(failure)):null,
      cleanup:cleanupErrors.length
        ? cleanupErrors.map(sanitize)
        : 'complete'
    },null,2));
    process.exitCode=1;
    return;
  }

  console.log(JSON.stringify({
    validated:true,
    target:expectedRef,
    checks,
    cleanup:'complete',
    realDataUsed:false
  },null,2));
}

main().catch(error=>{
  console.error('Validation backend impossible : '+sanitize(errorText(error)));
  process.exitCode=1;
});

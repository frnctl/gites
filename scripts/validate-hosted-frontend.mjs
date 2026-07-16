import {chromium} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';

const env=process.env;
const executing=env.BF_FRONTEND_VALIDATE==='RUN';
const environment=(env.BF_BACKEND_ENVIRONMENT||'').trim().toLowerCase();
const expectedRef=(env.BF_EXPECTED_PROJECT_REF||'').trim().toLowerCase();
const backendUrl=(env.BF_SUPABASE_URL||'').trim().replace(/\/$/, '');
const anonKey=(env.BF_SUPABASE_ANON_KEY||'').trim();
const serviceRoleKey=(env.BF_SUPABASE_SERVICE_ROLE_KEY||'').trim();
const siteUrl=(env.BF_SITE_URL||'https://best-friend-app.pages.dev')
  .trim()
  .replace(/\/$/, '');
const allowedSiteOrigin='https://best-friend-app.pages.dev';
const expectedFrontendEnvironment=(env.BF_EXPECTED_FRONTEND_ENVIRONMENT||'production').trim();
const runId=(
  'bf-ui-'+new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  +'-'+crypto.randomUUID().slice(0, 8)
).toLowerCase();
const email=runId+'@best-friend.test';
const provisioningKey=runId;
const organizationName='Recette navigateur '+runId.slice(-8);
const propertyName='Bien navigateur '+runId.slice(-8);

let stage='préflight';
let service=null;
let browser=null;
let userId=null;
let organizationId=null;
let actionLink='';

function fail(message){
  throw new Error(message);
}

function ensure(condition, message){
  if(!condition) fail(message);
}

function parseOrigin(value, label){
  let parsed;
  try{ parsed=new URL(value); }
  catch{ fail(label+' invalide.'); }
  if(
    parsed.protocol!=='https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !['','/'].includes(parsed.pathname)
  ){
    fail(label+' doit être une origine HTTPS sans paramètres.');
  }
  return parsed;
}

function validateTarget(){
  ensure(environment==='validation', 'La recette navigateur exige validation.');
  ensure(expectedRef, 'BF_EXPECTED_PROJECT_REF absent.');
  const backend=parseOrigin(backendUrl, 'BF_SUPABASE_URL');
  const site=parseOrigin(siteUrl, 'BF_SITE_URL');
  ensure(
    backend.hostname===expectedRef+'.supabase.co',
    'La référence attendue ne correspond pas au backend.'
  );
  ensure(
    /^[a-z0-9]{8,40}$/.test(expectedRef),
    'BF_EXPECTED_PROJECT_REF invalide.'
  );
  ensure(
    site.origin===allowedSiteOrigin,
    'La recette navigateur refuse toute cible autre que la preview dédiée.'
  );
  if(executing){
    ensure(anonKey, 'BF_SUPABASE_ANON_KEY absente.');
    ensure(serviceRoleKey, 'BF_SUPABASE_SERVICE_ROLE_KEY absente.');
  }
  return {backend:backend.origin, site:site.origin};
}

function client(key){
  return createClient(backendUrl, key, {
    auth:{
      persistSession:false,
      autoRefreshToken:false,
      detectSessionInUrl:false
    },
    global:{
      fetch:(input, init={})=>fetch(input, {
        ...init,
        signal:AbortSignal.timeout(20_000)
      })
    }
  });
}

function errorText(error){
  return [error?.message, error?.code, error?.details, error?.hint]
    .filter(Boolean)
    .join(' — ') || 'erreur inconnue';
}

function unwrap(result, label){
  if(result.error) fail(label+' : '+errorText(result.error));
  return result.data;
}

async function eventually(label, callback, timeout=20_000){
  const deadline=Date.now()+timeout;
  let lastError=null;
  while(Date.now()<deadline){
    try{
      const result=await callback();
      if(result) return result;
    }catch(error){
      lastError=error;
    }
    await new Promise(resolve=>setTimeout(resolve, 300));
  }
  if(lastError) fail(label+' : '+errorText(lastError));
  fail(label+' : délai dépassé.');
}

async function validateFrontend(){
  const checks=[];
  service=client(serviceRoleKey);

  stage='création du compte jetable';
  const account=unwrap(
    await service.auth.admin.createUser({
      email,
      password:crypto.randomUUID()+'-Aa9!'+crypto.randomUUID().slice(0, 8),
      email_confirm:true,
      user_metadata:{source:'best-friend-hosted-ui-recipe', run_id:runId}
    }),
    'Création Auth'
  );
  ensure(account?.user?.id, 'Identifiant Auth absent.');
  userId=account.user.id;

  stage='provisionnement jetable';
  const provisioned=unwrap(
    await service.rpc('bf_operator_provision_organization', {
      p_provisioning_key:provisioningKey,
      p_owner_user_id:userId,
      p_owner_email:email,
      p_name:organizationName,
      p_display_name:'Propriétaire Recette UI',
      p_brand_name:'Best Friend',
      p_owner_label:'Propriétaire'
    }),
    'Provisionnement opérateur'
  )?.[0];
  ensure(provisioned?.created===true && provisioned?.org_id, 'Organisation absente.');
  organizationId=provisioned.org_id;

  stage='génération du lien à usage unique';
  const magic=unwrap(
    await service.auth.admin.generateLink({
      type:'magiclink',
      email,
      options:{redirectTo:siteUrl+'/control'}
    }),
    'Génération du lien magique'
  );
  actionLink=magic?.properties?.action_link||'';
  ensure(actionLink, 'Lien magique absent.');

  stage='ouverture du navigateur';
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({
    baseURL:siteUrl,
    serviceWorkers:'block'
  });
  const page=await context.newPage();
  let pageError=false;
  page.on('pageerror', ()=>{ pageError=true; });
  await page.goto('/', {waitUntil:'domcontentloaded', timeout:30_000});
  await page.waitForFunction(()=>Boolean(window.BF_CONFIG), null, {timeout:15_000});
  const publicConfigMatches=await page.evaluate(
    ({url,key,environment})=>window.BF_CONFIG?.supabaseUrl===url
      && window.BF_CONFIG?.supabaseAnonKey===key
      && window.BF_CONFIG?.environment===environment,
    {url:backendUrl, key:anonKey, environment:expectedFrontendEnvironment}
  );
  ensure(publicConfigMatches, 'L’application ne cible pas le backend attendu.');
  checks.push('configuration-publique-attendue');

  stage='consommation du lien magique';
  const arrived=page.waitForURL(
    url=>url.origin===siteUrl && url.pathname==='/control',
    {timeout:30_000, waitUntil:'domcontentloaded'}
  );
  await page.evaluate(link=>{ window.location.assign(link); }, actionLink);
  await arrived;
  await page.waitForFunction(
    ()=>document.getElementById('syncDot')?.textContent?.trim()==='À jour',
    null,
    {timeout:30_000}
  );

  const visibleUrl=new URL(page.url());
  ensure(
    visibleUrl.origin===siteUrl && visibleUrl.pathname==='/control',
    'La redirection finale est incorrecte.'
  );
  ensure(
    !visibleUrl.hash
      && ![...visibleUrl.searchParams.keys()].some(key=>
        /^(access_token|refresh_token|token|code)$/i.test(key)
      ),
    'Un jeton Auth reste visible dans l’URL.'
  );
  await page.locator('#controlOverview').waitFor({state:'visible', timeout:20_000});
  ensure(
    (await page.locator('#roleBadge').textContent())?.includes('Propriétaire'),
    'Le rôle propriétaire n’est pas affiché.'
  );
  ensure(
    (await page.locator('#brandSub').textContent())?.includes(organizationName),
    'La bonne organisation n’est pas ouverte.'
  );
  checks.push('lien-magique-vers-control');

  stage='création d’un bien depuis l’interface';
  await page.locator('#aptAdd').click();
  await page.locator('#m_name').fill(propertyName);
  await page.locator('#m_ref').fill('UI-'+runId.slice(-8).toUpperCase());
  await page.locator('#m_address').fill('Adresse de validation');
  await page.locator('#modal button.primary').click();
  await page.locator('#biensList').getByText(propertyName).waitFor({timeout:10_000});

  await eventually('Persistance distante du bien', async()=>{
    const result=await service.from('bf_properties')
      .select('id,name')
      .eq('org_id', organizationId)
      .eq('name', propertyName);
    if(result.error) throw result.error;
    return result.data?.length===1 ? result.data[0] : null;
  });
  checks.push('ecriture-interface-vers-cloud');

  stage='rechargement depuis le cloud';
  await page.reload({waitUntil:'domcontentloaded', timeout:30_000});
  await page.waitForFunction(
    ()=>document.getElementById('syncDot')?.textContent?.trim()==='À jour',
    null,
    {timeout:30_000}
  );
  await page.locator('#biensList').getByText(propertyName).waitFor({timeout:15_000});
  await eventually('Compteur du centre de pilotage', async()=>
    (await page.locator('#controlProperties').textContent())?.trim()==='1'
  );
  checks.push('rechargement-et-compteur');

  stage='déconnexion et purge locale';
  await page.locator('#btnLogout').click();
  await page.locator('#authGate').waitFor({state:'visible', timeout:20_000});
  ensure(await page.locator('.loc-card').count()===0, 'Une donnée privée reste visible.');
  ensure(
    !(await page.locator('body').textContent())?.includes(propertyName),
    'Le nom du bien reste visible après déconnexion.'
  );
  const privateCacheCount=await page.evaluate(()=>{
    let count=0;
    for(let index=0; index<localStorage.length; index+=1){
      if(localStorage.key(index)?.startsWith('bestfriend_v4:')) count+=1;
    }
    return count;
  });
  ensure(privateCacheCount===0, 'Un cache métier privé reste après déconnexion.');
  ensure(!pageError, 'Une erreur JavaScript est survenue dans la preview.');
  checks.push('deconnexion-sans-donnee-privee');

  await context.close();
  return checks;
}

async function cleanup(){
  const errors=[];
  if(browser){
    try{ await browser.close(); }
    catch{ errors.push('navigateur'); }
    browser=null;
  }
  if(!service) return errors;

  try{
    const removed=await service.from('bf_organizations')
      .delete()
      .eq('provisioning_key', provisioningKey);
    if(removed.error) errors.push('organisation');
  }catch{
    errors.push('organisation');
  }

  if(userId){
    try{
      const removed=await service.auth.admin.deleteUser(userId);
      if(removed.error) errors.push('compte');
    }catch{
      errors.push('compte');
    }
  }

  try{
    const organizationCheck=await service.from('bf_organizations')
      .select('id', {count:'exact', head:true})
      .eq('provisioning_key', provisioningKey);
    if(organizationCheck.error || organizationCheck.count!==0){
      errors.push('vérification organisation');
    }
  }catch{
    errors.push('vérification organisation');
  }

  if(userId){
    try{
      const users=await service.auth.admin.listUsers({page:1, perPage:100});
      if(users.error || users.data.users.some(user=>user.id===userId)){
        errors.push('vérification compte');
      }
    }catch{
      errors.push('vérification compte');
    }
  }
  return [...new Set(errors)];
}

async function main(){
  const target=validateTarget();
  if(!executing){
    console.log(JSON.stringify({
      dryRun:true,
      target,
      would:[
        'créer puis provisionner un propriétaire jetable',
        'consommer un lien magique dans Chromium sur /control',
        'créer un bien via l’interface et vérifier sa persistance',
        'recharger, se déconnecter et contrôler la purge locale',
        'supprimer toutes les données de recette'
      ],
      confirmation:'Définir BF_FRONTEND_VALIDATE=RUN pour exécuter.'
    }, null, 2));
    return;
  }

  let checks=[];
  let failure=null;
  try{
    checks=await validateFrontend();
  }catch(error){
    failure=error;
  }
  const cleanupErrors=await cleanup();
  actionLink='';

  if(failure || cleanupErrors.length){
    console.error(JSON.stringify({
      validated:false,
      target:expectedRef,
      stage,
      cleanup:cleanupErrors.length ? 'incomplete' : 'complete',
      cleanupErrors
    }, null, 2));
    process.exitCode=1;
    return;
  }

  console.log(JSON.stringify({
    validated:true,
    target:expectedRef,
    checks,
    cleanup:'complete',
    realDataUsed:false
  }, null, 2));
}

main().catch(async()=>{
  const cleanupErrors=await cleanup();
  actionLink='';
  console.error(JSON.stringify({
    validated:false,
    target:expectedRef||'refusé',
    stage,
    cleanup:cleanupErrors.length ? 'incomplete' : 'complete'
  }, null, 2));
  process.exitCode=1;
});

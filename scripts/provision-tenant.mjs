import {createClient} from '@supabase/supabase-js';

const env=process.env;
const confirm=env.BF_TENANT_CONFIRM==='PROVISION';
const sendMagicLink=env.BF_TENANT_SEND_MAGIC_LINK==='YES';
const tenant={
  key:(env.BF_TENANT_KEY||'').trim().toLowerCase(),
  email:(env.BF_TENANT_OWNER_EMAIL||'').trim().toLowerCase(),
  name:(env.BF_TENANT_NAME||'').trim(),
  displayName:(env.BF_TENANT_OWNER_NAME||'').trim(),
  brandName:(env.BF_TENANT_BRAND_NAME||'Best Friend').trim(),
  ownerLabel:(env.BF_TENANT_OWNER_LABEL||'Propriétaire').trim()
};
const backend={
  url:(env.BF_SUPABASE_URL||'').trim().replace(/\/$/, ''),
  serviceRoleKey:(env.BF_SUPABASE_SERVICE_ROLE_KEY||'').trim(),
  anonKey:(env.BF_SUPABASE_ANON_KEY||'').trim()
};
const siteUrl=(env.BF_SITE_URL||'https://best-friend-app.pages.dev')
  .trim()
  .replace(/\/$/, '');

function fail(message){
  throw new Error(message);
}

function validateHttpUrl(value, label, {allowLocal=false}={}){
  let parsed;
  try{ parsed=new URL(value); }
  catch{ fail(label+' invalide.'); }
  const local=allowLocal && ['127.0.0.1','localhost'].includes(parsed.hostname);
  if(parsed.protocol!=='https:' && !(local && parsed.protocol==='http:')){
    fail(label+' doit utiliser HTTPS.');
  }
  if(parsed.username || parsed.password || parsed.search || parsed.hash){
    fail(label+' ne doit contenir ni identifiants ni paramètres.');
  }
  return parsed;
}

function validateInputs(){
  if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(tenant.key)){
    fail('BF_TENANT_KEY doit contenir 3 à 64 caractères sûrs.');
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tenant.email)){
    fail('BF_TENANT_OWNER_EMAIL invalide.');
  }
  if(tenant.name.length<2 || tenant.name.length>120){
    fail('BF_TENANT_NAME doit contenir 2 à 120 caractères.');
  }
  if(tenant.displayName.length>120){
    fail('BF_TENANT_OWNER_NAME dépasse 120 caractères.');
  }
  if(tenant.brandName.length<1 || tenant.brandName.length>120){
    fail('BF_TENANT_BRAND_NAME doit contenir 1 à 120 caractères.');
  }
  if(tenant.ownerLabel.length<1 || tenant.ownerLabel.length>80){
    fail('BF_TENANT_OWNER_LABEL doit contenir 1 à 80 caractères.');
  }
  validateHttpUrl(siteUrl, 'BF_SITE_URL', {allowLocal:true});
  if(confirm){
    if(!backend.url) fail('BF_SUPABASE_URL absent.');
    if(!backend.serviceRoleKey) fail('BF_SUPABASE_SERVICE_ROLE_KEY absent.');
    if(sendMagicLink && !backend.anonKey) fail('BF_SUPABASE_ANON_KEY absent.');
    validateHttpUrl(backend.url, 'BF_SUPABASE_URL', {allowLocal:true});
  }
}

function maskedEmail(email){
  const [local,domain]=email.split('@');
  return (local.slice(0, 1)||'*')+'***@'+domain;
}

function client(url, key){
  return createClient(url, key, {
    auth:{
      persistSession:false,
      autoRefreshToken:false,
      detectSessionInUrl:false
    }
  });
}

async function findUserByEmail(admin, email){
  const perPage=1000;
  for(let page=1; page<=1000; page+=1){
    const {data,error}=await admin.auth.admin.listUsers({page, perPage});
    if(error) throw error;
    const users=data?.users||[];
    const found=users.find(user=>user.email?.toLowerCase()===email);
    if(found) return found;
    if(users.length<perPage) return null;
  }
  fail('Recherche utilisateur interrompue : pagination anormale.');
}

async function createOrReuseUser(admin){
  const existing=await findUserByEmail(admin, tenant.email);
  if(existing) return {user:existing, created:false};

  // Bcrypt refuse plus de 72 octets. Un UUID aléatoire apporte déjà plus de
  // 120 bits d'entropie et ce mot de passe n'est jamais remis à l'utilisateur.
  const password=crypto.randomUUID()+'-Aa9!'+crypto.randomUUID().slice(0, 8);
  const {data,error}=await admin.auth.admin.createUser({
    email:tenant.email,
    password,
    email_confirm:true,
    user_metadata:{
      display_name:tenant.displayName,
      provisioning_key:tenant.key,
      source:'best-friend-operator'
    }
  });
  if(!error && data?.user) return {user:data.user, created:true};

  // Une exécution concurrente a pu créer le compte entre la lecture et
  // l'écriture. On relit avant de déclarer un échec.
  const raced=await findUserByEmail(admin, tenant.email);
  if(raced) return {user:raced, created:false};
  throw error || new Error('Compte propriétaire non créé.');
}

async function provision(){
  validateInputs();
  if(!confirm){
    console.log(JSON.stringify({
      dryRun:true,
      tenant:{
        key:tenant.key,
        owner:maskedEmail(tenant.email),
        name:tenant.name,
        brandName:tenant.brandName,
        ownerLabel:tenant.ownerLabel
      },
      siteUrl,
      would:[
        'créer ou réutiliser le compte propriétaire',
        'créer transactionnellement son organisation et son rôle owner',
        sendMagicLink
          ? 'envoyer le lien de connexion sans mot de passe'
          : 'ne pas envoyer de lien tant que BF_TENANT_SEND_MAGIC_LINK=YES'
      ],
      confirmation:'Définir BF_TENANT_CONFIRM=PROVISION pour exécuter.'
    },null,2));
    return;
  }

  const admin=client(backend.url, backend.serviceRoleKey);
  const account=await createOrReuseUser(admin);
  let organization;
  try{
    const {data,error}=await admin.rpc(
      'bf_operator_provision_organization',
      {
        p_provisioning_key:tenant.key,
        p_owner_user_id:account.user.id,
        p_owner_email:tenant.email,
        p_name:tenant.name,
        p_display_name:tenant.displayName,
        p_brand_name:tenant.brandName,
        p_owner_label:tenant.ownerLabel
      }
    );
    if(error) throw error;
    organization=Array.isArray(data) ? data[0] : data;
    if(!organization?.org_id) fail('Réponse de provisionnement incomplète.');
  }catch(error){
    if(account.created){
      const cleanup=await admin.auth.admin.deleteUser(account.user.id);
      if(cleanup.error){
        console.error('Nettoyage du compte incomplet après échec.');
      }
    }
    throw error;
  }

  let magicLink='not_requested';
  if(sendMagicLink){
    const publicClient=client(backend.url, backend.anonKey);
    const {error}=await publicClient.auth.signInWithOtp({
      email:tenant.email,
      options:{
        shouldCreateUser:false,
        emailRedirectTo:siteUrl
      }
    });
    if(error){
      console.error(JSON.stringify({
        provisioned:true,
        organizationId:organization.org_id,
        owner:maskedEmail(tenant.email),
        magicLink:'failed',
        retrySafe:true
      },null,2));
      throw error;
    }
    magicLink='sent';
  }

  console.log(JSON.stringify({
    provisioned:true,
    owner:maskedEmail(tenant.email),
    accountCreated:account.created,
    organizationId:organization.org_id,
    organizationCreated:Boolean(organization.created),
    magicLink,
    siteUrl
  },null,2));
}

provision().catch(error=>{
  let message=String(error?.message||error||'erreur inconnue');
  for(const secret of [backend.serviceRoleKey, backend.anonKey]){
    if(secret) message=message.replaceAll(secret, '[secret]');
  }
  console.error('Provisionnement impossible : '+message.slice(0, 500));
  process.exitCode=1;
});

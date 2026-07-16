const API='https://api.supabase.com/v1';
const token=process.env.SUPABASE_ACCESS_TOKEN;
const mode=process.argv[2]||'preflight';
const projectName=process.env.BF_SUPABASE_PROJECT_NAME||'best-friend-validation';

if(!token){
  console.error('SUPABASE_ACCESS_TOKEN absent. Aucun appel externe effectué.');
  process.exit(2);
}

async function api(path, options={}){
  const response=await fetch(API+path,{
    ...options,
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
      ...(options.headers||{})
    }
  });
  const text=await response.text();
  let data=null;
  try{ data=text?JSON.parse(text):null; }catch{ data=text; }
  if(!response.ok){
    throw new Error(`Supabase HTTP ${response.status}: ${typeof data==='string'?data:JSON.stringify(data)}`);
  }
  return data;
}

function safeProject(project){
  return {
    ref:project.ref||project.id,
    name:project.name,
    organization:project.organization_slug||project.organization_id,
    region:project.region,
    status:project.status
  };
}

function redirectUrls(siteUrl){
  const defaults=[
    'http://127.0.0.1:4173/',
    'http://127.0.0.1:4173/control',
    siteUrl,
    siteUrl.replace(/\/$/, '')+'/control'
  ];
  const configured=(process.env.BF_SUPABASE_REDIRECT_URLS||'')
    .split(',')
    .map(value=>value.trim())
    .filter(Boolean);
  const urls=[...new Set(configured.length ? configured : defaults)];
  for(const value of urls){
    const parsed=new URL(value);
    const local=['127.0.0.1','localhost'].includes(parsed.hostname);
    if(
      (parsed.protocol!=='https:' && !(local && parsed.protocol==='http:'))
      || parsed.username
      || parsed.password
      || parsed.hash
    ){
      throw new Error(`URL de redirection refusée : ${value}`);
    }
  }
  return urls;
}

const [organizations,projects]=await Promise.all([
  api('/organizations'),
  api('/projects')
]);
const existing=(projects||[]).find(project=>project.name?.toLowerCase()===projectName.toLowerCase());

if(mode==='preflight'){
  console.log(JSON.stringify({
    authenticated:true,
    organizations:(organizations||[]).map(org=>({id:org.id,slug:org.slug,name:org.name})),
    projects:(projects||[]).map(safeProject),
    validationProject:existing?safeProject(existing):null
  },null,2));
  process.exit(0);
}

if(mode==='create'){
  if(existing){
    console.log(JSON.stringify({created:false,existing:safeProject(existing)},null,2));
    process.exit(0);
  }
  const organizationSlug=process.env.BF_SUPABASE_ORG_SLUG;
  const databasePassword=process.env.BF_SUPABASE_DB_PASSWORD;
  const region=process.env.BF_SUPABASE_REGION||'eu-west-3';
  if(!organizationSlug) throw new Error('BF_SUPABASE_ORG_SLUG absent.');

  const plan={name:projectName,organization_slug:organizationSlug,region};
  if(process.env.BF_SUPABASE_CONFIRM_CREATE!=='YES'){
    console.log(JSON.stringify({
      dryRun:true,
      wouldCreate:plan,
      instruction:'Définir BF_SUPABASE_CONFIRM_CREATE=YES et fournir le mot de passe via BF_SUPABASE_DB_PASSWORD.'
    },null,2));
    process.exit(0);
  }
  if(!databasePassword || databasePassword.length<16){
    throw new Error('BF_SUPABASE_DB_PASSWORD doit contenir au moins 16 caractères.');
  }
  const created=await api('/projects',{
    method:'POST',
    body:JSON.stringify({...plan,db_pass:databasePassword})
  });
  console.log(JSON.stringify({created:true,project:safeProject(created)},null,2));
  process.exit(0);
}

if(mode==='configure-auth'){
  const projectRef=process.env.BF_SUPABASE_PROJECT_REF||existing?.ref||existing?.id;
  const siteUrl=(process.env.BF_SITE_URL||'https://best-friend-app.pages.dev')
    .replace(/\/$/, '');
  const redirects=redirectUrls(siteUrl);
  if(!projectRef) throw new Error('BF_SUPABASE_PROJECT_REF absent.');
  if(process.env.BF_SUPABASE_CONFIRM_CONFIGURE!=='YES'){
    console.log(JSON.stringify({
      dryRun:true,
      projectRef,
      auth:{site_url:siteUrl,uri_allow_list:redirects.join(',')}
    },null,2));
    process.exit(0);
  }
  await api(`/projects/${projectRef}/config/auth`,{
    method:'PATCH',
    body:JSON.stringify({
      site_url:siteUrl,
      uri_allow_list:redirects.join(',')
    })
  });
  console.log(JSON.stringify({configured:true,projectRef,siteUrl,redirects},null,2));
  process.exit(0);
}

throw new Error(`Mode inconnu : ${mode}`);

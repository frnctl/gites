import {createClient} from '@supabase/supabase-js';

"use strict";

const CONFIG = window.BF_CONFIG || {};
const Store = window.Store;
const $ = id => document.getElementById(id);
const CONTEXT_KEY = 'bestfriend:last_context';
const MANAGER_ROLES = new Set(['owner', 'admin', 'manager']);
const PHOTO_BUCKET = 'bf-proofs';

const TABLES = {
  apartments:    { remote:'bf_properties' },
  reservations:  { remote:'bf_reservations' },
  interventions: { remote:'bf_operations' },
  contacts:      { remote:'bf_contacts' }
};

let sb = null;
let user = null;
let activeOrg = null;
let activeRole = 'guest';
let activeMember = null;
let cloudIds = {};
let pushPromise = null;
let pushRequested = false;
let pullTimer = null;
let realtimeChannel = null;
let suppressUntil = 0;
let loginPromise = null;
let switchPromise = null;
let availableOrganizations = [];
let offlineContextRestored = false;
let retryTimer = null;
let retryDelay = 4_000;
const photoUrlCache = new Map();

function escapeHtml(value){
  if(window.esc) return window.esc(value);
  return String(value ?? '').replace(/[&<>"]/g, char=>({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'
  }[char]));
}

function canManageRole(role){ return MANAGER_ROLES.has(role); }
function canManage(){ return canManageRole(activeRole); }

function setDot(state, label){
  const dot = $('syncDot');
  if(!dot) return;
  dot.className = `sync-dot ${state==='ok'?'ok':state==='local'?'local':''}`;
  dot.textContent = label;
  dot.title = label;
}

function setSyncBanner(html){
  const banner = $('syncBanner');
  if(banner) banner.innerHTML = html;
}

function setStoreNote(text){
  const note=$('storeNote');
  if(note) note.textContent=text;
}

function restoreOfflineContext(expectedUser){
  try{
    const context = JSON.parse(localStorage.getItem(CONTEXT_KEY) || 'null');
    if(!context?.namespace || !context?.organization) return false;
    const sameUser = context.userId
      ? context.userId===expectedUser?.id
      : context.email?.toLowerCase()===expectedUser?.email?.toLowerCase();
    if(!sameUser) return false;
    Store.setNamespace(context.namespace, context.organization);
    window.setMe?.({
      email:context.email,
      role:context.role,
      apts:context.apts,
      orgId:context.orgId,
      organization:context.organization
    });
    setDot('local', 'Hors-ligne');
    setSyncBanner('Mode hors-ligne — les dernières données connues restent disponibles.');
    setStoreNote('Dernière sauvegarde disponible sur cet appareil.');
    window.BF_CLOUD_CONNECTED=true;
    offlineContextRestored=true;
    return true;
  }catch(error){
    console.warn('offline context', error);
    return false;
  }
}

function persistContext(apts){
  if(!user || !activeOrg) return;
  const organization = {
    id:activeOrg.org_id,
    name:activeOrg.organization_name,
    brandName:activeOrg.brand_name || 'Best Friend',
    ownerLabel:activeOrg.owner_label || 'Propriétaire'
  };
  localStorage.setItem(CONTEXT_KEY, JSON.stringify({
    userId:user.id,
    namespace:Store.namespace,
    email:user.email,
    role:activeRole,
    apts,
    orgId:activeOrg.org_id,
    organization
  }));
}

function showUnavailable(){
  setDot('local', 'Indisponible');
  setSyncBanner('La connexion sécurisée est momentanément indisponible.');
  setStoreNote('Aucune donnée privée n’est affichée.');
}

function showActivate(){
  setDot('local', 'Non connecté');
  setSyncBanner(
    'Vos données sont protégées par votre compte. '
    + '<button class="btn sm" id="bf_activate" style="margin-left:8px">Se connecter</button>'
  );
  $('bf_activate')?.addEventListener('click', showLogin);
}

function renderBanner(){
  if(!user || !activeOrg) return;
  const label = escapeHtml(activeOrg.organization_name);
  setSyncBanner(
    `Connecté à <b>${label}</b> · synchronisation automatique`
    + ' <button class="btn sm" id="bf_logout_inline" style="margin-left:8px">Se déconnecter</button>'
  );
  $('bf_logout_inline')?.addEventListener('click', logout);
}

function resetVisibleSession(){
  Store.cloudSync=null;
  window.BF_CLOUD_CONNECTED=false;
  Store.setNamespace('guest', {id:null,name:'',brandName:'Best Friend',ownerLabel:'Propriétaire'});
  window.MEMBERS=[];
  window.BF_RECOVERY_SNAPSHOTS=[];
  window.setMe?.({email:null, role:'guest', apts:[], orgId:null});
}

function showAccessUnavailable(){
  Store.cloudSync=null;
  window.BF_CLOUD_CONNECTED=false;
  Store.setNamespace('guest', {id:null,name:'',brandName:'Best Friend',ownerLabel:'Propriétaire'});
  window.MEMBERS=[];
  window.BF_RECOVERY_SNAPSHOTS=[];
  window.setMe?.({email:user?.email || null, role:'guest', apts:[], orgId:null});
  setDot('local', 'Bienvenue');
  setSyncBanner('Bienvenue ! Créez votre espace pour commencer à gérer vos biens.');
  setStoreNote('Votre espace est privé : vous seul et les personnes que vous invitez y ont accès.');
  window.openModal?.(`
    <h2 style="margin-bottom:8px">Bienvenue sur Best Friend</h2>
    <p class="hint" style="margin-bottom:14px">Créez votre espace privé pour gérer vos biens, vos réservations et vos interventions. Vous seul y avez accès — vous pourrez ensuite inviter qui vous voudrez (concierge, gestionnaire…).</p>
    <div class="form">
      <div class="field wide"><label for="bf_org_name">Nom de votre espace</label><input id="bf_org_name" type="text" maxlength="120" placeholder="Ex. : Appartements de Sophie"></div>
    </div>
    <div id="bf_org_message" class="hint" style="min-height:20px"></div>
    <div class="form-actions">
      <button class="btn primary" id="bf_org_create">Créer mon espace</button>
      <button class="btn ghost" id="bf_no_access_logout">Se déconnecter</button>
    </div>
  `);
  $('bf_no_access_logout')?.addEventListener('click', logout);
  const createOrganization=async ()=>{
    const name=($('bf_org_name')?.value||'').trim();
    const message=$('bf_org_message');
    if(name.length<2){
      if(message) message.textContent='Donnez un nom à votre espace (2 caractères minimum).';
      return;
    }
    const button=$('bf_org_create');
    if(button){ button.disabled=true; button.textContent='Création…'; }
    if(message) message.textContent='';
    const {error}=await sb.rpc('bf_create_organization', {p_name:name});
    if(error){
      console.warn('create organization', error);
      if(button){ button.disabled=false; button.textContent='Créer mon espace'; }
      if(message) message.textContent='Création impossible pour le moment. Réessayez dans un instant.';
      return;
    }
    window.closeModal?.();
    window.toast?.(`${name} est prêt. Bienvenue !`);
    await completeLogin(user);
  };
  $('bf_org_create')?.addEventListener('click', createOrganization);
  $('bf_org_name')?.addEventListener('keydown', event=>{
    if(event.key==='Enter') createOrganization();
  });
}

function showConciergeWaiting(){
  setDot('local', 'En attente d’invitation');
  setSyncBanner('Accès concierge — en attente d’une invitation.');
  setStoreNote('Demandez au propriétaire de vous inviter dans « Biens & gens ».');
  window.openModal?.(`
    <div class="entry-head">${ENTRY_SVGS.concierge}<h2 style="margin:0">Les clés arrivent</h2></div>
    <p class="hint" style="margin-bottom:12px">Aucune invitation trouvée pour <strong>${escapeHtml(user?.email||'')}</strong>. Demandez au propriétaire de vous ajouter dans « Biens &amp; gens » avec cette adresse exacte, puis revenez vérifier ici.</p>
    <div class="form-actions">
      <button class="btn primary" id="bf_cw_refresh">J’ai été invité·e — vérifier</button>
      <button class="btn ghost" id="bf_cw_logout">Se déconnecter</button>
    </div>
  `);
  $('bf_cw_refresh')?.addEventListener('click', ()=>completeLogin(user));
  $('bf_cw_logout')?.addEventListener('click', logout);
}

async function showProviderFlow(){
  Store.cloudSync=null;
  window.BF_CLOUD_CONNECTED=false;
  Store.setNamespace('guest', {id:null,name:'',brandName:'Best Friend',ownerLabel:'Propriétaire'});
  window.MEMBERS=[];
  window.setMe?.({email:user?.email||null, role:'guest', apts:[], orgId:null});
  setDot('ok', 'Prestataire');
  setSyncBanner('Espace prestataire — annuaire des artisans Best Friend.');
  setStoreNote('Votre fiche est privée : seule notre équipe la consulte pour la validation.');
  let row=null;
  try{
    const {data, error}=await sb.from('bf_providers').select('*').eq('user_id', user.id).maybeSingle();
    if(error) throw error;
    row=data;
  }catch(error){
    console.warn('provider', error);
    window.openModal?.(`
      <h2 style="margin-bottom:8px">Petit contretemps</h2>
      <p class="hint">Impossible de charger votre dossier prestataire pour le moment.</p>
      <div class="form-actions"><button class="btn primary" id="bf_pr_retry">Réessayer</button></div>
    `);
    $('bf_pr_retry')?.addEventListener('click', showProviderFlow);
    return;
  }
  if(!row){ renderProviderForm(null); return; }
  if(row.status==='approved'){
    window.openModal?.(`
      <div class="entry-head">${ENTRY_SVGS.provider}<h2 style="margin:0">Référencé !</h2></div>
      <p class="hint" style="margin-bottom:12px">Bienvenue parmi les artisans recommandés Best Friend, <strong>${escapeHtml(row.company)}</strong>. Votre fiche est désormais proposée à nos propriétaires. La qualité de chaque intervention entretient votre place dans l’annuaire.</p>
      <div class="form-actions">
        <button class="btn ghost" id="bf_pr_switch">J’ai aussi un espace propriétaire ou concierge</button>
        <button class="btn ghost" id="bf_pr_logout2">Se déconnecter</button>
      </div>
    `);
  }else if(row.status==='rejected'){
    window.openModal?.(`
      <div class="entry-head">${ENTRY_SVGS.provider}<h2 style="margin:0">Candidature non retenue</h2></div>
      <p class="hint" style="margin-bottom:12px">Votre candidature n’a pas été retenue pour le moment. Vous pouvez mettre votre fiche à jour : chaque dossier retravaillé est réexaminé.</p>
      <div class="form-actions">
        <button class="btn primary" id="bf_pr_edit">Retravailler ma fiche</button>
        <button class="btn ghost" id="bf_pr_logout2">Se déconnecter</button>
      </div>
    `);
  }else{
    window.openModal?.(`
      <div class="entry-head">${ENTRY_SVGS.provider}<h2 style="margin:0">Candidature à l’étude</h2></div>
      <p class="hint" style="margin-bottom:8px">Votre fiche <strong>${escapeHtml(row.company)}</strong> est entre nos mains. Nous vous contactons personnellement pour confirmer les derniers détails avant votre entrée dans l’annuaire.</p>
      <p class="hint" style="margin-bottom:12px">Les meilleurs dossiers sont recommandés en priorité à nos propriétaires : soignez votre fiche, c’est votre vitrine.</p>
      <div class="form-actions">
        <button class="btn primary" id="bf_pr_edit">Modifier ma fiche</button>
        <button class="btn ghost" id="bf_pr_switch">J’ai aussi un espace propriétaire ou concierge</button>
        <button class="btn ghost" id="bf_pr_logout2">Se déconnecter</button>
      </div>
    `);
  }
  $('bf_pr_edit')?.addEventListener('click', ()=>renderProviderForm(row));
  $('bf_pr_switch')?.addEventListener('click', ()=>{ localStorage.setItem(ENTRY_KEY, 'owner'); completeLogin(user); });
  $('bf_pr_logout2')?.addEventListener('click', ()=>{ localStorage.removeItem(ENTRY_KEY); logout(); });
}

function renderProviderForm(existing){
  const v=key=>escapeHtml(existing?.[key]||'');
  window.openModal?.(`
    <div class="entry-head">${ENTRY_SVGS.provider}<h2 style="margin:0">${existing?'Ma fiche prestataire':'Rejoindre l’annuaire'}</h2></div>
    <p class="hint" style="margin-bottom:12px">L’annuaire Best Friend est une sélection, pas une liste : chaque fiche est validée personnellement avant d’être recommandée à nos propriétaires. Présentez-vous sous votre meilleur jour.</p>
    <div class="form">
      <div class="field wide"><label for="bf_pr_company">Entreprise / nom professionnel *</label><input id="bf_pr_company" maxlength="120" value="${v('company')}" placeholder="Ex. : Fayçal Rénovation"></div>
      <div class="field wide"><label for="bf_pr_trades">Métiers / services *</label><input id="bf_pr_trades" maxlength="200" value="${v('trades')}" placeholder="Plomberie, électricité, ménage, peinture…"></div>
      <div class="field wide"><label for="bf_pr_presentation">Présentez-vous *</label><textarea id="bf_pr_presentation" rows="4" maxlength="2000" placeholder="Votre parcours, vos spécialités, ce qui fait la différence…">${v('presentation')}</textarea></div>
      <div class="field"><label for="bf_pr_phone">Téléphone *</label><input id="bf_pr_phone" maxlength="30" value="${v('phone')}" placeholder="06…"></div>
      <div class="field"><label for="bf_pr_zone">Secteur d’intervention</label><input id="bf_pr_zone" maxlength="120" value="${v('zone')}" placeholder="Paris et petite couronne"></div>
      <div class="field wide"><label for="bf_pr_website">Site web</label><input id="bf_pr_website" maxlength="200" value="${v('website')}" placeholder="https://…"></div>
      <div class="field wide"><label for="bf_pr_files">Documents — plaquette PDF, photos, logo (3 max, 10 Mo)</label><input id="bf_pr_files" type="file" accept=".pdf,image/*" multiple></div>
    </div>
    <details class="hint" style="margin:10px 0">
      <summary style="cursor:pointer">Lire la Charte d’excellence Best Friend</summary>
      <p style="margin-top:8px">Devis clairs et honnêtes avant toute intervention. Délais annoncés, délais tenus. Travail soigné, lieux laissés impeccables. Courtoisie irréprochable envers voyageurs, concierges et propriétaires. Réponse aux sollicitations sous 24 h ouvrées. Le référencement peut être retiré à tout moment en cas de manquement.</p>
    </details>
    <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;cursor:pointer">
      <input type="checkbox" id="bf_pr_charte" style="margin-top:3px">
      <span class="hint">Je m’engage à respecter la Charte d’excellence Best Friend. *</span>
    </label>
    <div id="bf_pr_message" class="hint" style="min-height:20px"></div>
    <div class="form-actions">
      <button class="btn gold" id="bf_pr_submit">${existing?'Mettre à jour ma fiche':'Envoyer ma candidature'}</button>
      <button class="btn ghost" id="bf_pr_logout">Se déconnecter</button>
    </div>
  `);
  if(existing?.charte_accepted_at){ const box=$('bf_pr_charte'); if(box) box.checked=true; }
  $('bf_pr_logout')?.addEventListener('click', ()=>{ localStorage.removeItem(ENTRY_KEY); logout(); });
  $('bf_pr_submit')?.addEventListener('click', ()=>submitProviderForm(existing));
}

async function submitProviderForm(existing){
  const message=$('bf_pr_message');
  const company=($('bf_pr_company')?.value||'').trim();
  const trades=($('bf_pr_trades')?.value||'').trim();
  const presentation=($('bf_pr_presentation')?.value||'').trim();
  const phone=($('bf_pr_phone')?.value||'').trim();
  const zone=($('bf_pr_zone')?.value||'').trim();
  const website=($('bf_pr_website')?.value||'').trim();
  if(company.length<2 || !trades || presentation.length<10 || !phone){
    if(message) message.textContent='Remplissez les champs marqués d’une étoile (présentation : 10 caractères minimum).';
    return;
  }
  if(!$('bf_pr_charte')?.checked){
    if(message) message.textContent='La Charte d’excellence doit être acceptée pour candidater.';
    return;
  }
  const button=$('bf_pr_submit');
  if(button){ button.disabled=true; button.textContent='Envoi…'; }
  const files=Array.isArray(existing?.files)?[...existing.files]:[];
  try{
    const selected=[...($('bf_pr_files')?.files||[])].slice(0,3);
    for(const file of selected){
      const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-80);
      const path=`${user.id}/${Date.now()}_${safe}`;
      const {error}=await sb.storage.from('bf-providers').upload(path, file);
      if(error) throw error;
      files.push({path, name:file.name, type:file.type, size:file.size});
    }
    const {error}=await sb.from('bf_providers').upsert({
      user_id:user.id,
      email:user.email||'',
      company, trades, presentation, phone, zone, website,
      files,
      charte_accepted_at:existing?.charte_accepted_at||new Date().toISOString(),
      status:'pending'
    }, {onConflict:'user_id'});
    if(error) throw error;
  }catch(error){
    console.warn('provider submit', error);
    if(button){ button.disabled=false; button.textContent=existing?'Mettre à jour ma fiche':'Envoyer ma candidature'; }
    if(message) message.textContent='Envoi impossible pour le moment. Vérifiez les fichiers (10 Mo max) et réessayez.';
    return;
  }
  window.toast?.('Candidature bien reçue !');
  showProviderFlow();
}

function roleLabel(role){
  return {
    owner:'Propriétaire',
    admin:'Administrateur',
    manager:'Gestionnaire',
    concierge:'Concierge',
    viewer:'Lecture seule'
  }[role]||role;
}

function renderOrganizationSwitcher(){
  const button=$('btnOrganization');
  if(!button) return;
  const multiple=Boolean(user && activeOrg && availableOrganizations.length>1);
  button.hidden=!multiple;
  if(multiple){
    button.textContent=`${activeOrg.organization_name} · Changer`;
    button.title=`${availableOrganizations.length} espaces disponibles`;
    button.setAttribute('aria-label', `Espace actuel : ${activeOrg.organization_name}. Changer d’espace`);
  }
}

async function refreshOrganizationList({acceptInvitations=true}={}){
  if(!sb || !user) return [];
  if(acceptInvitations){
    const accepted=await sb.rpc('bf_accept_invitations');
    if(accepted.error) throw accepted.error;
  }
  const result=await sb.rpc('bf_list_my_organizations');
  if(result.error) throw result.error;
  availableOrganizations=result.data||[];
  renderOrganizationSwitcher();
  return availableOrganizations;
}

function showOrganizationPicker(){
  if(!user || availableOrganizations.length<2) return;
  const cards=availableOrganizations.map(organization=>{
    const current=organization.org_id===activeOrg?.org_id;
    return `
      <button class="btn ${current?'primary':''} bf-org-choice"
        data-org-id="${escapeHtml(organization.org_id)}"
        ${current?'disabled':''}
        style="width:100%;display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <span>${escapeHtml(organization.organization_name)}</span>
        <span class="hint" style="color:inherit">${current?'Ouvert':escapeHtml(roleLabel(organization.member_role))}</span>
      </button>
    `;
  }).join('');
  window.openModal?.(`
    <h2 style="margin-bottom:8px">Mes espaces</h2>
    <p class="hint">Choisissez le propriétaire ou l’activité à ouvrir. Les données restent totalement séparées.</p>
    <div style="margin:14px 0">${cards}</div>
    <div id="bf_org_switch_message" class="hint" style="min-height:20px"></div>
    <div class="form-actions">
      <button class="btn" id="bf_refresh_orgs">Actualiser mes accès</button>
      <button class="btn ghost" id="bf_close_orgs">Fermer</button>
    </div>
  `);
  document.querySelectorAll('.bf-org-choice:not([disabled])').forEach(button=>{
    button.addEventListener('click', ()=>switchOrganization(button.dataset.orgId));
  });
  $('bf_refresh_orgs')?.addEventListener('click', async()=>{
    const message=$('bf_org_switch_message');
    if(message) message.textContent='Actualisation…';
    try{
      await refreshOrganizationList();
      showOrganizationPicker();
    }catch(error){
      console.warn('refresh organizations', error);
      if(message) message.textContent='Actualisation impossible pour le moment.';
    }
  });
  $('bf_close_orgs')?.addEventListener('click', ()=>window.closeModal?.());
}

async function switchOrganization(orgId){
  if(switchPromise) return switchPromise;
  const organization=availableOrganizations.find(item=>item.org_id===orgId);
  if(!organization || organization.org_id===activeOrg?.org_id) return;
  const message=$('bf_org_switch_message');
  document.querySelectorAll('.bf-org-choice').forEach(button=>{ button.disabled=true; });
  if(message) message.textContent='Sauvegarde et ouverture de l’espace…';
  switchPromise=activateOrganization(organization, {switching:true})
    .then(()=>{
      window.closeModal?.();
      window.toast?.(`${organization.organization_name} est ouvert.`);
    })
    .catch(error=>{
      console.warn('switch organization', error);
      if(message) message.textContent='Impossible de changer d’espace. Vos données actuelles restent ouvertes.';
      document.querySelectorAll('.bf-org-choice').forEach(button=>{
        button.disabled=button.dataset.orgId===activeOrg?.org_id;
      });
    })
    .finally(()=>{ switchPromise=null; });
  return switchPromise;
}

window.bfShowLogin = showLogin;
window.bfLogout = logout;
window.bfShowOrganizations = showOrganizationPicker;

// Bugbox : dépôt d'un rapport de bug (table bf_bugs, insert-only via RLS).
window.bfReportBug = async function(message){
  if(!sb || !user) throw new Error('Connectez-vous pour signaler un bug.');
  const view=document.querySelector('.view.active')?.id?.replace(/^view-/,'') || '';
  const {error}=await sb.from('bf_bugs').insert({
    org_id: activeOrg?.org_id || null,
    email: user.email || null,
    page: view,
    message: String(message).slice(0, 4000),
    meta: {
      revision: CONFIG.revision || null,
      role: activeRole || null,
      url: location.href,
      screen: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent
    }
  });
  if(error) throw error;
};

async function initialize(){
  const entryParam=new URLSearchParams(location.search).get('entry');
  if(['owner','concierge','provider'].includes(entryParam)){
    localStorage.setItem(ENTRY_KEY, entryParam);
  }
  if(window.BF_DEMO_MODE){
    setDot('ok', 'Démo');
    setSyncBanner('Mode démonstration — aucune donnée réelle.');
    setStoreNote('Mode démonstration — aucune donnée réelle.');
    return;
  }

  if(!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey){
    resetVisibleSession();
    showUnavailable();
    return;
  }

  setDot('local', 'Connexion…');
  sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
  });

  const {data:{session}, error} = await sb.auth.getSession();
  if(error) console.warn('session', error);
  if(session){
    restoreOfflineContext(session.user);
    await handleLogin(session.user);
  }else{
    resetVisibleSession();
    showActivate();
  }

  sb.auth.onAuthStateChange((event, sessionState)=>{
    if(sessionState?.user && (!user || sessionState.user.id!==user.id)){
      setTimeout(()=>handleLogin(sessionState.user), 0);
    }else if(event==='SIGNED_OUT'){
      user=null;
      activeOrg=null;
      activeRole='guest';
      activeMember=null;
      availableOrganizations=[];
      offlineContextRestored=false;
      renderOrganizationSwitcher();
      resetVisibleSession();
      showActivate();
    }
  });
}

const ENTRY_KEY='bestfriend:entry';

const ENTRY_SVGS={
  owner:`<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true" fill="none">
    <g fill="#C9A227">
      <ellipse cx="20" cy="51" rx="6.5" ry="2.6" transform="rotate(35 20 51)"/>
      <ellipse cx="13.5" cy="43" rx="6.5" ry="2.6" transform="rotate(65 13.5 43)"/>
      <ellipse cx="10.5" cy="33" rx="6.5" ry="2.6" transform="rotate(85 10.5 33)"/>
      <ellipse cx="11" cy="22.5" rx="6.5" ry="2.6" transform="rotate(103 11 22.5)"/>
      <ellipse cx="15" cy="13" rx="6.5" ry="2.6" transform="rotate(125 15 13)"/>
      <ellipse cx="44" cy="51" rx="6.5" ry="2.6" transform="rotate(-35 44 51)"/>
      <ellipse cx="50.5" cy="43" rx="6.5" ry="2.6" transform="rotate(-65 50.5 43)"/>
      <ellipse cx="53.5" cy="33" rx="6.5" ry="2.6" transform="rotate(-85 53.5 33)"/>
      <ellipse cx="53" cy="22.5" rx="6.5" ry="2.6" transform="rotate(-103 53 22.5)"/>
      <ellipse cx="49" cy="13" rx="6.5" ry="2.6" transform="rotate(-125 49 13)"/>
    </g>
    <path d="M32 22 L34.4 28 L40.5 28.3 L35.8 32.3 L37.5 38.4 L32 35 L26.5 38.4 L28.2 32.3 L23.5 28.3 L29.6 28 Z" fill="#C9A227"/>
  </svg>`,
  concierge:`<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true" fill="none" stroke="#C9A227" stroke-linecap="round">
    <circle cx="14" cy="50" r="7" stroke-width="3"/>
    <circle cx="14" cy="50" r="2.6" stroke-width="2"/>
    <path d="M19.5 45 L48 16.5" stroke-width="3.6"/>
    <path d="M44 12.5 L51.5 20" stroke-width="3.6"/>
    <path d="M46.5 22.5 L51 27" stroke-width="3.4"/>
    <path d="M41 28 L45 32" stroke-width="3.4"/>
    <circle cx="50" cy="50" r="7" stroke-width="3"/>
    <circle cx="50" cy="50" r="2.6" stroke-width="2"/>
    <path d="M44.5 45 L16 16.5" stroke-width="3.6"/>
    <path d="M20 12.5 L12.5 20" stroke-width="3.6"/>
    <path d="M17.5 22.5 L13 27" stroke-width="3.4"/>
    <path d="M23 28 L19 32" stroke-width="3.4"/>
  </svg>`,
  provider:`<svg viewBox="0 0 64 64" width="46" height="46" aria-hidden="true">
    <path d="M25 38 L20 58 L27.5 52.5 L31 60 Z" fill="#C9A227" opacity=".85"/>
    <path d="M39 38 L44 58 L36.5 52.5 L33 60 Z" fill="#C9A227" opacity=".85"/>
    <circle cx="32" cy="25" r="17" fill="none" stroke="#C9A227" stroke-width="2.6"/>
    <circle cx="32" cy="25" r="12.6" fill="none" stroke="#C9A227" stroke-width="1.2" stroke-dasharray="2.6 2.6"/>
    <path d="M32 16.2 L34.5 22.3 L41 22.6 L36 26.8 L37.8 33.2 L32 29.6 L26.2 33.2 L28 26.8 L23 22.6 L29.5 22.3 Z" fill="#C9A227"/>
  </svg>`
};

const ENTRY_COPY={
  owner:{
    title:'Connexion propriétaire',
    text:'Votre espace privé : biens, réservations, finances, équipe. Nouveau ? Le lien de connexion crée votre compte et vous ouvrez votre espace dans la foulée.'
  },
  concierge:{
    title:'Accès concierge',
    text:'Les doubles clés d\'or : accédez aux biens dont on vous a confié la gestion. Connectez-vous avec l\'adresse que votre propriétaire a invitée.'
  },
  provider:{
    title:'Espace prestataire',
    text:'Plomberie, électricité, ménage, travaux… L\'annuaire Best Friend ne référence que des artisans d\'exception, recommandés directement à nos propriétaires. Si votre travail parle pour vous, votre place est ici.'
  }
};

function showLogin(){
  if(!sb){
    window.openModal?.(`
      <h2 style="margin-bottom:8px">Connexion indisponible</h2>
      <p class="hint">Le service sécurisé ne répond pas pour le moment.</p>
      <div class="form-actions"><button class="btn primary" onclick="closeModal()">Compris</button></div>
    `);
    return;
  }
  if(user && localStorage.getItem(ENTRY_KEY)==='provider'){
    showProviderFlow();
    return;
  }

  window.openModal?.(`
    <h2 style="margin-bottom:4px">Bienvenue</h2>
    <p class="hint" style="margin-bottom:14px">Choisissez votre accès.</p>
    <div class="entry-cards">
      <button type="button" class="entry-card" data-entry="owner">
        ${ENTRY_SVGS.owner}
        <strong>Propriétaire</strong>
        <span>Gérez vos biens et votre équipe</span>
      </button>
      <button type="button" class="entry-card" data-entry="concierge">
        ${ENTRY_SVGS.concierge}
        <strong>Concierge</strong>
        <span>Les clés qu'on vous a confiées</span>
      </button>
      <button type="button" class="entry-card" data-entry="provider">
        ${ENTRY_SVGS.provider}
        <strong>Prestataire</strong>
        <span>Proposez vos services</span>
      </button>
    </div>
  `);
  document.querySelectorAll('.entry-card').forEach(card=>{
    card.addEventListener('click', ()=>showLoginEmail(card.dataset.entry));
  });
}

function showLoginEmail(entry){
  const copy=ENTRY_COPY[entry]||ENTRY_COPY.owner;
  window.openModal?.(`
    <div class="entry-head">${ENTRY_SVGS[entry]||''}<h2 style="margin:0">${copy.title}</h2></div>
    <p class="hint" style="margin-bottom:14px">${copy.text}</p>
    <div class="form">
      <div class="field wide"><label for="bf_login_email">Email</label><input id="bf_login_email" type="email" autocomplete="email" placeholder="vous@exemple.fr"></div>
    </div>
    <div id="bf_login_message" class="hint" style="min-height:20px"></div>
    <div class="form-actions">
      <button class="btn primary" id="bf_send_link">Recevoir mon lien</button>
      <button class="btn ghost" id="bf_entry_back">Retour</button>
    </div>
  `);
  $('bf_entry_back')?.addEventListener('click', showLogin);
  $('bf_send_link')?.addEventListener('click', ()=>sendMagicLink(entry));
  $('bf_login_email')?.addEventListener('keydown', event=>{
    if(event.key==='Enter') sendMagicLink(entry);
  });
}

async function sendMagicLink(entry='owner'){
  const email = $('bf_login_email')?.value.trim().toLowerCase();
  const message = $('bf_login_message');
  if(!email || !email.includes('@')){
    if(message) message.textContent='Saisissez une adresse email valide.';
    return;
  }
  if(message) message.textContent='Envoi en cours…';
  localStorage.setItem(ENTRY_KEY, entry);

  // Envoi via notre worker (SMTP dédié, sans la limite horaire Supabase),
  // avec repli sur le service email intégré de Supabase.
  let sent=false;
  try{
    const response=await fetch('/api/login-link', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email, entry})
    });
    const payload=await response.json().catch(()=>({}));
    sent=response.ok && payload.ok===true;
  }catch(error){
    console.warn('login link', error);
  }
  if(!sent){
    const redirectTo = `${location.origin}${location.pathname}?entry=${entry}`;
    const {error} = await sb.auth.signInWithOtp({
      email,
      options:{emailRedirectTo:redirectTo, shouldCreateUser:true}
    });
    if(error){
      console.warn('magic link', error);
      if(message){
        message.textContent='Envoi impossible pour le moment. Réessayez dans quelques minutes.';
      }
      return;
    }
  }
  if(message){
    message.textContent='Le lien de connexion arrive par email dans quelques instants. Pensez à vérifier les indésirables.';
  }
}

async function handleLogin(nextUser){
  if(loginPromise) return loginPromise;
  loginPromise = completeLogin(nextUser).finally(()=>{ loginPromise=null; });
  return loginPromise;
}

async function completeLogin(nextUser){
  user = nextUser;
  setDot('ok', 'Connexion…');

  if(localStorage.getItem(ENTRY_KEY)==='provider'){
    await showProviderFlow();
    return;
  }

  let organizations;
  try{
    organizations=await refreshOrganizationList();
  }catch(error){
    console.warn('organizations', error);
    if(offlineContextRestored){
      setDot('local', 'Hors-ligne');
      setSyncBanner('Mode hors-ligne — dernier espace vérifié disponible sur cet appareil.');
    }else{
      showSchemaPending();
    }
    return;
  }

  if(!organizations.length){
    renderOrganizationSwitcher();
    if(localStorage.getItem(ENTRY_KEY)==='concierge'){
      showConciergeWaiting();
    }else{
      showAccessUnavailable();
    }
    return;
  }

  const preferred = localStorage.getItem('bestfriend:active_org:'+user.id);
  const organization = organizations.find(item=>item.org_id===preferred) || organizations[0];
  await activateOrganization(organization);
  offlineContextRestored=false;
}

function showSchemaPending(){
  setDot('local', 'Préparation');
  setSyncBanner('Votre espace sécurisé est en cours de préparation. Aucune action technique n’est nécessaire.');
}

async function organizationAccess(organization){
  const memberResult = await sb.from('bf_members')
    .select('id,role,status')
    .eq('org_id', organization.org_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if(memberResult.error) throw memberResult.error;
  if(!memberResult.data || memberResult.data.status!=='active'){
    throw new Error('active_membership_required');
  }

  let allowedProperties = null;
  if(!canManageRole(memberResult.data.role)){
    const assignments = await sb.from('bf_property_members')
      .select('property_id')
      .eq('org_id', organization.org_id)
      .eq('member_id', memberResult.data.id);
    if(assignments.error) throw assignments.error;
    allowedProperties = (assignments.data||[]).map(item=>item.property_id);
  }
  return {
    member:memberResult.data,
    role:memberResult.data.role,
    allowedProperties
  };
}

async function activateOrganization(organization, {switching=false}={}){
  if(!user) throw new Error('authenticated_user_required');
  const previousOrgId=activeOrg?.org_id || null;
  if(switching && previousOrgId && previousOrgId!==organization.org_id){
    await flushPendingWrites();
  }

  const [access, payload] = await Promise.all([
    organizationAccess(organization),
    fetchAllForOrganization(organization)
  ]);
  if(switching && activeOrg?.org_id!==previousOrgId){
    throw new Error('organization_changed_during_switch');
  }

  const profile = {
    id:organization.org_id,
    name:organization.organization_name,
    brandName:organization.brand_name || 'Best Friend',
    ownerLabel:organization.owner_label || 'Propriétaire'
  };
  const namespace = user.id+':'+organization.org_id;

  pushRequested=false;
  clearTimeout(pullTimer);
  pullTimer=null;
  const previousChannel=realtimeChannel;
  realtimeChannel=null;
  if(previousChannel && sb){
    try{ await sb.removeChannel(previousChannel); }
    catch(error){ console.warn('remove realtime channel', error); }
  }

  Store.cloudSync = null;
  activeOrg = {...organization, member_role:access.role};
  activeRole = access.role;
  activeMember = access.member;
  cloudIds = payload.ids;
  window.MEMBERS=[];
  window.BF_RECOVERY_SNAPSHOTS=[];
  Store.setNamespace(namespace, profile);
  window.setMe?.({
    email:user.email,
    role:activeRole,
    apts:access.allowedProperties,
    orgId:organization.org_id,
    organization:profile
  });
  Store.applyCloud(payload.data);
  localStorage.setItem('bestfriend:active_org:'+user.id, organization.org_id);
  persistContext(access.allowedProperties);
  setDot('ok', 'À jour');
  setStoreNote('Sauvegarde automatique activée.');

  Store.cloudSync = schedulePush;
  window.BF_CLOUD_CONNECTED=true;
  const secondary=await Promise.allSettled([loadMembers(), loadSnapshots()]);
  secondary.forEach(result=>{
    if(result.status==='rejected') console.warn('organization metadata', result.reason);
  });
  subscribe();
  renderOrganizationSwitcher();
  renderBanner();
  setTimeout(()=>window.bfRefreshDueIcalFeeds?.(), 0);
}

async function logout(){
  const signingOutUserId=user?.id || null;
  pushRequested=false;
  clearTimeout(pullTimer);
  Store.cloudSync=null;
  window.BF_CLOUD_CONNECTED=false;
  if(realtimeChannel && sb){
    try{ await sb.removeChannel(realtimeChannel); }
    catch(error){ console.warn('remove realtime channel', error); }
  }
  if(signingOutUserId){
    const cachePrefix='bestfriend_v4:'+signingOutUserId+':';
    const keys=[];
    for(let index=0; index<localStorage.length; index+=1){
      const key=localStorage.key(index);
      if(key?.startsWith(cachePrefix)) keys.push(key);
    }
    keys.forEach(key=>localStorage.removeItem(key));
    localStorage.removeItem('bestfriend:active_org:'+signingOutUserId);
  }
  localStorage.removeItem(CONTEXT_KEY);
  try{
    if(sb) await sb.auth.signOut();
  }finally{
    location.reload();
  }
}

async function fetchAllForOrganization(organization){
  if(!organization?.org_id) throw new Error('organization_required');
  const orgId = organization.org_id;
  const out = {
    organization:{
      id:orgId,
      name:organization.organization_name,
      brandName:organization.brand_name || 'Best Friend',
      ownerLabel:organization.owner_label || 'Propriétaire'
    },
    apartments:[], reservations:[], interventions:[], contacts:[]
  };

  const [properties, reservations, operations, contacts] = await Promise.all([
    sb.from(TABLES.apartments.remote)
      .select('id,name,active,doc').eq('org_id', orgId),
    sb.from(TABLES.reservations.remote)
      .select('id,property_id,doc').eq('org_id', orgId),
    sb.from(TABLES.interventions.remote)
      .select('id,property_id,kind,status,due_at,completed_at,doc').eq('org_id', orgId),
    sb.from(TABLES.contacts.remote)
      .select('id,property_id,doc').eq('org_id', orgId)
  ]);
  if(properties.error) throw properties.error;
  out.apartments = (properties.data||[]).map(row=>({
    ...row.doc, id:row.id, name:row.name, active:row.active
  }));

  if(reservations.error) throw reservations.error;
  out.reservations = (reservations.data||[]).map(row=>({
    ...row.doc, id:row.id, aptId:row.property_id
  }));

  if(operations.error) throw operations.error;
  out.interventions = (operations.data||[]).map(row=>({
    ...row.doc, id:row.id, aptId:row.property_id,
    kind:row.doc?.kind || row.kind,
    planned:row.doc?.planned ?? row.status!=='done'
  }));

  if(contacts.error) throw contacts.error;
  out.contacts = (contacts.data||[]).map(row=>({
    ...row.doc, id:row.id, aptId:row.property_id || row.doc?.aptId
  }));

  const ids={};
  for(const name of Object.keys(TABLES)){
    ids[name]=new Set(out[name].map(item=>String(item.id)));
  }
  return {data:out, ids};
}

async function fetchAll(){
  if(!activeOrg) throw new Error('organization_required');
  const payload=await fetchAllForOrganization(activeOrg);
  cloudIds=payload.ids;
  return payload.data;
}

function schedulePush(){
  pushRequested=true;
  setDot('local', 'Enregistrement…');
  if(!pushPromise) queueMicrotask(()=>pushAll({request:false}));
}

function scheduleRetry(){
  clearTimeout(retryTimer);
  retryTimer=setTimeout(()=>{
    retryTimer=null;
    if(navigator.onLine && user && activeOrg) pushAll();
  }, retryDelay);
  retryDelay=Math.min(retryDelay*2, 60_000);
}

async function flushPendingWrites(){
  await pushAll({throwOnError:true});
}

async function pushAll({throwOnError=false, request=true}={}){
  if(!sb || !user || !activeOrg || activeRole==='viewer') return;
  if(request) pushRequested=true;
  if(pushPromise){
    try{
      await pushPromise;
    }catch(error){
      if(throwOnError) throw error;
    }
    return;
  }
  const task=(async()=>{
    while(pushRequested){
      pushRequested=false;
      const orgId=activeOrg.org_id;
      suppressUntil = Date.now()+2500;
      const names = canManage()
        ? ['apartments','reservations','interventions','contacts']
        : ['interventions'];
      for(const name of names){
        if(activeOrg?.org_id!==orgId){
          throw new Error('organization_changed_during_push');
        }
        await syncTable(name, Store.data[name]||[], {allowDelete:canManage()});
      }
      if(activeOrg?.org_id!==orgId){
        throw new Error('organization_changed_during_push');
      }
    }
  })();
  pushPromise=task;
  try{
    await task;
    clearTimeout(retryTimer);
    retryTimer=null;
    retryDelay=4_000;
    setDot('ok', 'À jour');
  }catch(error){
    console.warn('sync push', error);
    setDot('local', 'À resynchroniser');
    scheduleRetry();
    if(throwOnError) throw error;
  }finally{
    if(pushPromise===task){
      pushPromise=null;
      if(pushRequested) queueMicrotask(()=>pushAll({request:false}));
    }
  }
}

function operationTimestamp(item){
  if(!item.date) return null;
  const raw = `${item.date}T${item.time||'12:00'}:00`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function encodeRow(name, item){
  const org_id = activeOrg.org_id;
  const id = String(item.id);
  if(name==='apartments') return {
    org_id, id, name:item.name||'Bien sans nom', active:item.active!==false, doc:item
  };
  if(name==='reservations') return {
    org_id, id, property_id:item.aptId, doc:item
  };
  if(name==='interventions') return {
    org_id, id, property_id:item.aptId,
    kind:item.kind||'intervention',
    status:item.planned?'open':'done',
    due_at:item.planned?operationTimestamp(item):null,
    completed_at:item.planned?null:(item.ts||operationTimestamp(item)),
    doc:item
  };
  return {
    org_id, id, property_id:item.aptId||null, doc:item
  };
}

async function syncTable(name, items, options={}){
  const remote = TABLES[name].remote;
  const rows = items.map(item=>encodeRow(name,item));
  if(rows.some(row=>!row.id)) throw new Error(`invalid_${name}_id`);
  if(rows.length){
    const {error} = await sb.from(remote).upsert(rows, {onConflict:'org_id,id'});
    if(error) throw error;
  }

  const ids = new Set(rows.map(row=>row.id));
  if(options.allowDelete){
    const removed = [...(cloudIds[name]||[])].filter(id=>!ids.has(id));
    if(removed.length){
      const {error} = await sb.from(remote)
        .delete().eq('org_id', activeOrg.org_id).in('id', removed);
      if(error) throw error;
    }
  }
  cloudIds[name] = ids;
}

async function loadMembers(){
  if(!sb || !activeOrg || !canManage()){
    window.MEMBERS=[];
    window.renderMembers?.();
    return;
  }

  const members = await sb.from('bf_members')
    .select('id,email,display_name,role,status,user_id')
    .eq('org_id', activeOrg.org_id)
    .order('role');
  if(members.error) throw members.error;

  const assignments = await sb.from('bf_property_members')
    .select('member_id,property_id')
    .eq('org_id', activeOrg.org_id);
  if(assignments.error) throw assignments.error;

  const byMember = new Map();
  for(const row of assignments.data||[]){
    const list = byMember.get(row.member_id) || [];
    list.push(row.property_id);
    byMember.set(row.member_id, list);
  }
  window.MEMBERS = (members.data||[]).map(member=>({
    ...member,
    name:member.display_name,
    apt_ids:byMember.get(member.id)||[]
  }));
  window.renderMembers?.();
}

async function loadSnapshots(){
  window.BF_RECOVERY_SNAPSHOTS=[];
  if(!sb || !activeOrg || !['owner','admin'].includes(activeRole)){
    window.renderRecoveryControl?.();
    return;
  }
  const snapshots=await sb.from('bf_snapshots')
    .select('id,counts,created_at')
    .eq('org_id', activeOrg.org_id)
    .order('created_at', {ascending:false})
    .order('id', {ascending:false})
    .limit(3);
  if(snapshots.error){
    console.warn('recovery snapshots', snapshots.error);
    window.renderRecoveryControl?.();
    return;
  }
  window.BF_RECOVERY_SNAPSHOTS=snapshots.data||[];
  window.renderRecoveryControl?.();
}

window.bfSaveMember = async member=>{
  if(!activeOrg) throw new Error('organization_required');
  if(String(CONFIG.environment || '').startsWith('local')){
    const {error} = await sb.rpc('bf_invite_member', {
      p_org_id:activeOrg.org_id,
      p_email:(member.email||'').toLowerCase(),
      p_display_name:member.name||'',
      p_role:member.role,
      p_property_ids:member.apt_ids||[]
    });
    if(error) throw error;
    await loadMembers();
    return {accessSaved:true, emailSent:false, local:true};
  }
  const {data:{session}}=await sb.auth.getSession();
  const response=await fetch('/api/invite', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${session?.access_token || ''}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      orgId:activeOrg.org_id,
      email:(member.email||'').toLowerCase(),
      name:member.name||'',
      role:member.role,
      propertyIds:member.apt_ids||[]
    })
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error || 'invitation_failed');
  await loadMembers();
  return payload;
};

window.bfDeleteMember = async email=>{
  if(!activeOrg) throw new Error('organization_required');
  const {error} = await sb.rpc('bf_remove_member', {
    p_org_id:activeOrg.org_id,
    p_email:(email||'').toLowerCase()
  });
  if(error) throw error;
  await loadMembers();
};

window.bfFetchIcal = async source=>{
  if(!sb || !user || !activeOrg) throw new Error('Connexion sécurisée requise.');
  if(String(CONFIG.environment || '').startsWith('local')){
    const response=await fetch(source);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
  const {data:{session}}=await sb.auth.getSession();
  const response=await fetch('/api/ical', {
    method:'POST',
    headers:{
      Authorization:`Bearer ${session?.access_token || ''}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({url:source})
  });
  if(!response.ok) throw new Error('Calendrier indisponible.');
  return response.text();
};

function proofPath(value){
  const raw=typeof value==='string' ? value : value?.path;
  return String(raw || '').replace(/^storage:/, '');
}

function safePathSegment(value){
  const segment=String(value || '');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(segment)){
    throw new Error('Identifiant de bien incompatible avec les preuves photo.');
  }
  return segment;
}

window.bfUploadProofs = async (blobs, propertyId)=>{
  if(!sb || !user || !activeOrg || !navigator.onLine){
    throw new Error('Une connexion est requise pour ajouter une photo.');
  }
  const property=safePathSegment(propertyId);
  const uploaded=[];
  try{
    for(const blob of blobs){
      const path=[
        activeOrg.org_id,
        property,
        user.id,
        `${crypto.randomUUID()}.jpg`
      ].join('/');
      const result=await sb.storage.from(PHOTO_BUCKET).upload(path, blob, {
        contentType:'image/jpeg',
        cacheControl:'3600',
        upsert:false
      });
      if(result.error) throw result.error;
      uploaded.push('storage:'+path);
    }
    return uploaded;
  }catch(error){
    const paths=uploaded.map(proofPath).filter(Boolean);
    if(paths.length) await sb.storage.from(PHOTO_BUCKET).remove(paths).catch(()=>{});
    throw error;
  }
};

window.bfDeleteProofs = async values=>{
  if(!sb || !Array.isArray(values)) return;
  const paths=values.map(proofPath).filter(path=>path && !path.startsWith('data:'));
  if(!paths.length) return;
  const result=await sb.storage.from(PHOTO_BUCKET).remove(paths);
  if(result.error) throw result.error;
  paths.forEach(path=>photoUrlCache.delete(path));
};

async function signedProofUrl(path){
  const cached=photoUrlCache.get(path);
  if(cached && cached.expiresAt>Date.now()+30_000) return cached.url;
  const result=await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 900);
  if(result.error) throw result.error;
  photoUrlCache.set(path, {url:result.data.signedUrl, expiresAt:Date.now()+840_000});
  return result.data.signedUrl;
}

window.bfHydrateProofs = async (root=document)=>{
  if(!sb || !user) return;
  const nodes=[...root.querySelectorAll('img[data-proof-path]')];
  await Promise.allSettled(nodes.map(async node=>{
    const path=proofPath(node.dataset.proofPath);
    if(!path || node.dataset.proofReady==='1') return;
    const url=await signedProofUrl(path);
    node.src=url;
    node.dataset.proofReady='1';
  }));
};

window.bfReplaceSnapshot = async (snapshot, metadata={})=>{
  if(!sb || !user || !activeOrg) throw new Error('Connexion sécurisée requise.');
  if(!['owner','admin'].includes(activeRole)){
    throw new Error('Seul un propriétaire ou un administrateur peut restaurer les données.');
  }

  const result = await sb.rpc('bf_replace_snapshot', {
    p_org_id:activeOrg.org_id,
    p_snapshot:snapshot,
    p_metadata:metadata
  });
  if(result.error){
    console.warn('replace snapshot', result.error);
    throw new Error(
      String(result.error.message||'').includes('forbidden')
        ? 'Vous n’avez pas l’autorisation de restaurer cet espace.'
        : 'La restauration sécurisée a échoué. Les données précédentes sont conservées.'
    );
  }

  Store.cloudSync=null;
  try{
    Store.applyCloud(await fetchAll());
    setDot('ok', 'À jour');
  }catch(error){
    console.warn('snapshot refresh', error);
    Store.data=snapshot;
    localStorage.setItem(Store.storageKey(), JSON.stringify(Store.data));
    initSelects();
    renderAll();
    setDot('local', 'À resynchroniser');
  }finally{
    Store.cloudSync=schedulePush;
  }
  await loadMembers();
  await loadSnapshots();
  renderBanner();
  return result.data;
};

window.bfRestoreSnapshot = async snapshotId=>{
  if(!sb || !user || !activeOrg) throw new Error('Connexion sécurisée requise.');
  if(!['owner','admin'].includes(activeRole)){
    throw new Error('Seul un propriétaire ou un administrateur peut récupérer les données.');
  }
  const result=await sb.rpc('bf_restore_snapshot', {
    p_org_id:activeOrg.org_id,
    p_snapshot_id:snapshotId
  });
  if(result.error){
    console.warn('restore snapshot', result.error);
    throw new Error('La récupération sécurisée a échoué. Les données actuelles sont conservées.');
  }

  Store.cloudSync=null;
  try{
    Store.applyCloud(await fetchAll());
    setDot('ok', 'À jour');
  }catch(error){
    console.warn('recovery refresh', error);
    setDot('local', 'À resynchroniser');
  }finally{
    Store.cloudSync=schedulePush;
  }
  await loadMembers();
  await loadSnapshots();
  renderBanner();
  return result.data;
};

function subscribe(){
  if(!sb || !activeOrg) return;
  if(realtimeChannel) sb.removeChannel(realtimeChannel);
  const orgId=activeOrg.org_id;
  const orgFilter = `org_id=eq.${orgId}`;
  realtimeChannel = sb.channel(`bestfriend-${orgId}`);
  Object.values(TABLES).forEach(table=>{
    realtimeChannel.on('postgres_changes', {
      event:'*', schema:'public', table:table.remote, filter:orgFilter
    }, ()=>schedulePull(orgId));
  });
  realtimeChannel.on('postgres_changes', {
    event:'*', schema:'public', table:'bf_members', filter:orgFilter
  }, ()=>{
    if(activeOrg?.org_id===orgId) loadMembers();
  });
  realtimeChannel.subscribe();
}

window.addEventListener('online', ()=>{
  if(user && activeOrg){
    setDot('local', 'Resynchronisation…');
    pushAll();
  }
});
window.addEventListener('offline', ()=>{
  if(user && activeOrg) setDot('local', 'Hors-ligne · lecture seule');
});

function schedulePull(expectedOrgId=activeOrg?.org_id){
  if(Date.now()<suppressUntil) return;
  clearTimeout(pullTimer);
  pullTimer = setTimeout(async()=>{
    pullTimer=null;
    if(!expectedOrgId || activeOrg?.org_id!==expectedOrgId) return;
    try{
      const payload=await fetchAllForOrganization(activeOrg);
      if(activeOrg?.org_id!==expectedOrgId) return;
      cloudIds=payload.ids;
      Store.applyCloud(payload.data);
      setDot('ok', 'À jour');
    }catch(error){
      console.warn('sync pull', error);
      if(activeOrg?.org_id===expectedOrgId) setDot('local', 'Hors-ligne');
    }
  }, 400);
}

initialize().catch(error=>{
  console.error('Best Friend cloud bootstrap', error);
  setDot('local', 'Hors-ligne');
});

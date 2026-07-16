import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '@playwright/test';

const root=resolve(import.meta.dirname, '..');
const output=resolve(root, 'docs/onboarding-assets');
const base='http://127.0.0.1:4173';

function day(offset){
  const value=new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate()+offset);
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
}

const data={
  organization:{
    id:'org-demo', name:'Espace Démonstration', brandName:'Best Friend',
    ownerLabel:'Responsable', ownerName:'Camille', signature:'L’équipe accueil'
  },
  apartments:[
    {id:'apt-republique',name:'Appartement République',ref:'REP-01',gestion:'Équipe Centre',address:'12 avenue de la République, Paris',url:'https://example.com/annonce-republique',color:'#007AFF',active:true},
    {id:'apt-lilas',name:'Maison des Lilas',ref:'LIL-02',gestion:'Équipe Jardin',address:'8 allée des Lilas, Vincennes',url:'https://example.com/annonce-lilas',color:'#1D8F4F',active:true},
    {id:'apt-opera',name:'Studio Opéra',ref:'OPE-03',gestion:'Équipe Centre',address:'24 rue de la Paix, Paris',url:'https://example.com/annonce-opera',color:'#C9A227',active:true}
  ],
  reservations:[
    {id:'res-1',aptId:'apt-republique',channel:'Airbnb',guest:'Léa Martin',phone:'+33 6 10 20 30 40',guests:2,arrival:day(-2),departure:day(2),amount:720,cleaning:60,status:'Confirmé',notes:'Arrivée autonome à partir de 16 h.'},
    {id:'res-2',aptId:'apt-lilas',channel:'Booking.com',guest:'Thomas Bernard',phone:'+33 6 22 33 44 55',guests:4,arrival:day(-5),departure:day(0),amount:1150,cleaning:90,status:'Confirmé',notes:'Départ avant 11 h.'},
    {id:'res-3',aptId:'apt-opera',channel:'Direct',guest:'Nora Petit',phone:'+33 6 44 55 66 77',guests:2,arrival:day(0),departure:day(3),amount:780,cleaning:55,status:'Confirmé',notes:'Remise des clés en main propre.'},
    {id:'res-4',aptId:'apt-republique',channel:'Airbnb',guest:'Marc Leroy',phone:'+33 6 70 80 90 10',guests:3,arrival:day(8),departure:day(13),amount:1250,cleaning:70,status:'Confirmé',notes:''},
    {id:'res-5',aptId:'apt-lilas',channel:'HomeExchange',guest:'Famille Garcia',phone:'',guests:4,arrival:day(5),departure:day(9),amount:0,cleaning:0,isExchange:true,status:'Confirmé',notes:'Échange réciproque.'},
    {id:'res-6',aptId:'apt-opera',channel:'Booking.com',guest:'Alice Robert',phone:'+33 6 12 34 56 78',guests:2,arrival:day(16),departure:day(20),amount:920,cleaning:55,status:'Option',notes:'En attente de confirmation.'},
    {id:'res-7',aptId:'apt-lilas',channel:'Direct',guest:'Hugo Dubois',phone:'',guests:3,arrival:day(-38),departure:day(-32),amount:1380,cleaning:90,status:'Terminé',notes:''},
    {id:'res-8',aptId:'apt-republique',channel:'Airbnb',guest:'Emma Roux',phone:'',guests:2,arrival:day(-72),departure:day(-68),amount:840,cleaning:60,status:'Terminé',notes:''}
  ],
  interventions:[
    {id:'int-1',aptId:'apt-lilas',date:day(0),time:'11:30',who:'Sofia',type:'Ménage',desc:'Ménage de sortie',dur:2.5,cost:65,payMode:'Virement',payStatus:'En attente',payDate:'',invoice:'MEN-240',planned:true,kind:'service',notes:'Prévoir le linge de lit.'},
    {id:'int-2',aptId:'apt-opera',date:day(0),time:'14:00',who:'Nadia',type:'Check-in',desc:'Accueil voyageurs',dur:1,cost:25,payMode:'Virement',payStatus:'Payé',payDate:day(0),invoice:'ACC-118',planned:true,kind:'service',notes:''},
    {id:'int-3',aptId:'apt-republique',date:day(-1),time:'10:20',who:'Sofia',type:'Ménage',desc:'Ménage fait',dur:2,cost:55,payMode:'Virement',payStatus:'Payé',payDate:day(-1),invoice:'MEN-239',planned:false,kind:'task',notes:'8/8 points cochés',ts:`${day(-1)}T10:20:00`},
    {id:'int-4',aptId:'apt-republique',date:day(-2),time:'15:40',who:'Nadia',type:'Check-in',desc:'Check-in client OK',dur:0.75,cost:20,payMode:'Virement',payStatus:'Payé',payDate:day(-2),invoice:'ACC-117',planned:false,kind:'task',notes:'5/5 points cochés',ts:`${day(-2)}T15:40:00`},
    {id:'int-5',aptId:'apt-lilas',date:day(-7),time:'09:15',who:'Atelier Dépannage',type:'Plomberie',desc:'Remplacement du siphon',dur:1.5,cost:145,payMode:'Virement',payStatus:'En attente',payDate:'',invoice:'DEP-481',planned:false,kind:'service',notes:'Facture reçue.'},
    {id:'int-6',aptId:'apt-opera',date:day(-4),time:'12:10',who:'Sofia',type:'Linge',desc:'Linge livré',dur:0.5,cost:18,payMode:'Espèces',payStatus:'Payé',payDate:day(-4),invoice:'LIN-092',planned:false,kind:'task',notes:'Stock complet.',ts:`${day(-4)}T12:10:00`},
    {id:'int-7',aptId:'apt-lilas',date:day(-35),time:'10:00',who:'Sofia',type:'Ménage',desc:'Ménage complet',dur:3,cost:75,payMode:'Virement',payStatus:'Payé',payDate:day(-34),invoice:'MEN-211',planned:false,kind:'service',notes:''}
  ],
  contacts:[
    {id:'contact-1',name:'Sofia',role:'Ménage & linge',phone:'+33 6 11 22 33 44',email:'sofia@exemple.fr',notes:'Disponible du lundi au samedi.'},
    {id:'contact-2',name:'Nadia',role:'Accueil voyageurs',phone:'+33 6 55 66 77 88',email:'nadia@exemple.fr',notes:'Français / anglais.'},
    {id:'contact-3',name:'Atelier Dépannage',role:'Maintenance',phone:'+33 1 40 50 60 70',email:'depannage@exemple.fr',notes:'Urgences plomberie et serrurerie.'},
    {id:'__bf_settings',name:'(réglages internes)',role:'',phone:'',email:'',notes:'',icalFeeds:[{id:'feed-1',aptId:'apt-republique',channel:'Airbnb',url:'https://calendar.example.com/private/calendar.ics',createdAt:new Date().toISOString(),lastSync:new Date().toISOString()}]}
  ]
};

const members=[
  {email:'responsable@exemple.fr',name:'Camille',role:'owner',apt_ids:[],status:'active'},
  {email:'gestion@exemple.fr',name:'Alex',role:'manager',apt_ids:[],status:'active'},
  {email:'sofia@exemple.fr',name:'Sofia',role:'concierge',apt_ids:['apt-republique','apt-lilas'],status:'active'},
  {email:'nadia@exemple.fr',name:'Nadia',role:'concierge',apt_ids:['apt-opera'],status:'invited'}
];

async function waitForServer(){
  for(let attempt=0; attempt<80; attempt+=1){
    try{
      const response=await fetch(base, {redirect:'manual'});
      if(response.status<500) return;
    }catch{}
    await new Promise(resolveWait=>setTimeout(resolveWait, 125));
  }
  throw new Error('Le serveur de capture ne répond pas.');
}

async function quiet(page){
  await page.addStyleTag({content:'html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}header.app,.bottom-nav{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:#f7f7f9!important}'});
  await page.evaluate(()=>window.scrollTo(0, window.scrollY));
  await page.waitForTimeout(180);
}

async function seed(page, role='owner', apartmentIds=null, email='responsable@exemple.fr'){
  await page.evaluate(({payload,people,currentRole,ids,currentEmail})=>{
    window.MEMBERS=people;
    window.Store.namespace='onboarding';
    window.Store.data=JSON.parse(JSON.stringify(payload));
    window.setMe({
      email:currentEmail,
      role:currentRole,
      apts:ids,
      orgId:'org-demo',
      organization:payload.organization
    });
    document.getElementById('syncDot').className='sync-dot ok';
    document.getElementById('syncDot').textContent='À jour';
    document.getElementById('syncBanner').innerHTML='Connecté à <b>Espace Démonstration</b> · synchronisation automatique';
    document.getElementById('storeNote').textContent='Données synchronisées et protégées.';
  }, {payload:data,people:members,currentRole:role,ids:apartmentIds,currentEmail:email});
  await quiet(page);
}

async function shot(page, filename, options={}){
  await quiet(page);
  if(options.scroll){
    await page.locator(options.scroll).scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
  }else{
    await page.evaluate(()=>{ document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0,0); });
    await page.waitForTimeout(120);
  }
  if(options.locator){
    await page.locator(options.locator).screenshot({path:resolve(output, filename)});
    return;
  }
  await page.screenshot({path:resolve(output, filename), fullPage:Boolean(options.fullPage)});
}

await mkdir(output, {recursive:true});
const server=spawn(process.execPath, ['scripts/serve.mjs'], {cwd:root, stdio:['ignore','pipe','pipe']});
let serverError='';
server.stderr.on('data', chunk=>{ serverError+=chunk; });

const browser=await chromium.launch({headless:true});
try{
  await waitForServer();
  const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
  const page=await context.newPage();

  await page.goto(base, {waitUntil:'networkidle'});
  await quiet(page);
  await shot(page, '01-acces-prive.png');

  await page.evaluate(()=>window.openModal(`
    <h2 style="margin-bottom:8px">Connexion</h2>
    <p class="hint" style="margin-bottom:14px">Saisis l’adresse autorisée pour ton espace privé. Aucun mot de passe à retenir.</p>
    <div class="form"><div class="field wide"><label for="bf_login_email">Email</label><input id="bf_login_email" type="email" autocomplete="email" placeholder="toi@exemple.fr"></div></div>
    <div id="bf_login_message" class="hint" style="min-height:20px"></div>
    <div class="form-actions"><button class="btn primary">Recevoir mon lien</button><button class="btn ghost" onclick="closeModal()">Annuler</button></div>
  `));
  await quiet(page);
  await shot(page, '02-connexion.png', {locator:'#modal'});

  await page.goto(`${base}/?demo=1`, {waitUntil:'networkidle'});
  await seed(page);
  await page.evaluate(()=>window.navigateTo('home'));
  await shot(page, '03-tableau-de-bord.png');

  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.navigateTo('home'));
  await shot(page, '04-mobile.png');

  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>window.navigateTo('loc'));
  await shot(page, '05-locations.png');

  await page.evaluate(()=>window.gotoApt('apt-lilas'));
  await shot(page, '06-fiche-location.png');

  await page.evaluate(()=>window.taskChecklist('apt-lilas','Ménage'));
  await shot(page, '07-checklist.png', {locator:'#modal'});
  await page.evaluate(()=>window.closeModal());

  await page.evaluate(()=>window.navigateTo('res'));
  await shot(page, '08-reservations.png');

  await page.evaluate(()=>window.navigateTo('cal'));
  await page.locator('#calRange button[data-m="1"]').click();
  await shot(page, '09-calendrier.png');

  await page.evaluate(()=>window.navigateTo('res'));
  await page.locator('#resImportIcal').click();
  await shot(page, '10-ical.png', {locator:'#modal'});
  await page.evaluate(()=>window.closeModal());

  await page.evaluate(()=>window.navigateTo('int'));
  await shot(page, '11-interventions.png');

  await page.evaluate(()=>window.navigateTo('syn'));
  await shot(page, '12-synthese.png');

  await page.evaluate(()=>window.navigateTo('biens'));
  await shot(page, '13-biens-acces.png');

  await page.evaluate(()=>window.aptAdd());
  await shot(page, '14-ajouter-bien.png', {locator:'#modal'});
  await page.evaluate(()=>window.closeModal());

  await page.evaluate(()=>window.memberAdd());
  await shot(page, '15-ajouter-acces.png', {locator:'#modal'});
  await page.evaluate(()=>window.closeModal());

  await page.locator('#view-biens details').evaluate(element=>{ element.open=true; });
  await shot(page, '16-sauvegarde.png', {scroll:'#view-biens details'});

  const control=await context.newPage();
  await control.goto(`${base}/control?demo=1`, {waitUntil:'networkidle'});
  await seed(control);
  await shot(control, '17-centre-pilotage.png');
  await control.close();

  await page.setViewportSize({width:390,height:844});
  await seed(page, 'concierge', ['apt-lilas'], 'sofia@exemple.fr');
  await shot(page, '18-concierge-mobile.png');

  await context.close();
}finally{
  await browser.close();
  server.kill('SIGTERM');
}

if(serverError.trim()) console.warn(serverError.trim());
console.log('18 captures d’onboarding générées dans docs/onboarding-assets/.');

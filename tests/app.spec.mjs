import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('aperçu public sans données ni configuration technique', async ({page})=>{
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));

  await page.goto('/');
  await expect(page.locator('h1')).toContainText('BEST FRIEND');
  await expect(page.locator('#brandSub')).toHaveText('Pilotage propriétaire–conciergerie');
  await expect(page.locator('.loc-card')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Supabase');
  await expect(page.locator('body')).not.toContainText('API');
  await expect(page.locator('body')).not.toContainText(/démo|preview/i);

  const backendConfigured=await page.evaluate(()=>Boolean(
    window.BF_CONFIG?.supabaseUrl && window.BF_CONFIG?.supabaseAnonKey
  ));
  await page.locator('#btnConnect').click();
  if(backendConfigured){
    await expect(page.locator('#modal')).toContainText('Connexion');
    await expect(page.locator('#bf_login_email')).toBeVisible();
  }else{
    await expect(page.locator('#modal')).toContainText('Connexion indisponible');
  }
  expect(errors).toEqual([]);
});

test('démonstration générique opérationnelle', async ({page}, testInfo)=>{
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));

  await page.goto('/?demo=1');
  await expect(page.locator('#syncDot')).toHaveText('Démo');
  await expect(page.locator('#homeLocGrid .loc-card')).toHaveCount(2);
  await expect(page.locator('#homeLocGrid')).toContainText('Appartement Centre');
  await expect(page.locator('#homeLocGrid')).toContainText('Maison Jardin');

  const registration = await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    return Boolean(await navigator.serviceWorker.getRegistration());
  });
  expect(registration).toBe(true);

  await page.screenshot({
    path:testInfo.outputPath('best-friend-demo.png'),
    fullPage:true
  });
  expect(errors).toEqual([]);
});

test('guide utilisateur final accessible depuis l’assistance', async ({page})=>{
  await page.goto('/');
  const support=page.locator('#supportInfo');
  await support.click();
  await expect(page.locator('#modal')).toHaveAttribute('aria-labelledby', 'bfModalTitle');
  const guide=page.getByRole('link', {name:'Ouvrir le guide'});
  await expect(guide).toHaveAttribute('href', './Best-Friend-Guide.pdf');
  const response=await page.request.get('/Best-Friend-Guide.pdf');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/pdf');
  const body=await response.body();
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  expect(body.byteLength).toBeGreaterThan(20_000);
  await page.keyboard.press('Escape');
  await expect(support).toBeFocused();
});

test('aucun débordement horizontal sur mobile', async ({page})=>{
  await page.setViewportSize({width:390, height:844});
  await page.goto('/?demo=1');
  const dimensions = await page.evaluate(()=>({
    viewport:window.innerWidth,
    document:document.documentElement.scrollWidth
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport+1);
  await expect(page.locator('#bottomNav')).toBeVisible();
});

test('centre de pilotage dédié sans réglage technique', async ({page})=>{
  await page.goto('/control?demo=1');
  await expect(page.locator('#controlOverview')).toBeVisible();
  await expect(page.locator('#view-biens')).toHaveClass(/active/);
  await expect(page.locator('#controlOverview')).toContainText('Centre de pilotage');
  await expect(page.locator('#controlOverview')).toContainText('Aucun réglage technique');
  await expect(page.locator('#controlProperties')).toHaveText('2');
  await expect(page.locator('#btnCockpit')).toBeVisible();
});

test('un intervenant de l’annuaire préremplit un nouvel accès', async ({page})=>{
  await page.goto('/?demo=1');
  await page.evaluate(()=>{
    window.Store.data.contacts=[{
      id:'contact-annabella',
      name:'Annabella',
      role:'Conciergerie',
      phone:'',
      email:'annabella@exemple.fr',
      notes:''
    }];
    window.MEMBERS=[];
    window.setMe({
      email:'responsable@exemple.fr',
      role:'owner',
      apts:null,
      orgId:'org-test',
      organization:{name:'Espace test'}
    });
    window.navigateTo('biens');
  });

  await page.locator('#memberAdd').click();
  await expect(page.locator('#mb_directory')).toBeVisible();
  await page.locator('#mb_directory').selectOption('contact-annabella');
  await expect(page.locator('#mb_name')).toHaveValue('Annabella');
  await expect(page.locator('#mb_email')).toHaveValue('annabella@exemple.fr');
  await expect(page.locator('#mb_msg')).toContainText('annuaire');
});

test('un bien choisit son gestionnaire dans l’annuaire ou en saisie libre', async ({page})=>{
  await page.goto('/?demo=1');
  await page.evaluate(()=>{
    window.Store.data.contacts=[{
      id:'contact-annabelle',
      name:'Annabelle',
      role:'Conciergerie',
      phone:'',
      email:'annabelle@exemple.fr',
      notes:''
    }];
    window.MEMBERS=[{
      email:'bruno@exemple.fr',
      name:'Bruno',
      role:'owner',
      apt_ids:[],
      status:'active'
    }];
    window.setMe({
      email:'bruno@exemple.fr',
      role:'owner',
      apts:null,
      orgId:'org-test',
      organization:{name:'Espace test'}
    });
    window.navigateTo('biens');
  });

  await page.evaluate(()=>window.aptAdd());
  await expect(page.locator('#m_gestion_choice')).toContainText('Bruno · moi');
  await expect(page.locator('#m_gestion_choice')).toContainText('Annabelle · Conciergerie');
  await page.locator('#m_gestion_choice').selectOption({label:'Annabelle · Conciergerie'});
  await expect(page.locator('#m_gestion')).toBeHidden();
  await page.locator('#m_gestion_choice').selectOption('__other__');
  await expect(page.locator('#m_gestion')).toBeVisible();
  await page.locator('#m_gestion').fill('Gestion externe');
});

test('pont historique à un clic avec sauvegarde vérifiée', async ({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    localStorage.setItem('gites_v2', JSON.stringify({
      apartments:[{id:'legacy-apt',name:'Bien historique',active:true}],
      reservations:[{id:'legacy-booking',aptId:'legacy-apt',guest:'Voyageur'}],
      interventions:[{id:'legacy-task',aptId:'legacy-apt',type:'Ménage'}],
      contacts:[]
    }));
  });

  await page.goto('/migration/');
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#exportButton').click();
  const download=await downloadPromise;
  await expect(page.locator('#status')).toContainText('Sauvegarde prête');
  const path=await download.path();
  const exported=JSON.parse(await readFile(path,'utf8'));
  expect(exported.format).toBe('best-friend-backup');
  expect(exported.integrity.algorithm).toBe('SHA-256');
  expect(exported.counts).toEqual({
    apartments:1,
    reservations:1,
    interventions:1,
    contacts:0
  });
});

import {expect, test} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';

await import('../backup.js');
const Backup=globalThis.BFBackup;

const mailpitUrl = process.env.BF_LOCAL_MAILPIT_URL;
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const ownerEmail = `owner.ui.${runId}@best-friend.test`;
const secondOwnerEmail = `second-owner.ui.${runId}@best-friend.test`;
const conciergeEmail = `concierge.ui.${runId}@best-friend.test`;
const unauthorizedEmail = `unauthorized.ui.${runId}@best-friend.test`;
const preparedOwnerEmail = `prepared-owner.ui.${runId}@best-friend.test`;
const preparedTenantKey = `prepared-${runId}`;

async function removeStoragePrefix(client, prefix){
  const {data, error}=await client.storage.from('bf-proofs').list(prefix, {
    limit:1_000,
    sortBy:{column:'name', order:'asc'}
  });
  if(error) throw error;
  const files=[];
  for(const item of data || []){
    const path=prefix ? `${prefix}/${item.name}` : item.name;
    if(item.id) files.push(path);
    else await removeStoragePrefix(client, path);
  }
  if(files.length){
    const {error:removeError}=await client.storage.from('bf-proofs').remove(files);
    if(removeError) throw removeError;
  }
}

async function cleanup(){
  for(const email of [
    ownerEmail,
    secondOwnerEmail,
    conciergeEmail,
    unauthorizedEmail,
    preparedOwnerEmail
  ]){
    if(!/^[a-z0-9.@-]+$/.test(email)) throw new Error('Email de test invalide.');
  }
  const emails = new Set([
    ownerEmail,
    secondOwnerEmail,
    conciergeEmail,
    unauthorizedEmail,
    preparedOwnerEmail
  ]);
  const url=String(process.env.BF_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey=process.env.BF_SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !serviceKey){
    console.warn('Nettoyage UI incomplet: configuration locale absente.');
    return;
  }
  const client=createClient(url, serviceKey, {
    auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}
  });
  try{
    const users=[];
    for(let page=1;;page+=1){
      const {data,error}=await client.auth.admin.listUsers({page, perPage:1_000});
      if(error) throw error;
      users.push(...(data.users || []).filter(user=>emails.has(user.email)));
      if((data.users || []).length<1_000) break;
    }
    const userIds=users.map(user=>user.id);
    if(userIds.length){
      const {data:organizations,error:orgError}=await client
        .from('bf_organizations')
        .select('id')
        .in('created_by', userIds);
      if(orgError) throw orgError;
      for(const organization of organizations || []){
        await removeStoragePrefix(client, organization.id);
      }
      if(organizations?.length){
        const {error:deleteError}=await client
          .from('bf_organizations')
          .delete()
          .in('id', organizations.map(organization=>organization.id));
        if(deleteError) throw deleteError;
      }
      for(const user of users){
        const {error}=await client.auth.admin.deleteUser(user.id);
        if(error) throw error;
      }
    }
  }catch(error){
    console.warn('Nettoyage UI incomplet:', error.message || String(error));
  }
}

function provisionOwner({
  tenantKey,
  email,
  tenantName,
  ownerName='Propriétaire préparé',
  sendMagicLink=false
}){
  const result=spawnSync(process.execPath, ['scripts/provision-tenant.mjs'], {
    encoding:'utf8',
    env:{
      ...process.env,
      BF_TENANT_KEY:tenantKey,
      BF_TENANT_OWNER_EMAIL:email,
      BF_TENANT_NAME:tenantName,
      BF_TENANT_OWNER_NAME:ownerName,
      BF_TENANT_CONFIRM:'PROVISION',
      BF_TENANT_SEND_MAGIC_LINK:sendMagicLink?'YES':'',
      BF_SITE_URL:'http://127.0.0.1:4173'
    }
  });
  if(result.status!==0){
    throw new Error(
      'Provisionnement UI impossible : '+(result.stderr||result.stdout).trim()
    );
  }
  return JSON.parse(result.stdout);
}

async function createAuthorizedUser(email){
  const url=String(process.env.BF_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey=process.env.BF_SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !serviceKey) throw new Error('Configuration Auth locale absente.');
  const response=await fetch(`${url}/auth/v1/admin/users`, {
    method:'POST',
    headers:{
      apikey:serviceKey,
      Authorization:`Bearer ${serviceKey}`,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      email,
      password:`Bf-${crypto.randomUUID()}-9!`,
      email_confirm:true,
      user_metadata:{source:'best-friend-ui-test'}
    })
  });
  if(!response.ok){
    throw new Error(`Création Auth impossible : HTTP ${response.status}`);
  }
  return response.json();
}

async function magicLinkFor(email){
  const deadline = Date.now()+15_000;
  while(Date.now()<deadline){
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    if(!response.ok) throw new Error(`Mailpit HTTP ${response.status}`);
    const list = await response.json();
    const message = (list.messages || []).find(item=>{
      const recipients = item.To || item.to || [];
      return recipients.some(recipient=>{
        const address = typeof recipient==='string'
          ? recipient
          : recipient.Address || recipient.address;
        return address?.toLowerCase()===email;
      });
    });
    if(message){
      const id = message.ID || message.Id || message.id;
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
      if(!detailResponse.ok) throw new Error(`Mailpit message HTTP ${detailResponse.status}`);
      const detail = await detailResponse.json();
      const content = JSON.stringify(detail)
        .replaceAll('\\u0026', '&')
        .replaceAll('&amp;', '&');
      const links = content.match(/https?:\\?\/\\?\/[^"'<>\s]+/g) || [];
      const link = links
        .map(value=>value.replaceAll('\\/', '/').replace(/[\\),.]+$/, ''))
        .find(value=>{
          try{
            const parsed=new URL(value);
            return parsed.pathname.endsWith('/auth/v1/verify')
              && Boolean(parsed.searchParams.get('token'))
              && Boolean(parsed.searchParams.get('type'));
          }catch{
            return false;
          }
        });
      if(link) return link;
    }
    await new Promise(resolve=>setTimeout(resolve, 250));
  }
  throw new Error(`Lien de connexion complet non reçu pour ${email}`);
}

async function requestMagicLink(page, email){
  await page.goto('/');
  await page.waitForFunction(()=>typeof window.bfShowLogin==='function');
  await expect(page.locator('#syncDot')).toHaveText('Non connecté', {timeout:15_000});
  await page.locator('#gateConnect').click();
  await page.locator('#bf_login_email').fill(email);
  await page.locator('#bf_send_link').click();
  await expect(page.locator('#bf_login_message')).toContainText('adresse est autorisée');
  return magicLinkFor(email);
}

async function importBackupThroughUi(page, envelope){
  await page.locator('#fileImport').setInputFiles({
    name:'best-friend-import-test.json',
    mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(envelope))
  });
  await expect(page.locator('#modal')).toContainText('Vérifier avant la restauration');
  await expect(page.locator('#modal')).toContainText('fichier intact');
  const safetyDownload=page.waitForEvent('download');
  const successDialog=page.waitForEvent('dialog');
  await page.locator('#confirmBackupImport').click();
  await safetyDownload;
  const dialog=await successDialog;
  expect(dialog.message()).toContain('Restauration terminée');
  await dialog.accept();
}

test.afterAll(cleanup);

test('aucune donnée locale privée ne paraît sans session', async ({page})=>{
  const cachedUser='00000000-0000-4000-8000-000000000001';
  const namespace=cachedUser+':00000000-0000-4000-8000-000000000002';
  const marker='BIEN PRIVÉ HORS SESSION';

  await page.goto('/');
  await expect(page.locator('#syncDot')).toHaveText('Non connecté', {timeout:15_000});
  await page.evaluate(({cachedUser, namespace, marker})=>{
    localStorage.setItem('bestfriend:last_context', JSON.stringify({
      userId:cachedUser,
      namespace,
      email:'ancien@example.test',
      role:'owner',
      apts:null,
      orgId:'00000000-0000-4000-8000-000000000002',
      organization:{name:'Ancien espace'}
    }));
    localStorage.setItem('bestfriend_v4:'+namespace, JSON.stringify({
      organization:{name:'Ancien espace'},
      apartments:[{id:'private-marker', name:marker, active:true}],
      reservations:[],
      interventions:[],
      contacts:[]
    }));
  }, {cachedUser, namespace, marker});

  await page.reload();
  await expect(page.locator('#syncDot')).toHaveText('Non connecté', {timeout:15_000});
  await expect(page.locator('#authGate')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(marker);
  await expect(page.locator('.loc-card')).toHaveCount(0);
});

test('un compte sans espace ne peut pas s’auto-attribuer un accès', async ({page})=>{
  await createAuthorizedUser(unauthorizedEmail);
  const link=await requestMagicLink(page, unauthorizedEmail);
  await page.goto(link);
  await expect(page.locator('#syncDot')).toHaveText('Accès non attribué', {timeout:15_000});
  await expect(page.locator('#modal')).toContainText('Accès non attribué');
  await expect(page.locator('#modal')).not.toContainText('Créer');
  await expect(page.locator('.loc-card')).toHaveCount(0);
});

test('un propriétaire préparé arrive directement dans son espace', async ({page})=>{
  const first=provisionOwner({
    tenantKey:preparedTenantKey,
    email:preparedOwnerEmail,
    tenantName:'Espace Préparé UI',
    ownerName:'Propriétaire Préparé',
    sendMagicLink:true
  });
  expect(first.provisioned).toBe(true);
  expect(first.accountCreated).toBe(true);
  expect(first.organizationCreated).toBe(true);
  expect(first.magicLink).toBe('sent');

  const link=await magicLinkFor(preparedOwnerEmail);
  await page.goto(link);
  await expect(page.locator('#syncDot')).toHaveText('À jour', {timeout:15_000});
  await expect(page.locator('#roleBadge')).toContainText('Propriétaire');
  await expect(page.locator('#brandSub')).toContainText('Espace Préparé UI');
  await expect(page.locator('#modal')).not.toContainText('Créer ton espace');
  await expect(page.locator('.loc-card')).toHaveCount(0);

  await page.goto('/control');
  await expect(page.locator('#controlOverview')).toBeVisible();
  await expect(page.locator('#controlProperties')).toHaveText('0');

  const replay=provisionOwner({
    tenantKey:preparedTenantKey,
    email:preparedOwnerEmail,
    tenantName:'Espace Préparé UI',
    ownerName:'Propriétaire Préparé'
  });
  expect(replay.accountCreated).toBe(false);
  expect(replay.organizationId).toBe(first.organizationId);
  expect(replay.organizationCreated).toBe(false);
  expect(replay.magicLink).toBe('not_requested');
});

test('parcours réel propriétaire puis concierge sans réglage technique', async ({browser})=>{
  await createAuthorizedUser(conciergeEmail);
  const ownerProvision=provisionOwner({
    tenantKey:`owner-${runId}`,
    email:ownerEmail,
    tenantName:'Locations Alpha Test',
    ownerName:'Propriétaire Alpha',
    sendMagicLink:true
  });
  expect(ownerProvision.provisioned).toBe(true);

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const pageErrors = [];
  ownerPage.on('pageerror', error=>pageErrors.push(error.message));

  const ownerLink = await magicLinkFor(ownerEmail);
  await ownerPage.goto(ownerLink);

  await expect(ownerPage.locator('#roleBadge')).toContainText('Propriétaire');
  await expect(ownerPage.locator('#brandSub')).toContainText('Locations Alpha Test');
  await expect(ownerPage.locator('#syncDot')).toHaveText('À jour');

  await ownerPage.locator('.tab[data-view="biens"]').click();
  await ownerPage.locator('#aptAdd').click();
  await ownerPage.locator('#m_name').fill('Appartement Opéra');
  await ownerPage.locator('#m_ref').fill('OPERA');
  await ownerPage.locator('#m_address').fill('Paris');
  await ownerPage.locator('#modal button.primary').click();
  await expect(ownerPage.locator('#biensList')).toContainText('Appartement Opéra');

  // Le rechargement prouve que le bien est revenu du cloud, pas seulement du cache UI.
  await ownerPage.waitForTimeout(1_200);
  await ownerPage.reload();
  await expect(ownerPage.locator('#roleBadge')).toContainText('Propriétaire');
  await ownerPage.locator('.tab[data-view="biens"]').click();
  await expect(ownerPage.locator('#biensList')).toContainText('Appartement Opéra');

  await ownerPage.locator('.tab[data-view="loc"]').click();
  await ownerPage.locator('#locContent .loc-card').filter({hasText:'Appartement Opéra'}).click();
  const fileChooserPromise=ownerPage.waitForEvent('filechooser');
  await ownerPage.locator('#locContent .btn.photo').first().click();
  const fileChooser=await fileChooserPromise;
  await fileChooser.setFiles({
    name:'preuve.png',
    mimeType:'image/png',
    buffer:Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await expect(ownerPage.locator('#locContent img[data-proof-path]')).toHaveCount(1, {
    timeout:15_000
  });
  await ownerPage.waitForTimeout(1_200);
  await ownerPage.reload();
  await ownerPage.locator('.tab[data-view="loc"]').click();
  await ownerPage.locator('#locContent .loc-card').filter({hasText:'Appartement Opéra'}).click();
  const hydratedProof=ownerPage.locator('#locContent img[data-proof-path]');
  await expect(hydratedProof).toHaveCount(1);
  await expect(hydratedProof).toHaveAttribute('src', /storage\/v1\/object\/sign/, {
    timeout:15_000
  });
  await ownerPage.locator('.tab[data-view="int"]').click();
  const proofRow=ownerPage.locator('#intTable tbody tr').filter({hasText:'Ménage fait'});
  await expect(proofRow).toHaveCount(1);
  ownerPage.once('dialog', dialog=>dialog.accept());
  await proofRow.locator('button.danger').click();
  await expect(proofRow).toHaveCount(0);

  const importEnvelope=await Backup.createEnvelope({
    organization:{name:'Nom source à ne pas importer'},
    apartments:[
      {id:'imported-property',name:'Appartement Importé',active:true}
    ],
    reservations:[
      {
        id:'imported-booking',
        aptId:'imported-property',
        guest:'Voyageur Importé',
        status:'Confirmé'
      }
    ],
    interventions:[],
    contacts:[]
  }, {source:'playwright'});
  await importBackupThroughUi(ownerPage, importEnvelope);
  await expect(ownerPage.locator('#biensList')).toContainText('Appartement Importé');
  await expect(ownerPage.locator('#biensList')).not.toContainText('Appartement Opéra');
  await ownerPage.locator('.tab[data-view="biens"]').click();
  await ownerPage.locator('summary').filter({hasText:'Assistance et sauvegarde'}).click();
  await expect(ownerPage.locator('#btnRecover')).toBeVisible();

  await ownerPage.locator('#btnRecover').click();
  await expect(ownerPage.locator('#modal')).toContainText('Annuler la dernière restauration');
  const recoveryDialog=ownerPage.waitForEvent('dialog');
  await ownerPage.locator('#confirmRecovery').click();
  const recovered=await recoveryDialog;
  expect(recovered.message()).toContain('état précédent');
  await recovered.accept();
  await expect(ownerPage.locator('#biensList')).toContainText('Appartement Opéra');

  await importBackupThroughUi(ownerPage, importEnvelope);
  await expect(ownerPage.locator('#biensList')).toContainText('Appartement Importé');
  await ownerPage.reload();
  await ownerPage.locator('.tab[data-view="biens"]').click();
  await expect(ownerPage.locator('#biensList')).toContainText('Appartement Importé');

  await ownerPage.locator('#memberAdd').click();
  await ownerPage.locator('#mb_name').fill('Conciergerie Opéra');
  await ownerPage.locator('#mb_email').fill(conciergeEmail);
  await ownerPage.locator('#mb_role').selectOption('concierge');
  await ownerPage.locator('#mb_apts input').check();
  await ownerPage.locator('#modal button.primary').click();
  await expect(ownerPage.locator('#membersTable')).toContainText(conciergeEmail);

  await ownerPage.goto('/control');
  await expect(ownerPage.locator('#controlOverview')).toBeVisible();
  await expect(ownerPage.locator('#controlProperties')).toHaveText('1');
  await expect(ownerPage.locator('#controlMembers')).toHaveText('1');
  await expect(ownerPage.locator('#controlInvites')).toHaveText('1');

  const secondOwnerContext = await browser.newContext();
  const secondOwnerPage = await secondOwnerContext.newPage();
  secondOwnerPage.on('pageerror', error=>pageErrors.push(error.message));
  provisionOwner({
    tenantKey:`second-owner-${runId}`,
    email:secondOwnerEmail,
    tenantName:'Locations Bêta Test',
    ownerName:'Propriétaire Bêta',
    sendMagicLink:true
  });
  const secondOwnerLink = await magicLinkFor(secondOwnerEmail);
  await secondOwnerPage.goto(secondOwnerLink);
  await expect(secondOwnerPage.locator('#roleBadge')).toContainText('Propriétaire');

  await secondOwnerPage.locator('.tab[data-view="biens"]').click();
  await secondOwnerPage.locator('#aptAdd').click();
  await secondOwnerPage.locator('#m_name').fill('Maison Rivoli');
  await secondOwnerPage.locator('#m_ref').fill('RIVOLI');
  await secondOwnerPage.locator('#m_address').fill('Paris');
  await secondOwnerPage.locator('#modal button.primary').click();
  await expect(secondOwnerPage.locator('#biensList')).toContainText('Maison Rivoli');
  await secondOwnerPage.waitForTimeout(1_200);
  await secondOwnerPage.reload();
  await secondOwnerPage.locator('.tab[data-view="biens"]').click();
  await expect(secondOwnerPage.locator('#biensList')).toContainText('Maison Rivoli');

  await secondOwnerPage.locator('#memberAdd').click();
  await secondOwnerPage.locator('#mb_name').fill('Conciergerie partagée');
  await secondOwnerPage.locator('#mb_email').fill(conciergeEmail);
  await secondOwnerPage.locator('#mb_role').selectOption('concierge');
  await secondOwnerPage.locator('#mb_apts input').check();
  await secondOwnerPage.locator('#modal button.primary').click();
  await expect(secondOwnerPage.locator('#membersTable')).toContainText(conciergeEmail);

  const conciergeContext = await browser.newContext();
  const conciergePage = await conciergeContext.newPage();
  conciergePage.on('pageerror', error=>pageErrors.push(error.message));
  const conciergeLink = await requestMagicLink(conciergePage, conciergeEmail);
  await conciergePage.goto(conciergeLink);

  await expect(conciergePage.locator('#roleBadge')).toContainText('Concierge');
  await expect(conciergePage.locator('#locContent')).toContainText('Appartement Importé');
  await expect(conciergePage.locator('.tab[data-view="biens"]')).toBeHidden();
  await expect(conciergePage.locator('#btnImport')).toBeHidden();
  await expect(conciergePage.locator('#btnReset')).toBeHidden();
  await expect(conciergePage.locator('#userChip')).toContainText(conciergeEmail);
  await expect(conciergePage.locator('#btnOrganization')).toBeVisible();
  await expect(conciergePage.locator('#btnOrganization')).toContainText('Locations Alpha Test');

  await conciergePage.locator('#btnOrganization').click();
  await expect(conciergePage.locator('#modal')).toContainText('Mes espaces');
  await conciergePage.locator('.bf-org-choice')
    .filter({hasText:'Locations Bêta Test'})
    .click();
  await expect(conciergePage.locator('#brandSub')).toContainText('Locations Bêta Test');
  await expect(conciergePage.locator('#locContent')).toContainText('Maison Rivoli');
  await expect(conciergePage.locator('#locContent')).not.toContainText('Appartement Importé');
  await expect(conciergePage.locator('#btnOrganization')).toContainText('Locations Bêta Test');

  await conciergePage.locator('#btnOrganization').click();
  await conciergePage.locator('.bf-org-choice')
    .filter({hasText:'Locations Alpha Test'})
    .click();
  await expect(conciergePage.locator('#brandSub')).toContainText('Locations Alpha Test');
  await expect(conciergePage.locator('#locContent')).toContainText('Appartement Importé');
  await expect(conciergePage.locator('#locContent')).not.toContainText('Maison Rivoli');

  await ownerPage.reload();
  await expect(ownerPage.locator('#controlMembers')).toHaveText('2');
  await expect(ownerPage.locator('#controlInvites')).toHaveText('0');

  await conciergeContext.close();
  await secondOwnerContext.close();
  await ownerContext.close();
  expect(pageErrors).toEqual([]);
});

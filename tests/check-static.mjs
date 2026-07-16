import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const cloud = await readFile(resolve(root, 'app-cloud.js'), 'utf8');
const backup = await readFile(resolve(root, 'backup.js'), 'utf8');
const config = await readFile(resolve(root, 'config.js'), 'utf8');
const worker = await readFile(resolve(root, 'worker/index.js'), 'utf8');
const privateMigration = await readFile(
  resolve(root, 'supabase/migrations/20260715_003_private_delivery_and_proofs.sql'),
  'utf8'
);
const legacyBridge = await readFile(resolve(root, 'legacy-bridge/index.html'), 'utf8');
const tenantProvision = await readFile(
  resolve(root, 'scripts/provision-tenant.mjs'),
  'utf8'
);
const backendValidator = await readFile(
  resolve(root, 'scripts/validate-backend.mjs'),
  'utf8'
);
const userGuide = await readFile(
  resolve(root, 'docs/GUIDE-UTILISATEUR.html'),
  'utf8'
);
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.webmanifest'), 'utf8'));
const headers = await readFile(resolve(root, '_headers'), 'utf8');
const redirects = await readFile(resolve(root, '_redirects'), 'utf8');
const wrangler = await readFile(resolve(root, 'wrangler.toml'), 'utf8');

const forbidden = [
  /api\.callmebot/i,
  /https:\/\/esm\.sh/i,
  /api\.allorigins/i,
  /shouldCreateUser\s*:\s*true/i,
  /33695710501/,
  /rujozrissqjvvhghltix/,
  /sb_publishable_[A-Za-z0-9_-]+/
];
for(const pattern of forbidden){
  if(pattern.test(index+cloud+backup+config+legacyBridge)){
    throw new Error(`Configuration interdite détectée : ${pattern}`);
  }
}

const classicMatch = index.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
if(!classicMatch) throw new Error('Script principal introuvable.');
const syntax = spawnSync(process.execPath, ['--check', '-'], {
  input:classicMatch[1], encoding:'utf8'
});
if(syntax.status!==0) throw new Error(syntax.stderr || 'JavaScript principal invalide.');

const cloudSyntax = spawnSync(process.execPath, ['--check', resolve(root, 'app-cloud.js')], {
  encoding:'utf8'
});
if(cloudSyntax.status!==0) throw new Error(cloudSyntax.stderr || 'Module cloud invalide.');

const backupSyntax = spawnSync(process.execPath, ['--check', resolve(root, 'backup.js')], {
  encoding:'utf8'
});
if(backupSyntax.status!==0) throw new Error(backupSyntax.stderr || 'Module de sauvegarde invalide.');

const tenantProvisionSyntax = spawnSync(
  process.execPath,
  ['--check', resolve(root, 'scripts/provision-tenant.mjs')],
  {encoding:'utf8'}
);
if(tenantProvisionSyntax.status!==0){
  throw new Error(tenantProvisionSyntax.stderr || 'Provisionnement opérateur invalide.');
}
if(!tenantProvision.includes("BF_TENANT_CONFIRM==='PROVISION'")){
  throw new Error('Confirmation explicite absente du provisionnement opérateur.');
}

const backendValidatorSyntax = spawnSync(
  process.execPath,
  ['--check', resolve(root, 'scripts/validate-backend.mjs')],
  {encoding:'utf8'}
);
if(backendValidatorSyntax.status!==0){
  throw new Error(backendValidatorSyntax.stderr || 'Validateur backend invalide.');
}
if(
  !backendValidator.includes("confirmation==='RUN'")
  || !backendValidator.includes("environment==='validation'")
){
  throw new Error('Garde de validation distante absente.');
}

const legacyScript = [...legacyBridge.matchAll(/<script>\s*([\s\S]*?)\s*<\/script>/g)].at(-1)?.[1];
if(!legacyScript) throw new Error('Script du pont historique introuvable.');
const legacySyntax = spawnSync(process.execPath, ['--check', '-'], {
  input:legacyScript, encoding:'utf8'
});
if(legacySyntax.status!==0) throw new Error(legacySyntax.stderr || 'Pont historique invalide.');

if(manifest.display!=='standalone') throw new Error('Manifest non installable.');
if(!index.includes('navigator.serviceWorker.register')) throw new Error('Service worker non enregistré.');
if(!index.includes('noindex,nofollow,noarchive')) throw new Error('Indexation privée non bloquée.');
if(!headers.includes('X-Robots-Tag: noindex, nofollow, noarchive')){
  throw new Error('En-tête anti-indexation absent.');
}
if(!headers.includes('Strict-Transport-Security: max-age=31536000')){
  throw new Error('HSTS absent.');
}
if(redirects.includes('/* /index.html')) throw new Error('Redirection SPA Pages invalide.');
if(!wrangler.includes('compatibility_date = "2026-07-15"')){
  throw new Error('Date de compatibilité Worker non figée.');
}
if(!index.includes('app-cloud.js')) throw new Error('Module cloud non chargé.');
if(!index.includes('backup.js')) throw new Error('Module de sauvegarde non chargé.');
if(!cloud.includes('shouldCreateUser:false')) throw new Error('Auto-inscription non verrouillée.');
if(cloud.includes('bf_create_organization')) throw new Error('Création libre d’espace encore présente.');
if(!worker.includes("url.pathname==='/api/ical'")) throw new Error('Proxy iCal privé absent.');
if(!worker.includes("url.pathname==='/api/invite'")) throw new Error('Service d’invitation absent.');
if(!worker.includes('secureAssetResponse')) throw new Error('En-têtes Worker absents.');
if(!worker.includes("'X-Robots-Tag':'noindex, nofollow, noarchive'")){
  throw new Error('Anti-indexation Worker absente.');
}
if(!privateMigration.includes("'bf-proofs'")) throw new Error('Stockage privé des preuves absent.');
if(!privateMigration.includes('revoke all on function public.bf_create_organization')){
  throw new Error('Privilèges de création libre non retirés.');
}
if(!index.includes('./Best-Friend-Guide.pdf')) throw new Error('Guide utilisateur inaccessible.');
if(
  !index.includes("Choisir depuis l'annuaire")
  || !index.includes('memberAddFromContact')
  || !index.includes('memberFromContact')
){
  throw new Error('Passerelle annuaire vers accès absente.');
}
if(!index.includes('data-view="biens">Biens &amp; gens</button>')){
  throw new Error('Libellé Biens & gens absent de la navigation.');
}
if(
  !index.includes('managerDirectoryChoices')
  || !index.includes('m_gestion_choice')
  || !index.includes('Autre nom…')
){
  throw new Error('Sélecteur de gestionnaire depuis l’annuaire absent.');
}
if(
  !userGuide.includes('Sans mot de passe')
  || !userGuide.includes('Hors connexion')
  || !userGuide.includes('stockage privé')
){
  throw new Error('Guide utilisateur privé incomplet.');
}
for(const obsolete of [
  /frnctl\.github\.io\/gites/i,
  /première connexion crée le compte/i,
  /CallMeBot/i,
  /informations partent dès le retour du réseau/i
]){
  if(obsolete.test(userGuide)) throw new Error(`Guide utilisateur obsolète : ${obsolete}`);
}

console.log('OK: configuration, syntaxe JavaScript et socle PWA validés');

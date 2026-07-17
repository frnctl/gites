import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const assets = [
  'index.html',
  'backup.js',
  'manifest.webmanifest',
  'sw.js',
  '_headers',
  '_redirects',
  'Best-Friend-Guide.pdf',
  'apple-touch-icon.png',
  'favicon-16.png',
  'favicon-32.png',
  'icon-192.png',
  'icon-512.png'
];

const supabaseUrl = (process.env.BF_SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.BF_SUPABASE_ANON_KEY || '').trim();
const environment = (process.env.BF_ENVIRONMENT || 'preview').trim();
const revision = (
  process.env.CF_PAGES_COMMIT_SHA
  || process.env.GITHUB_SHA
  || process.env.BF_RELEASE_REVISION
  || 'local'
).trim();
const allowedEnvironments = new Set([
  'development', 'preview', 'validation', 'production', 'local-auth-test'
]);
if(!allowedEnvironments.has(environment)){
  throw new Error(`BF_ENVIRONMENT invalide : ${environment}.`);
}
if(Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)){
  throw new Error('BF_SUPABASE_URL et BF_SUPABASE_ANON_KEY doivent être fournis ensemble.');
}
if(supabaseUrl){
  let parsed;
  try{ parsed=new URL(supabaseUrl); }
  catch{ throw new Error('BF_SUPABASE_URL invalide.'); }
  const local=['127.0.0.1','localhost'].includes(parsed.hostname);
  if(
    (parsed.protocol!=='https:' && !(local && parsed.protocol==='http:'))
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !['','/'].includes(parsed.pathname)
  ){
    throw new Error('BF_SUPABASE_URL doit être une origine HTTPS sans identifiants ni paramètres.');
  }
}
if(environment==='production' && !supabaseUrl){
  throw new Error('Un build de production exige la configuration publique Supabase.');
}
if(environment==='production' && revision==='local'){
  throw new Error(
    'Un build de production exige CF_PAGES_COMMIT_SHA, GITHUB_SHA ou BF_RELEASE_REVISION.'
  );
}

await rm(dist, {recursive:true, force:true});
await mkdir(dist, {recursive:true});
await mkdir(resolve(dist, 'migration'), {recursive:true});
for(const asset of assets){
  await cp(resolve(root, asset), resolve(dist, asset));
}
await cp(
  resolve(root, 'legacy-bridge', 'index.html'),
  resolve(dist, 'migration', 'index.html')
);

await build({
  entryPoints:[resolve(root, 'app-cloud.js')],
  outfile:resolve(dist, 'app-cloud.js'),
  bundle:true,
  format:'esm',
  platform:'browser',
  target:['es2022'],
  sourcemap:false,
  minify:true,
  legalComments:'none'
});

await build({
  entryPoints:[resolve(root, 'worker/index.js')],
  outfile:resolve(dist, '_worker.js'),
  bundle:true,
  external:['cloudflare:sockets'],
  format:'esm',
  platform:'browser',
  target:['es2022'],
  sourcemap:false,
  minify:true,
  legalComments:'none',
  define:{
    __BF_SUPABASE_URL__:JSON.stringify(supabaseUrl),
    __BF_SUPABASE_ANON_KEY__:JSON.stringify(supabaseAnonKey),
    __BF_REVISION__:JSON.stringify(revision)
  }
});

const config = {
  environment,
  supabaseUrl,
  supabaseAnonKey,
  revision
};
await writeFile(
  resolve(dist, 'config.js'),
  `window.BF_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
  'utf8'
);

const manifest = JSON.parse(await readFile(resolve(dist, 'manifest.webmanifest'), 'utf8'));
if(!manifest.name || !manifest.icons?.length){
  throw new Error('Manifest PWA incomplet.');
}

console.log(`Build Best Friend prêt dans dist/ (${config.environment})`);

import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(command, args, options={}){
  const {silent=false, ...spawnOptions} = options;
  const result = spawnSync(command, args, {
    cwd:root,
    encoding:'utf8',
    ...spawnOptions
  });
  if(!silent && result.stdout) process.stdout.write(result.stdout);
  if(!silent && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function environment(){
  const result = run('npx', [
    '--yes', 'supabase@2.109.1', 'status', '-o', 'env'
  ], {silent:true});
  if(result.status!==0) throw new Error('Le labo Supabase local doit être démarré.');

  const values = {};
  for(const line of result.stdout.split(/\r?\n/)){
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(?:"([^"]*)"|(.*))$/);
    if(match) values[match[1]] = match[2] ?? match[3] ?? '';
  }
  if(
    !values.API_URL
    || !values.ANON_KEY
    || !values.SERVICE_ROLE_KEY
    || !values.MAILPIT_URL
  ){
    throw new Error('Configuration locale Supabase incomplète.');
  }
  return values;
}

const local = environment();
const testEnvironment = {
  ...process.env,
  BF_ENVIRONMENT:'local-auth-test',
  BF_SUPABASE_URL:local.API_URL,
  BF_SUPABASE_ANON_KEY:local.ANON_KEY,
  BF_SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,
  BF_LOCAL_MAILPIT_URL:local.MAILPIT_URL
};

let status = 1;
try{
  const build = run('npm', ['run', 'build'], {env:testEnvironment});
  if(build.status!==0) throw new Error('Build authentifié impossible.');

  const tests = run('npx', [
    'playwright', 'test', '--config=playwright.auth.config.mjs'
  ], {env:testEnvironment});
  status = tests.status ?? 1;
}finally{
  const neutral = run('npm', ['run', 'build'], {
    env:{
      ...process.env,
      BF_ENVIRONMENT:'preview',
      BF_SUPABASE_URL:'',
      BF_SUPABASE_ANON_KEY:''
    }
  });
  if(neutral.status!==0) status=1;
}

process.exit(status);

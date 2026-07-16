import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname, '..');
const script=resolve(root, 'scripts/validate-backend.mjs');
const projectRef='abcdefghijklmnopqrst';
const baseEnvironment={
  ...process.env,
  BF_BACKEND_ENVIRONMENT:'validation',
  BF_EXPECTED_PROJECT_REF:projectRef,
  BF_SUPABASE_URL:'https://'+projectRef+'.supabase.co',
  BF_SITE_URL:'https://best-friend-app.pages.dev',
  BF_BACKEND_VALIDATE:''
};

function run(extra={}){
  return spawnSync(process.execPath, [script], {
    cwd:root,
    env:{...baseEnvironment, ...extra},
    encoding:'utf8'
  });
}

const dryRun=run();
assert.equal(dryRun.status, 0, dryRun.stderr);
const plan=JSON.parse(dryRun.stdout);
assert.equal(plan.dryRun, true);
assert.equal(plan.target.expectedRef, projectRef);
assert.equal(plan.target.local, false);
assert.ok(plan.checks.some(item=>item.includes('RLS concierge')));

const mismatch=run({
  BF_EXPECTED_PROJECT_REF:'differentprojectref',
  BF_SUPABASE_URL:'https://'+projectRef+'.supabase.co'
});
assert.notEqual(mismatch.status, 0);
assert.match(mismatch.stderr, /référence attendue/);

const production=run({BF_BACKEND_ENVIRONMENT:'production'});
assert.notEqual(production.status, 0);
assert.match(production.stderr, /validation ou local/);

const localWithoutGuard=run({
  BF_BACKEND_ENVIRONMENT:'local',
  BF_EXPECTED_PROJECT_REF:'local',
  BF_SUPABASE_URL:'http://127.0.0.1:54321'
});
assert.notEqual(localWithoutGuard.status, 0);
assert.match(localWithoutGuard.stderr, /HTTPS|BF_BACKEND_ALLOW_LOCAL/);

const localPlan=run({
  BF_BACKEND_ENVIRONMENT:'local',
  BF_EXPECTED_PROJECT_REF:'local',
  BF_SUPABASE_URL:'http://127.0.0.1:54321',
  BF_SITE_URL:'http://127.0.0.1:4173',
  BF_BACKEND_ALLOW_LOCAL:'YES'
});
assert.equal(localPlan.status, 0, localPlan.stderr);
assert.equal(JSON.parse(localPlan.stdout).target.local, true);

const executionWithoutKeys=run({BF_BACKEND_VALIDATE:'RUN'});
assert.notEqual(executionWithoutKeys.status, 0);
assert.match(executionWithoutKeys.stderr, /ANON_KEY/);

console.log('OK: dry-run et garde anti-cible du validateur backend vérifiés');

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname, '..');
const script=resolve(root, 'scripts/provision-tenant.mjs');
const baseEnvironment={
  ...process.env,
  BF_TENANT_KEY:'client-validation',
  BF_TENANT_OWNER_EMAIL:'owner.validation@example.test',
  BF_TENANT_NAME:'Locations Validation',
  BF_TENANT_OWNER_NAME:'Propriétaire Validation',
  BF_SITE_URL:'https://best-friend-app.pages.dev',
  BF_SUPABASE_SERVICE_ROLE_KEY:'secret-that-must-not-appear',
  BF_SUPABASE_ANON_KEY:'public-key-that-must-not-appear'
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
assert.equal(plan.tenant.key, 'client-validation');
assert.equal(plan.tenant.owner, 'o***@example.test');
assert.ok(!dryRun.stdout.includes(baseEnvironment.BF_SUPABASE_SERVICE_ROLE_KEY));
assert.ok(!dryRun.stdout.includes(baseEnvironment.BF_SUPABASE_ANON_KEY));
assert.match(plan.would.at(-1), /ne pas envoyer/);

const linkPlan=run({BF_TENANT_SEND_MAGIC_LINK:'YES'});
assert.equal(linkPlan.status, 0, linkPlan.stderr);
assert.match(
  JSON.parse(linkPlan.stdout).would.at(-1),
  /envoyer le lien/
);

const invalidKey=run({BF_TENANT_KEY:'NON VALIDE'});
assert.notEqual(invalidKey.status, 0);
assert.match(invalidKey.stderr, /BF_TENANT_KEY/);
assert.ok(!invalidKey.stderr.includes(baseEnvironment.BF_SUPABASE_SERVICE_ROLE_KEY));

const confirmationWithoutBackend=run({
  BF_TENANT_CONFIRM:'PROVISION',
  BF_SUPABASE_URL:'',
  BF_SUPABASE_SERVICE_ROLE_KEY:'',
  BF_SUPABASE_ANON_KEY:''
});
assert.notEqual(confirmationWithoutBackend.status, 0);
assert.match(confirmationWithoutBackend.stderr, /BF_SUPABASE_URL absent/);

console.log('OK: plan opérateur, confirmation et non-divulgation des clés validés');

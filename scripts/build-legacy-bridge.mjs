import {cp, mkdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const output=resolve(root,'dist-legacy-bridge');

await rm(output,{recursive:true,force:true});
await mkdir(resolve(output,'migration'),{recursive:true});
await cp(resolve(root,'backup.js'),resolve(output,'backup.js'));
await cp(resolve(root,'legacy-bridge','index.html'),resolve(output,'migration','index.html'));

console.log('Pont historique prêt dans dist-legacy-bridge/ (non déployé)');


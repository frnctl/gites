import assert from 'node:assert/strict';

await import('../backup.js');
const Backup = globalThis.BFBackup;

const source = {
  organization:{
    id:'source-org',
    name:'Source',
    brandName:'Maison Source',
    signature:'Équipe Source'
  },
  apartments:[
    {id:'apt-1', name:'Appartement Test', active:true}
  ],
  reservations:[
    {id:'booking-1', aptId:'apt-1', guest:'Voyageur'}
  ],
  interventions:[
    {id:'task-1', aptId:'apt-1', type:'Ménage', planned:true}
  ],
  contacts:[
    {id:'contact-1', aptId:'apt-1', name:'Prestataire'}
  ]
};

const envelope = await Backup.createEnvelope(source, {
  origin:'https://example.test',
  storage:'gites_v2'
});
assert.equal(envelope.format, 'best-friend-backup');
assert.equal(envelope.version, 1);
assert.equal(envelope.integrity.algorithm, 'SHA-256');
assert.deepEqual(envelope.counts, {
  apartments:1,
  reservations:1,
  interventions:1,
  contacts:1
});

const verified = await Backup.parseBackup(JSON.stringify(envelope));
assert.equal(verified.verified, true);
assert.equal(verified.envelope, true);
assert.deepEqual(verified.counts, envelope.counts);

const tampered = structuredClone(envelope);
tampered.data.reservations[0].guest='Intrus';
await assert.rejects(
  ()=>Backup.parseBackup(JSON.stringify(tampered)),
  error=>error.code==='integrity_mismatch'
);

const legacy = await Backup.parseBackup(JSON.stringify(source));
assert.equal(legacy.envelope, false);
assert.equal(legacy.verified, false);
assert.match(legacy.warnings[0], /Ancienne sauvegarde/);

const duplicate = structuredClone(source);
duplicate.apartments.push({id:'apt-1', name:'Doublon'});
assert.throws(
  ()=>Backup.normalizeData(duplicate),
  error=>error.code==='duplicate_id'
);

const orphan = structuredClone(source);
orphan.reservations[0].aptId='missing';
assert.throws(
  ()=>Backup.normalizeData(orphan),
  error=>error.code==='unknown_property'
);

const unsafeIdentifier = structuredClone(source);
unsafeIdentifier.apartments[0].id="apt');alert(1);//";
unsafeIdentifier.reservations[0].aptId=unsafeIdentifier.apartments[0].id;
unsafeIdentifier.interventions[0].aptId=unsafeIdentifier.apartments[0].id;
unsafeIdentifier.contacts[0].aptId=unsafeIdentifier.apartments[0].id;
assert.throws(
  ()=>Backup.normalizeData(unsafeIdentifier),
  error=>error.code==='invalid_id'
);

await assert.rejects(
  ()=>Backup.parseBackup(
    '{"apartments":[],"reservations":[],"interventions":[],"contacts":[],"__proto__":{"polluted":true}}'
  ),
  error=>error.code==='unsafe_key'
);
assert.equal({}.polluted, undefined);

const targeted = Backup.forTarget(source, {
  id:'target-org',
  name:'Destination',
  brandName:'Ancienne marque'
});
assert.equal(targeted.organization.id, 'target-org');
assert.equal(targeted.organization.name, 'Destination');
assert.equal(targeted.organization.brandName, 'Maison Source');
assert.equal(targeted.organization.signature, 'Équipe Source');

console.log('OK: sauvegardes versionnées, intégrité et validation historique vérifiées');

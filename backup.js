(function initializeBestFriendBackup(root){
  'use strict';

  const FORMAT = 'best-friend-backup';
  const VERSION = 1;
  const MAX_ITEMS_PER_COLLECTION = 10_000;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const COLLECTIONS = ['apartments', 'reservations', 'interventions', 'contacts'];

  class BackupError extends Error {
    constructor(code, message){
      super(message);
      this.name = 'BackupError';
      this.code = code;
    }
  }

  function fail(code, message){
    throw new BackupError(code, message);
  }

  function cloneJson(value, path='data', depth=0){
    if(depth>40) fail('too_deep', `${path} est trop imbriqué.`);
    if(value===null || typeof value==='boolean' || typeof value==='string') return value;
    if(typeof value==='number'){
      if(!Number.isFinite(value)) fail('invalid_number', `${path} contient un nombre invalide.`);
      return value;
    }
    if(Array.isArray(value)){
      return value.map((item, index)=>cloneJson(item, `${path}[${index}]`, depth+1));
    }
    if(typeof value!=='object') fail('invalid_value', `${path} contient une valeur non prise en charge.`);

    const out = {};
    for(const [key, item] of Object.entries(value)){
      if(FORBIDDEN_KEYS.has(key)) fail('unsafe_key', `${path} contient une clé interdite.`);
      out[key] = cloneJson(item, `${path}.${key}`, depth+1);
    }
    return out;
  }

  function normalizedId(value, path){
    if(typeof value!=='string' && typeof value!=='number'){
      fail('missing_id', `${path} doit avoir un identifiant.`);
    }
    const id = String(value).trim();
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)){
      fail('invalid_id', `${path} a un identifiant invalide.`);
    }
    return id;
  }

  function normalizeCollection(source, name){
    if(!Array.isArray(source)) fail('missing_collection', `${name} doit être une liste.`);
    if(source.length>MAX_ITEMS_PER_COLLECTION){
      fail('too_many_items', `${name} dépasse ${MAX_ITEMS_PER_COLLECTION} éléments.`);
    }

    const seen = new Set();
    return source.map((raw, index)=>{
      if(!raw || typeof raw!=='object' || Array.isArray(raw)){
        fail('invalid_item', `${name}[${index}] doit être un objet.`);
      }
      const item = cloneJson(raw, `${name}[${index}]`);
      item.id = normalizedId(item.id, `${name}[${index}]`);
      if(seen.has(item.id)) fail('duplicate_id', `${name} contient deux fois l'identifiant ${item.id}.`);
      seen.add(item.id);
      return item;
    });
  }

  function normalizeData(source){
    if(!source || typeof source!=='object' || Array.isArray(source)){
      fail('invalid_root', 'La sauvegarde ne contient pas un objet de données.');
    }
    source=cloneJson(source, 'data');
    const data = {
      organization:source.organization && typeof source.organization==='object' && !Array.isArray(source.organization)
        ? cloneJson(source.organization, 'organization')
        : {},
      apartments:normalizeCollection(source.apartments || [], 'apartments'),
      reservations:normalizeCollection(source.reservations || [], 'reservations'),
      interventions:normalizeCollection(source.interventions || [], 'interventions'),
      contacts:normalizeCollection(source.contacts || [], 'contacts')
    };

    const propertyIds = new Set();
    for(const [index, apartment] of data.apartments.entries()){
      const name = typeof apartment.name==='string' ? apartment.name.trim() : '';
      if(!name) fail('missing_property_name', `apartments[${index}] n'a pas de nom.`);
      apartment.name = name;
      propertyIds.add(apartment.id);
    }

    for(const name of ['reservations', 'interventions']){
      data[name].forEach((item, index)=>{
        item.aptId = normalizedId(item.aptId, `${name}[${index}].aptId`);
        if(!propertyIds.has(item.aptId)){
          fail('unknown_property', `${name}[${index}] vise un bien absent (${item.aptId}).`);
        }
      });
    }
    data.contacts.forEach((item, index)=>{
      if(item.aptId===undefined || item.aptId===null || item.aptId==='') return;
      item.aptId = normalizedId(item.aptId, `contacts[${index}].aptId`);
      if(!propertyIds.has(item.aptId)){
        fail('unknown_property', `contacts[${index}] vise un bien absent (${item.aptId}).`);
      }
    });

    return data;
  }

  function counts(data){
    return Object.fromEntries(COLLECTIONS.map(name=>[name, data[name].length]));
  }

  function canonicalStringify(value){
    if(value===null || typeof value!=='object') return JSON.stringify(value);
    if(Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key=>(
      `${JSON.stringify(key)}:${canonicalStringify(value[key])}`
    )).join(',')}}`;
  }

  async function sha256(value){
    if(!root.crypto?.subtle) fail('crypto_unavailable', 'Le contrôle d’intégrité est indisponible.');
    const bytes = new TextEncoder().encode(value);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2, '0')).join('');
  }

  function safeMetadata(metadata){
    if(!metadata || typeof metadata!=='object' || Array.isArray(metadata)) return {};
    return cloneJson(metadata, 'metadata');
  }

  async function createEnvelope(source, metadata={}){
    const data = normalizeData(source);
    const digest = await sha256(canonicalStringify(data));
    return {
      format:FORMAT,
      version:VERSION,
      exportedAt:new Date().toISOString(),
      source:{
        app:'Best Friend',
        ...safeMetadata(metadata)
      },
      counts:counts(data),
      data,
      integrity:{algorithm:'SHA-256', digest}
    };
  }

  function sameCounts(left, right){
    return COLLECTIONS.every(name=>Number(left?.[name])===Number(right?.[name]));
  }

  async function parseBackup(input){
    let parsed;
    try{
      parsed = typeof input==='string' ? JSON.parse(input) : cloneJson(input, 'backup');
    }catch(error){
      if(error instanceof BackupError) throw error;
      fail('invalid_json', 'Le fichier JSON est illisible.');
    }

    const envelope = parsed?.format===FORMAT;
    if(envelope && parsed.version!==VERSION){
      fail('unsupported_version', `Version de sauvegarde non prise en charge : ${parsed.version}.`);
    }
    const data = normalizeData(envelope ? parsed.data : parsed);
    const actualCounts = counts(data);
    const warnings = [];
    let verified = false;

    if(envelope){
      if(!sameCounts(parsed.counts, actualCounts)){
        fail('count_mismatch', 'Les compteurs de la sauvegarde ne correspondent pas à son contenu.');
      }
      const integrity = parsed.integrity;
      if(integrity?.algorithm==='SHA-256' && typeof integrity.digest==='string'){
        const actualDigest = await sha256(canonicalStringify(data));
        if(actualDigest!==integrity.digest.toLowerCase()){
          fail('integrity_mismatch', 'Le fichier a été modifié ou endommagé.');
        }
        verified = true;
      }else{
        warnings.push('Cette sauvegarde versionnée ne contient pas de contrôle d’intégrité.');
      }
    }else{
      warnings.push('Ancienne sauvegarde détectée : son contenu sera normalisé avant import.');
    }

    return {
      envelope,
      version:envelope ? parsed.version : 0,
      exportedAt:envelope ? parsed.exportedAt || null : null,
      source:envelope ? cloneJson(parsed.source || {}, 'source') : {},
      integrityDigest:verified ? parsed.integrity.digest.toLowerCase() : null,
      verified,
      warnings,
      counts:actualCounts,
      data
    };
  }

  function forTarget(importedData, currentOrganization){
    const data = normalizeData(importedData);
    const organization = cloneJson(currentOrganization || {}, 'targetOrganization');
    for(const key of ['brandName', 'ownerLabel', 'ownerName', 'signature']){
      if(typeof data.organization[key]==='string') organization[key]=data.organization[key];
    }
    data.organization=organization;
    return data;
  }

  function fileName(prefix='best-friend-backup'){
    return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  }

  root.BFBackup = Object.freeze({
    FORMAT,
    VERSION,
    BackupError,
    canonicalStringify,
    counts,
    createEnvelope,
    fileName,
    forTarget,
    normalizeData,
    parseBackup
  });
})(globalThis);

import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';

const root=resolve(import.meta.dirname, '..');
const source=resolve(root, 'docs/ONBOARDING-COMPLET.html');
const deliverables=resolve(root, 'deliverables');
const output=resolve(deliverables, 'Best-Friend-Onboarding-Complet.pdf');

await mkdir(deliverables, {recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(pathToFileURL(source).href, {waitUntil:'load'});
  await page.emulateMedia({media:'print'});
  const report=await page.evaluate(()=>{
    const pages=[...document.querySelectorAll('.page')];
    const missing=[...document.images].filter(image=>!image.complete || image.naturalWidth===0).map(image=>image.getAttribute('src'));
    const overflow=pages.map((page,index)=>({page:index+1,extra:page.scrollHeight-page.clientHeight})).filter(item=>item.extra>2);
    return {pages:pages.length,missing,overflow};
  });
  if(report.pages!==16) throw new Error(`Nombre de pages inattendu : ${report.pages}`);
  if(report.missing.length) throw new Error(`Images absentes : ${report.missing.join(', ')}`);
  if(report.overflow.length) throw new Error(`Contenu débordant : ${JSON.stringify(report.overflow)}`);
  await page.pdf({
    path:output,
    format:'A4',
    printBackground:true,
    preferCSSPageSize:true,
    margin:{top:'0',right:'0',bottom:'0',left:'0'}
  });
}finally{
  await browser.close();
}

console.log('PDF complet généré dans deliverables/Best-Friend-Onboarding-Complet.pdf');

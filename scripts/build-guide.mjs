import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';

const root=resolve(import.meta.dirname, '..');
const source=resolve(root, 'docs/GUIDE-UTILISATEUR.html');
const output=resolve(root, 'Best-Friend-Guide.pdf');

const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  await page.goto(pathToFileURL(source).href, {waitUntil:'load'});
  await page.emulateMedia({media:'print'});
  await page.pdf({
    path:output,
    format:'A4',
    printBackground:true,
    preferCSSPageSize:true,
    margin:{top:'0', right:'0', bottom:'0', left:'0'}
  });
}finally{
  await browser.close();
}

console.log('Guide utilisateur généré dans Best-Friend-Guide.pdf');

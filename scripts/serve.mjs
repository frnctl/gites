import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, resolve, sep} from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');
const port = Number(process.env.PORT || 4173);
const mime = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.pdf':'application/pdf',
  '.webmanifest':'application/manifest+json; charset=utf-8'
};

function sendFile(response, file){
  response.writeHead(200, {
    'Content-Type':mime[extname(file)] || 'application/octet-stream',
    'Cache-Control':'no-cache'
  });
  createReadStream(file).pipe(response);
}

createServer(async (request, response)=>{
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if(pathname==='/control/'){
    response.writeHead(301, {Location:'/control'});
    response.end();
    return;
  }

  const relative = pathname.replace(/^\/+/, '');
  const candidate = resolve(dist, relative || 'index.html');
  const insideDist = candidate===dist || candidate.startsWith(dist+sep);
  if(insideDist && relative){
    try{
      const info=await stat(candidate);
      if(info.isFile()){
        sendFile(response, candidate);
        return;
      }
      if(info.isDirectory()){
        const index=resolve(candidate, 'index.html');
        if((await stat(index)).isFile()){
          sendFile(response, index);
          return;
        }
      }
    }catch{}
  }

  sendFile(response, resolve(dist, 'index.html'));
}).listen(port, '127.0.0.1', ()=>{
  console.log(`Best Friend servi sur http://127.0.0.1:${port}`);
});

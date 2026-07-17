import {connect} from 'cloudflare:sockets';

const DEFAULT_ICAL_HOSTS = [
  'airbnb.com',
  'airbnb.fr',
  'booking.com',
  'homeexchange.com',
  'sabbaticalhomes.com'
];

const MAX_JSON_BYTES = 32 * 1024;
const MAX_ICAL_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const COMMON_SECURITY_HEADERS = {
  'Referrer-Policy':'strict-origin-when-cross-origin',
  'Strict-Transport-Security':'max-age=31536000',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'X-Robots-Tag':'noindex, nofollow, noarchive'
};
const STATIC_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

const BUILT_SUPABASE_URL = typeof __BF_SUPABASE_URL__ === 'string'
  ? __BF_SUPABASE_URL__
  : '';
const BUILT_SUPABASE_ANON_KEY = typeof __BF_SUPABASE_ANON_KEY__ === 'string'
  ? __BF_SUPABASE_ANON_KEY__
  : '';
const BUILT_REVISION = typeof __BF_REVISION__ === 'string'
  ? __BF_REVISION__
  : 'local';

function apiHeaders(extra={}){
  return {
    ...COMMON_SECURITY_HEADERS,
    'Cache-Control':'no-store',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy':'no-referrer',
    ...extra
  };
}

function secureAssetResponse(response, pathname){
  const secured=new Response(response.body, response);
  for(const [name,value] of Object.entries(COMMON_SECURITY_HEADERS)){
    secured.headers.set(name, value);
  }
  secured.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=()'
  );
  secured.headers.set('Content-Security-Policy', STATIC_CONTENT_SECURITY_POLICY);
  if(pathname==='/config.js') secured.headers.set('Cache-Control', 'no-store');
  if(pathname==='/sw.js') secured.headers.set('Cache-Control', 'no-cache');
  return secured;
}

async function fetchAsset(request, env, url){
  let response=await env.ASSETS.fetch(request);
  const acceptsHtml=(request.headers.get('accept') || '').includes('text/html');
  const filePath=/\/[^/]+\.[^/]+$/.test(url.pathname);
  if(
    response.status===404
    && request.method==='GET'
    && acceptsHtml
    && !filePath
  ){
    const fallbackUrl=new URL('/index.html', url);
    response=await env.ASSETS.fetch(new Request(fallbackUrl, {
      method:'GET',
      headers:request.headers
    }));
  }
  return secureAssetResponse(response, url.pathname);
}

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:apiHeaders({'Content-Type':'application/json; charset=utf-8'})
  });
}

function runtimeConfig(env={}){
  return {
    supabaseUrl:String(env.BF_SUPABASE_URL || BUILT_SUPABASE_URL || '').replace(/\/+$/, ''),
    supabaseAnonKey:String(env.BF_SUPABASE_ANON_KEY || BUILT_SUPABASE_ANON_KEY || ''),
    serviceRoleKey:String(env.BF_SUPABASE_SERVICE_ROLE_KEY || ''),
    siteUrl:String(env.BF_SITE_URL || '').replace(/\/+$/, ''),
    revision:String(env.CF_PAGES_COMMIT_SHA || env.BF_RELEASE_REVISION || BUILT_REVISION || 'local')
  };
}

function allowedHosts(env={}){
  const custom=String(env.BF_ICAL_HOSTS || '')
    .split(',')
    .map(value=>value.trim().toLowerCase().replace(/^\.+/, ''))
    .filter(Boolean);
  return custom.length ? custom : DEFAULT_ICAL_HOSTS;
}

export function isAllowedCalendarUrl(value, env={}){
  let url;
  try{ url=new URL(value); }
  catch{ return false; }
  if(url.protocol!=='https:' || url.username || url.password) return false;
  if(url.port && url.port!=='443') return false;
  const hostname=url.hostname.toLowerCase().replace(/\.$/, '');
  if(!hostname || /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(':')) return false;
  return allowedHosts(env).some(host=>hostname===host || hostname.endsWith('.'+host));
}

async function readJson(request){
  const declared=Number(request.headers.get('content-length') || 0);
  if(declared>MAX_JSON_BYTES) throw new Error('payload_too_large');
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>MAX_JSON_BYTES){
    throw new Error('payload_too_large');
  }
  try{ return JSON.parse(text || '{}'); }
  catch{ throw new Error('invalid_json'); }
}

function bearerToken(request){
  const header=request.headers.get('authorization') || '';
  const match=header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function authenticate(request, config, fetchImpl){
  const token=bearerToken(request);
  if(!token) return null;
  const response=await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
    headers:{
      apikey:config.supabaseAnonKey,
      Authorization:`Bearer ${token}`,
      Accept:'application/json'
    }
  });
  if(!response.ok) return null;
  const user=await response.json();
  return user?.id ? {token, user} : null;
}

async function rpc(config, auth, name, body, fetchImpl){
  return fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method:'POST',
    headers:{
      apikey:config.supabaseAnonKey,
      Authorization:`Bearer ${auth.token}`,
      'Content-Type':'application/json',
      Accept:'application/json'
    },
    body:JSON.stringify(body)
  });
}

async function fetchCalendar(source, env, fetchImpl){
  let current=new URL(source);
  for(let redirects=0; redirects<=MAX_REDIRECTS; redirects+=1){
    if(!isAllowedCalendarUrl(current.href, env)) throw new Error('calendar_host_forbidden');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(), 12_000);
    let response;
    try{
      response=await fetchImpl(current.href, {
        redirect:'manual',
        headers:{Accept:'text/calendar,text/plain;q=0.9,*/*;q=0.1'},
        signal:controller.signal
      });
    }finally{
      clearTimeout(timeout);
    }
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');
      if(!location || redirects===MAX_REDIRECTS) throw new Error('calendar_redirect_invalid');
      current=new URL(location, current);
      continue;
    }
    if(!response.ok) throw new Error('calendar_upstream_error');
    const declared=Number(response.headers.get('content-length') || 0);
    if(declared>MAX_ICAL_BYTES) throw new Error('calendar_too_large');
    const buffer=await response.arrayBuffer();
    if(buffer.byteLength>MAX_ICAL_BYTES) throw new Error('calendar_too_large');
    const text=new TextDecoder().decode(buffer).replace(/^\uFEFF/, '');
    if(!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))){
      throw new Error('calendar_invalid');
    }
    return text;
  }
  throw new Error('calendar_redirect_invalid');
}

async function handleCalendar(request, env, config, fetchImpl){
  const auth=await authenticate(request, config, fetchImpl);
  if(!auth) return json({ok:false, error:'authentication_required'}, 401);
  let body;
  try{ body=await readJson(request); }
  catch(error){ return json({ok:false, error:error.message}, 400); }
  const source=String(body.url || '').trim();
  if(!isAllowedCalendarUrl(source, env)){
    return json({ok:false, error:'calendar_host_forbidden'}, 400);
  }
  try{
    const calendar=await fetchCalendar(source, env, fetchImpl);
    return new Response(calendar, {
      status:200,
      headers:apiHeaders({'Content-Type':'text/calendar; charset=utf-8'})
    });
  }catch(error){
    console.warn('ical proxy', error?.message || error);
    const clientErrors=new Set([
      'calendar_host_forbidden', 'calendar_redirect_invalid',
      'calendar_too_large', 'calendar_invalid'
    ]);
    return json({
      ok:false,
      error:clientErrors.has(error?.message) ? error.message : 'calendar_unavailable'
    }, clientErrors.has(error?.message) ? 400 : 502);
  }
}

function validEmail(value){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length<=254;
}

async function authAdminRequest(config, path, options, fetchImpl){
  return fetchImpl(`${config.supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers:{
      apikey:config.serviceRoleKey,
      Authorization:`Bearer ${config.serviceRoleKey}`,
      'Content-Type':'application/json',
      Accept:'application/json',
      ...(options?.headers || {})
    }
  });
}

async function authUserExists(config, email, fetchImpl){
  const perPage=1000;
  for(let page=1; page<=100; page+=1){
    const response=await authAdminRequest(
      config,
      `/admin/users?page=${page}&per_page=${perPage}`,
      {method:'GET'},
      fetchImpl
    );
    if(!response.ok) throw new Error('auth_admin_unavailable');
    const payload=await response.json();
    const users=payload.users || [];
    if(users.some(user=>user.email?.toLowerCase()===email)) return true;
    if(users.length<perPage) return false;
  }
  throw new Error('auth_admin_pagination_limit');
}

async function sendAccessEmail(config, email, displayName, redirectTo, fetchImpl){
  const exists=await authUserExists(config, email, fetchImpl);
  if(exists){
    return fetchImpl(
      `${config.supabaseUrl}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method:'POST',
        headers:{
          apikey:config.supabaseAnonKey,
          'Content-Type':'application/json',
          Accept:'application/json'
        },
        body:JSON.stringify({
          email,
          create_user:false,
          data:{display_name:displayName || ''}
        })
      }
    );
  }
  return authAdminRequest(
    config,
    `/invite?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method:'POST',
      body:JSON.stringify({email, data:{display_name:displayName || ''}})
    },
    fetchImpl
  );
}

/* ===== Envoi SMTP direct (contourne le service email bridé de Supabase) ===== */

function b64Utf8(value){
  const bytes=new TextEncoder().encode(value);
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000){
    binary+=String.fromCharCode(...bytes.subarray(i, i+0x8000));
  }
  return btoa(binary);
}

function b64Wrap(value){
  return b64Utf8(value).replace(/(.{76})/g, '$1\r\n');
}

async function smtpSendEmail(env, {to, subject, html}){
  const user=String(env.BF_SMTP_USER || '');
  const pass=String(env.BF_SMTP_PASS || '');
  const host=String(env.BF_SMTP_HOST || 'smtp.mail.yahoo.com');
  const port=Number(env.BF_SMTP_PORT || 465);
  const fromName=String(env.BF_SMTP_FROM_NAME || 'Best Friend');
  if(!user || !pass) throw new Error('smtp_unconfigured');

  const socket=connect({hostname:host, port}, {secureTransport:'on', allowHalfOpen:false});
  const writer=socket.writable.getWriter();
  const reader=socket.readable.getReader();
  const encoder=new TextEncoder();
  const decoder=new TextDecoder();

  async function command(line, expected){
    if(line!==null) await writer.write(encoder.encode(line+'\r\n'));
    let reply='';
    for(;;){
      const terminal=reply.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/);
      if(terminal){
        const code=Number(terminal[1]);
        if(code>=400 || (expected && code!==expected)){
          throw new Error(`smtp_${code}`);
        }
        return code;
      }
      const {value, done}=await reader.read();
      if(done) throw new Error('smtp_closed');
      reply+=decoder.decode(value, {stream:true});
    }
  }

  try{
    await command(null, 220);
    await command('EHLO best-friend-app.pages.dev');
    await command('AUTH LOGIN', 334);
    await command(btoa(user), 334);
    await command(btoa(pass), 235);
    await command(`MAIL FROM:<${user}>`, 250);
    await command(`RCPT TO:<${to}>`, 250);
    await command('DATA', 354);
    const message=[
      `From: =?UTF-8?B?${b64Utf8(fromName)}?= <${user}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${b64Utf8(subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@best-friend-app.pages.dev>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Wrap(html),
      '.'
    ].join('\r\n');
    await command(message, 250);
    await writer.write(encoder.encode('QUIT\r\n'));
  }finally{
    try{ await socket.close(); }catch(_error){ /* déjà fermé */ }
  }
}

const ENTRY_TITLES={
  owner:'votre espace propriétaire',
  concierge:'votre accès concierge',
  provider:'votre espace prestataire'
};

function loginEmailHtml(link, entry){
  const target=ENTRY_TITLES[entry] || ENTRY_TITLES.owner;
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:32px 16px;background:#0E0E10;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:460px;margin:0 auto;background:#16161A;border:1px solid rgba(201,162,39,.5);border-radius:16px;padding:32px 28px;color:#F2EFE9">
    <div style="font-size:22px;font-weight:800;letter-spacing:.03em;margin-bottom:4px">BEST FRIEND<span style="color:#C1121F">.</span></div>
    <div style="font-size:13px;color:#8A8A92;margin-bottom:24px">Pilotage propriétaire — conciergerie</div>
    <p style="font-size:15px;line-height:1.55;margin:0 0 22px">Bonjour,<br>voici votre lien de connexion sécurisé vers ${target}. Il est personnel et expire rapidement.</p>
    <div style="text-align:center;margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#C9A227;color:#0E0E10;font-weight:700;font-size:15px;text-decoration:none;padding:13px 30px;border-radius:12px">Ouvrir Best Friend</a>
    </div>
    <p style="font-size:12px;color:#8A8A92;line-height:1.5;margin:0">Si le bouton ne répond pas, copiez ce lien dans votre navigateur :<br><a href="${link}" style="color:#C9A227;word-break:break-all">${link}</a></p>
    <hr style="border:none;border-top:1px solid rgba(201,162,39,.25);margin:22px 0 14px">
    <p style="font-size:11px;color:#8A8A92;margin:0">Vous n'êtes pas à l'origine de cette demande ? Ignorez simplement cet email.</p>
  </div>
</body></html>`;
}

async function handleLoginLink(request, env, config, fetchImpl){
  if(!config.serviceRoleKey) return json({ok:false, error:'service_unconfigured'}, 503);
  const origin=request.headers.get('origin') || '';
  const selfOrigin=new URL(request.url).origin;
  if(origin && origin!==selfOrigin && origin!==config.siteUrl){
    return json({ok:false, error:'origin_forbidden'}, 403);
  }
  let body;
  try{ body=await readJson(request); }
  catch(error){ return json({ok:false, error:error.message}, 400); }
  const email=String(body.email || '').trim().toLowerCase();
  const entry=['owner','concierge','provider'].includes(body.entry) ? body.entry : 'owner';
  if(!validEmail(email)) return json({ok:false, error:'invalid_email'}, 400);

  // Anti-abus : 1 envoi par adresse par minute (cache edge).
  const cache=caches.default;
  const throttleKey=new Request(`https://bf-login-throttle.invalid/${encodeURIComponent(email)}`);
  if(await cache.match(throttleKey)){
    return json({ok:true, emailSent:true, throttled:true});
  }
  await cache.put(throttleKey, new Response('1', {headers:{'Cache-Control':'max-age=60'}}));

  const redirectTo=`${config.siteUrl || selfOrigin}/?entry=${entry}`;
  try{
    const exists=await authUserExists(config, email, fetchImpl);
    if(!exists){
      const created=await authAdminRequest(config, '/admin/users', {
        method:'POST',
        body:JSON.stringify({email, email_confirm:true})
      }, fetchImpl);
      if(!created.ok) throw new Error('user_creation_failed');
    }
    const linkResponse=await authAdminRequest(config, '/admin/generate_link', {
      method:'POST',
      body:JSON.stringify({type:'magiclink', email, redirect_to:redirectTo})
    }, fetchImpl);
    if(!linkResponse.ok) throw new Error('link_generation_failed');
    const payload=await linkResponse.json();
    const link=payload.action_link || payload.properties?.action_link;
    if(!link) throw new Error('link_generation_failed');
    await smtpSendEmail(env, {
      to:email,
      subject:'Votre lien de connexion Best Friend',
      html:loginEmailHtml(link, entry)
    });
    return json({ok:true, emailSent:true});
  }catch(error){
    console.warn('login link', error?.message || error);
    return json({ok:false, error:'login_link_failed'}, 502);
  }
}

async function handleInvite(request, env, config, fetchImpl){
  const auth=await authenticate(request, config, fetchImpl);
  if(!auth) return json({ok:false, error:'authentication_required'}, 401);
  let body;
  try{ body=await readJson(request); }
  catch(error){ return json({ok:false, error:error.message}, 400); }

  const email=String(body.email || '').trim().toLowerCase();
  const displayName=String(body.name || '').trim().slice(0, 120);
  const orgId=String(body.orgId || '').trim();
  const role=String(body.role || '').trim();
  const propertyIds=Array.isArray(body.propertyIds)
    ? body.propertyIds.map(value=>String(value)).slice(0, 200)
    : [];
  if(!/^[0-9a-f-]{36}$/i.test(orgId) || !validEmail(email)){
    return json({ok:false, error:'invalid_invitation'}, 400);
  }
  if(!['owner','admin','manager','concierge','viewer'].includes(role)){
    return json({ok:false, error:'invalid_role'}, 400);
  }

  const access=await rpc(config, auth, 'bf_invite_member', {
    p_org_id:orgId,
    p_email:email,
    p_display_name:displayName,
    p_role:role,
    p_property_ids:propertyIds
  }, fetchImpl);
  if(!access.ok){
    console.warn('invite access', access.status);
    return json({ok:false, error:'invitation_forbidden'}, access.status===403 ? 403 : 400);
  }

  if(!config.serviceRoleKey){
    return json({
      ok:true,
      accessSaved:true,
      emailSent:false,
      warning:'email_service_unconfigured'
    });
  }

  const redirectTo=config.siteUrl || new URL(request.url).origin;
  try{
    const delivered=await sendAccessEmail(
      config, email, displayName, redirectTo, fetchImpl
    );
    if(!delivered.ok){
      console.warn('invite email', delivered.status);
      return json({
        ok:true,
        accessSaved:true,
        emailSent:false,
        warning:'email_delivery_failed'
      });
    }
    return json({ok:true, accessSaved:true, emailSent:true});
  }catch(error){
    console.warn('invite email', error?.message || error);
    return json({
      ok:true,
      accessSaved:true,
      emailSent:false,
      warning:'email_delivery_failed'
    });
  }
}

export async function handleRequest(request, env={}){
  const url=new URL(request.url);
  const config=runtimeConfig(env);
  const fetchImpl=env.__fetch || fetch;

  if(url.pathname==='/api/health' && request.method==='GET'){
    return json({ok:true, service:'best-friend', revision:config.revision});
  }
  if(!url.pathname.startsWith('/api/')){
    if(env.ASSETS?.fetch){
      return fetchAsset(request, env, url);
    }
    return secureAssetResponse(
      new Response('Not found', {
        status:404,
        headers:{'Content-Type':'text/plain; charset=utf-8'}
      }),
      url.pathname
    );
  }
  if(!config.supabaseUrl || !config.supabaseAnonKey){
    return json({ok:false, error:'service_unconfigured'}, 503);
  }
  if(url.pathname==='/api/ical' && request.method==='POST'){
    return handleCalendar(request, env, config, fetchImpl);
  }
  if(url.pathname==='/api/invite' && request.method==='POST'){
    return handleInvite(request, env, config, fetchImpl);
  }
  if(url.pathname==='/api/login-link' && request.method==='POST'){
    return handleLoginLink(request, env, config, fetchImpl);
  }
  if(request.method==='OPTIONS'){
    return new Response(null, {status:204, headers:apiHeaders()});
  }
  return json({ok:false, error:'not_found'}, 404);
}

export default {
  fetch(request, env){
    return handleRequest(request, env);
  }
};

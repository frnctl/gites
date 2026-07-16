import assert from 'node:assert/strict';
import {handleRequest, isAllowedCalendarUrl} from '../worker/index.js';

const config = {
  BF_SUPABASE_URL:'https://project.supabase.co',
  BF_SUPABASE_ANON_KEY:'public-anon-key',
  BF_SUPABASE_SERVICE_ROLE_KEY:'server-only-key',
  BF_SITE_URL:'https://app.example.test',
  BF_RELEASE_REVISION:'release-test'
};

assert.equal(isAllowedCalendarUrl('https://www.airbnb.fr/calendar/ical/test.ics'), true);
assert.equal(isAllowedCalendarUrl('https://ical.booking.com/feed.ics'), true);
assert.equal(isAllowedCalendarUrl('http://www.airbnb.fr/calendar.ics'), false);
assert.equal(isAllowedCalendarUrl('https://airbnb.fr.evil.test/calendar.ics'), false);
assert.equal(isAllowedCalendarUrl('https://127.0.0.1/calendar.ics'), false);
assert.equal(isAllowedCalendarUrl('https://user:pass@airbnb.fr/calendar.ics'), false);
assert.equal(
  isAllowedCalendarUrl('https://calendar.example.test/feed.ics', {
    BF_ICAL_HOSTS:'calendar.example.test'
  }),
  true
);

const health=await handleRequest(
  new Request('https://app.example.test/api/health'),
  config
);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  ok:true,
  service:'best-friend',
  revision:'release-test'
});
assert.equal(health.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
assert.equal(health.headers.get('strict-transport-security'), 'max-age=31536000');
assert.match(health.headers.get('content-security-policy'), /default-src 'none'/);

const assetEnvironment={
  ...config,
  ASSETS:{
    fetch:async request=>new Response('<!doctype html><title>App</title>', {
      headers:{
        'Content-Type':'text/html; charset=utf-8',
        'Cache-Control':'public, max-age=3600',
        'X-Test-Path':new URL(request.url).pathname
      }
    })
  }
};
const asset=await handleRequest(
  new Request('https://app.example.test/'),
  assetEnvironment
);
assert.equal(asset.status, 200);
assert.equal(asset.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
assert.equal(asset.headers.get('x-frame-options'), 'DENY');
assert.equal(asset.headers.get('strict-transport-security'), 'max-age=31536000');
assert.match(asset.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.match(asset.headers.get('permissions-policy'), /camera=\(self\)/);
assert.match(await asset.text(), /<title>App<\/title>/);

const configAsset=await handleRequest(
  new Request('https://app.example.test/config.js'),
  assetEnvironment
);
assert.equal(configAsset.headers.get('cache-control'), 'no-store');

const serviceWorkerAsset=await handleRequest(
  new Request('https://app.example.test/sw.js'),
  assetEnvironment
);
assert.equal(serviceWorkerAsset.headers.get('cache-control'), 'no-cache');

const spaCalls=[];
const spaEnvironment={
  ...config,
  ASSETS:{
    fetch:async request=>{
      const path=new URL(request.url).pathname;
      spaCalls.push(path);
      return path==='/index.html'
        ? new Response('<!doctype html><title>Application</title>', {
            headers:{'Content-Type':'text/html; charset=utf-8'}
          })
        : new Response('Not found', {status:404});
    }
  }
};
const spa=await handleRequest(
  new Request('https://app.example.test/control', {
    headers:{Accept:'text/html,application/xhtml+xml'}
  }),
  spaEnvironment
);
assert.equal(spa.status, 200);
assert.deepEqual(spaCalls, ['/control', '/index.html']);
assert.match(await spa.text(), /Application/);

const unauthorized=await handleRequest(
  new Request('https://app.example.test/api/ical', {
    method:'POST',
    body:JSON.stringify({url:'https://www.airbnb.fr/calendar.ics'})
  }),
  {...config, __fetch:async()=>new Response('unexpected', {status:500})}
);
assert.equal(unauthorized.status, 401);

const calendarCalls=[];
const calendarFetch=async (url, options={})=>{
  calendarCalls.push({url:String(url), options});
  if(String(url).endsWith('/auth/v1/user')){
    return Response.json({id:'10000000-0000-0000-0000-000000000001'});
  }
  if(String(url)==='https://www.airbnb.fr/calendar/ical/test.ics'){
    return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', {
      headers:{'Content-Type':'text/calendar'}
    });
  }
  return new Response('not found', {status:404});
};
const calendar=await handleRequest(
  new Request('https://app.example.test/api/ical', {
    method:'POST',
    headers:{
      Authorization:'Bearer valid-user-token',
      'Content-Type':'application/json'
    },
    body:JSON.stringify({url:'https://www.airbnb.fr/calendar/ical/test.ics'})
  }),
  {...config, __fetch:calendarFetch}
);
assert.equal(calendar.status, 200);
assert.match(await calendar.text(), /BEGIN:VCALENDAR/);
assert.equal(calendarCalls.length, 2);

const inviteCalls=[];
const inviteFetch=async (url, options={})=>{
  const value=String(url);
  inviteCalls.push({url:value, options});
  if(value.endsWith('/auth/v1/user')){
    return Response.json({id:'10000000-0000-0000-0000-000000000001'});
  }
  if(value.includes('/rest/v1/rpc/bf_invite_member')){
    return Response.json('20000000-0000-0000-0000-000000000002');
  }
  if(value.includes('/auth/v1/admin/users')){
    return Response.json({users:[{email:'collaborateur@example.test'}]});
  }
  if(value.includes('/auth/v1/otp')){
    return Response.json({});
  }
  return new Response('not found', {status:404});
};
const invite=await handleRequest(
  new Request('https://app.example.test/api/invite', {
    method:'POST',
    headers:{
      Authorization:'Bearer valid-user-token',
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      orgId:'30000000-0000-0000-0000-000000000003',
      email:'collaborateur@example.test',
      name:'Conciergerie Test',
      role:'concierge',
      propertyIds:['appartement-test']
    })
  }),
  {...config, __fetch:inviteFetch}
);
assert.equal(invite.status, 200);
assert.deepEqual(await invite.json(), {
  ok:true,
  accessSaved:true,
  emailSent:true
});
const otpCall=inviteCalls.find(call=>call.url.includes('/auth/v1/otp'));
assert.ok(otpCall);
assert.equal(JSON.parse(otpCall.options.body).create_user, false);

const withoutMailer=await handleRequest(
  new Request('https://app.example.test/api/invite', {
    method:'POST',
    headers:{
      Authorization:'Bearer valid-user-token',
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      orgId:'30000000-0000-0000-0000-000000000003',
      email:'nouveau@example.test',
      role:'viewer',
      propertyIds:['appartement-test']
    })
  }),
  {
    ...config,
    BF_SUPABASE_SERVICE_ROLE_KEY:'',
    __fetch:inviteFetch
  }
);
assert.equal(withoutMailer.status, 200);
assert.deepEqual(await withoutMailer.json(), {
  ok:true,
  accessSaved:true,
  emailSent:false,
  warning:'email_service_unconfigured'
});

console.log('OK: Worker privé, invitations et proxy iCal validés');

#!/usr/bin/env node
// Push Notification Sender — runs outside n8n sandbox
// Usage: node push-send.js <user_id> [title] [message] [url] [type]
const crypto = require('crypto');
const https = require('https');

const SU = 'https://ptoerfxyydlcjstiqqwb.supabase.co';
const SK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0b2VyZnh5eWRsY2pzdGlxcXdiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQzNTQzMywiZXhwIjoyMDg4MDExNDMzfQ.hxZf-JiV-e5-EtGgwPf-J2qNWu8TW_tBRLeBWTuaGyM';
const VP = 'BAzB1_7H9MmyZGn2VeTLmfYdKHgekj3ZY7ElmD93ODlxvBChvKN-43VH-BLAepBnSMr8D3XyLua_DpS56Jp7soE';
const VR = 'ujGxPNIepqQvKL0h6GWVjEXG4YqyxkarpIEYUU3vPeg';
const VS = 'mailto:irenegipsytattoo@gmail.com';

const b64u = b => Buffer.from(b).toString('base64url');
const b64d = s => Buffer.from(s, 'base64url');

function hkdf(ikm, salt, info, len) {
  const prk = crypto.createHmac('sha256', salt.length ? salt : Buffer.alloc(32)).update(ikm).digest();
  let t = Buffer.alloc(0), o = Buffer.alloc(0);
  for (let i = 1; o.length < len; i++) {
    t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, info, Buffer.from([i])])).digest();
    o = Buffer.concat([o, t]);
  }
  return o.slice(0, len);
}

function vapid(ep) {
  const u = new URL(ep);
  const h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const p = b64u(JSON.stringify({ aud: u.protocol + '//' + u.host, exp: Math.floor(Date.now() / 1000) + 43200, sub: VS }));
  const msg = h + '.' + p;
  const pub = b64d(VP);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: VR }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(msg), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + msg + '.' + b64u(sig) + ', k=' + VP;
}

function encrypt(p256dh, auth, text) {
  const up = b64d(p256dh), ua = b64d(auth);
  const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
  const lp = ec.getPublicKey(), ss = ec.computeSecret(up);
  const ikm = hkdf(ss, ua, Buffer.concat([Buffer.from('WebPush: info\0'), up, lp]), 32);
  const sl = crypto.randomBytes(16);
  const cek = hkdf(ikm, sl, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nc = hkdf(ikm, sl, Buffer.from('Content-Encoding: nonce\0'), 12);
  const ci = crypto.createCipheriv('aes-128-gcm', cek, nc);
  const en = Buffer.concat([ci.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), ci.final(), ci.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sl, rs, Buffer.from([65]), lp, en]);
}

function sendPush(ep, p, a, t) {
  return new Promise((ok, no) => {
    const bd = encrypt(p, a, t), u = new URL(ep);
    const rq = https.request({ hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': bd.length, Authorization: vapid(ep), TTL: '86400' }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => ok({ s: r.statusCode })); });
    rq.on('error', e => no(e)); rq.write(bd); rq.end();
  });
}

function getSubs(uid) {
  return new Promise((ok, no) => {
    https.get(SU + '/rest/v1/push_subscriptions?user_id=eq.' + uid + '&select=endpoint,p256dh,auth',
      { headers: { apikey: SK, Authorization: 'Bearer ' + SK } },
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { ok(JSON.parse(d)); } catch (e) { no(e); } }); }
    ).on('error', no);
  });
}

(async () => {
  const uid = process.argv[2];
  const title = process.argv[3] || 'Irene Gipsy Tattoo';
  const message = process.argv[4] || '';
  const url = process.argv[5] || '/dashboard.html';
  const type = process.argv[6] || 'general';
  if (!uid) { console.log(JSON.stringify({ error: 'user_id mancante' })); process.exit(1); }
  try {
    const subs = await getSubs(uid);
    if (!Array.isArray(subs) || !subs.length) { console.log(JSON.stringify({ sent: 0, total: 0 })); return; }
    const payload = JSON.stringify({ title, body: message, icon: '/icons/icon-192x192.png', url, tag: 'igt-' + Date.now(), type });
    const res = [];
    for (const s of subs) {
      if (!s.endpoint) continue;
      try { const r = await sendPush(s.endpoint, s.p256dh, s.auth, payload); res.push({ st: r.s >= 200 && r.s < 300 ? 'sent' : 'err', c: r.s }); }
      catch (e) { res.push({ st: 'err', e: e.message }); }
    }
    console.log(JSON.stringify({ sent: res.filter(r => r.st === 'sent').length, total: subs.length, results: res }));
  } catch (e) { console.log(JSON.stringify({ error: e.message })); }
})();

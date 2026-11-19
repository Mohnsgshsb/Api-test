'use strict';
/**
 * Endpoints مخصّصة ينشئها الأدمن من اللوحة (بدون كتابة كود):
 *  - static: ترجع رد JSON/نص ثابت (يدعم {{param}} من الـ query/body)
 *  - proxy : تحوّل الطلب إلى رابط خارجي (يدعم {{param}} + تمرير باقي المعاملات)
 */
const dns = require('dns').promises;
const net = require('net');
const catalog = require('./catalog');
const store = require('./store');

const RESERVED = /^\/(api\/(account|public|data)|assets|admin|healthz)(\/|$)/;
const MAX_BYTES = 5 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || (l.startsWith('::ffff:') && isPrivateIp(l.slice(7)));
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}
async function assertPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('بروتوكول غير مسموح');
  if (process.env.ALLOW_PRIVATE_PROXY === '1') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error('الوجهة غير مسموحة');
}

/** تحقق من تعريف endpoint مخصّص. يرجع {out} أو {error}. */
function validate(body, partial = false) {
  const out = {};
  if (body.kind !== undefined) {
    if (!['builtin', 'static', 'proxy'].includes(body.kind)) return { error: 'نوع غير معروف' };
    out.kind = body.kind;
  }
  if (body.target !== undefined) {
    const t = String(body.target).trim().slice(0, 1000);
    out.target = t;
  }
  if (body.response !== undefined) out.response = String(body.response).slice(0, 100000);
  const kind = out.kind;
  if (kind === 'proxy' && !partial) {
    try { const u = new URL(String(out.target || '').replace(/\{\{\w+\}\}/g, 'x')); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return { error: 'رابط الوجهة غير صالح (يجب أن يبدأ بـ http:// أو https://)' }; }
  }
  if (kind === 'static' && !partial && !String(out.response || '').trim()) return { error: 'اكتب الرد الذي سيرجعه الـ endpoint' };
  return { out };
}

/** تأكد أن مسار endpoint المخصّص لا يتعارض مع route موجود أو خدمة أخرى. */
function checkPath(pathStr, selfId) {
  const base = String(pathStr).split('?')[0];
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(base) || base.includes('..') || base.includes('//')) return 'المسار يجب أن يحوي حروفاً إنجليزية وأرقاماً و - _ / فقط (بدون :)';
  if (!/^\/(api|download|search|tools|islami|info)\//.test(base)) return 'المسار يجب أن يبدأ بـ /api/ أو /tools/ أو /download/ أو /search/ أو /islami/ أو /info/';
  if (RESERVED.test(base)) return 'هذا المسار محجوز للنظام';
  if (catalog.discoverRoutes().some((r) => catalog.pathToRegex(r.path).test(base))) return 'هذا المسار مستخدم بالفعل من خدمة مدمجة';
  for (const c of catalog.full()) for (const i of c.items || []) if (i.id !== selfId && i.kind && i.kind !== 'builtin' && String(i.path).split('?')[0] === base) return 'هذا المسار مستخدم من endpoint آخر';
  return null;
}

let cache = { ver: -1, db: null, map: new Map() };
function table() {
  const db = store.read().catalog;
  if (cache.ver === store.catalogVer() && cache.db === db) return cache.map;
  const map = new Map();
  for (const c of catalog.full()) for (const i of c.items || []) {
    if (!i.kind || i.kind === 'builtin') continue;
    map.set(String(i.path).split('?')[0].replace(/\/$/, ''), { item: i, cat: c });
  }
  cache = { ver: store.catalogVer(), db, map };
  return map;
}

const fill = (tpl, params, enc) => String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => { const v = params[k] == null ? '' : String(params[k]); return enc ? encodeURIComponent(v) : v; });

async function handler(req, res, next) {
  const hit = table().get(req.path.replace(/\/$/, ''));
  if (!hit) return next();
  const { item, cat } = hit;
  if (cat.enabled === false || item.enabled === false) return res.status(404).json({ status: false, message: 'الخدمة غير متاحة' });
  const allowed = item.methods && item.methods.length ? item.methods : [item.method || 'GET'];
  if (!allowed.includes(req.method) && !(req.method === 'HEAD' && allowed.includes('GET'))) {
    res.set('Allow', allowed.join(', '));
    return res.status(405).json({ status: false, message: `الطريقة غير مسموحة، استخدم ${allowed.join(' أو ')}` });
  }
  const params = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  try {
    if (item.kind === 'static') {
      const raw = fill(item.response || '', params, false);
      try { return res.json({ status: true, result: JSON.parse(raw) }); } catch { return res.type('text/plain; charset=utf-8').send(raw); }
    }
    // proxy
    const used = new Set([...String(item.target).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
    const url = new URL(fill(item.target, params, true));
    for (const [k, v] of Object.entries(req.query || {})) if (!used.has(k) && k !== 'apikey' && typeof v === 'string') url.searchParams.set(k, v);
    await assertPublicUrl(url);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    const init = { method: req.method === 'HEAD' ? 'GET' : req.method, signal: ctl.signal, redirect: 'manual', headers: { 'user-agent': 'TERBO-API/4', accept: '*/*' } };
    if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length) { init.body = JSON.stringify(req.body); init.headers['content-type'] = 'application/json'; }
    let r;
    try { r = await fetch(url, init); } finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400) return res.status(502).json({ status: false, message: 'الوجهة أرجعت إعادة توجيه (غير مسموح)' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return res.status(502).json({ status: false, message: 'رد الوجهة كبير جداً' });
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    if (/json/i.test(ct)) { try { return res.status(r.ok ? 200 : 502).json(r.ok ? { status: true, result: JSON.parse(buf.toString('utf8')) } : { status: false, message: `الوجهة أرجعت ${r.status}`, result: JSON.parse(buf.toString('utf8')) }); } catch { /* fallthrough */ } }
    res.status(r.ok ? 200 : 502).type(ct).send(buf);
  } catch (e) {
    res.status(502).json({ status: false, message: e.name === 'AbortError' ? 'انتهت مهلة الوجهة' : `تعذر الاتصال بالوجهة: ${e.message}` });
  }
}

module.exports = { handler, validate, checkPath };

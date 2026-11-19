'use strict';
/** مسارات لوحة الأدمن: /api/account/admin/* (كلها تتطلب Bearer لمدير). */
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const catalog = require('./catalog');
const custom = require('./custom');
const A = require('./auth');

const router = express.Router();
router.use(A.auth, A.admin);

const bad = (res, message, code = 400) => res.status(code).json({ status: false, message });
const actor = (req) => req.user.username;
const log = (req, action, details) => store.audit(action, details, actor(req));
const page = (req, def = 20) => {
  const p = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
  return { p, limit, from: (p - 1) * limit };
};
const paged = (list, req, def) => {
  const { p, limit, from } = page(req, def);
  return { total: list.length, page: p, pages: Math.max(1, Math.ceil(list.length / limit)), items: list.slice(from, from + limit) };
};
const adminUser = (u) => ({
  id: u.id, username: u.username, email: u.email, role: u.role, status: u.status, plan: u.plan || store.read().settings.defaultPlan,
  limits: u.limits || {}, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, root: u.id === 'root-admin',
});
const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - (n - 1 - i)); return d.toISOString().slice(0, 10); });

/* ================= نظرة عامة ================= */
router.get('/overview', (req, res) => {
  const d = store.read();
  const t = store.today();
  const days = lastDays(14);
  const daily = days.map((date) => ({ date, ...(d.stats.daily[date] || { total: 0, ok: 0, err: 0 }) }));
  const signups = days.map((date) => ({ date, count: d.users.filter((u) => String(u.createdAt).slice(0, 10) === date).length }));
  const recent = d.requests.slice(-200);
  const avgMs = recent.length ? Math.round(recent.reduce((s, r) => s + (r.durationMs || 0), 0) / recent.length) : 0;
  const topPaths = Object.entries(d.stats.paths).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, count]) => ({ path, count }));
  const cats = catalog.full();
  const services = cats.reduce((n, c) => n + (c.items || []).length, 0);
  const servicesOn = cats.reduce((n, c) => n + (c.enabled === false ? 0 : (c.items || []).filter((i) => i.enabled !== false).length), 0);
  const totals = d.stats.totals;
  res.json({
    status: true,
    users: { total: d.users.length, active: d.users.filter((u) => u.status !== 'blocked').length, blocked: d.users.filter((u) => u.status === 'blocked').length, admins: d.users.filter((u) => u.role === 'admin').length, today: signups[signups.length - 1].count },
    keys: { total: d.apiKeys.length, active: d.apiKeys.filter((k) => k.active).length },
    requests: { total: totals.total, ok: totals.ok, today: (d.stats.daily[t] || {}).total || 0, errorRate: totals.total ? Math.round(((totals.total - totals.ok) / totals.total) * 1000) / 10 : 0, avgMs },
    tickets: { open: d.tickets.filter((x) => x.status === 'open').length, total: d.tickets.length },
    services: { total: services, enabled: servicesOn, categories: cats.length },
    settings: { maintenance: !!d.settings.maintenance, registrationEnabled: d.settings.registrationEnabled !== false },
    uptimeSeconds: Math.floor(process.uptime()),
    daily, signups, topPaths,
    recentUsers: d.users.slice(-6).reverse().map(adminUser),
    recentErrors: d.requests.filter((r) => r.statusCode >= 400).slice(-8).reverse(),
  });
});

/* ================= المستخدمون ================= */
router.get('/users', (req, res) => {
  const d = store.read();
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = d.users.slice().reverse();
  if (q) list = list.filter((u) => u.username.toLowerCase().includes(q) || String(u.email).includes(q));
  if (req.query.role) list = list.filter((u) => u.role === req.query.role);
  if (req.query.status) list = list.filter((u) => (u.status || 'active') === req.query.status);
  if (req.query.plan) list = list.filter((u) => (u.plan || d.settings.defaultPlan) === req.query.plan);
  const out = paged(list, req, 15);
  out.items = out.items.map((u) => {
    const usage = d.usage[u.id] || {};
    return { ...adminUser(u), keys: d.apiKeys.filter((k) => k.userId === u.id && k.active).length, usedToday: usage.date === store.today() ? usage.count : 0, totalRequests: usage.total || 0 };
  });
  res.json({ status: true, ...out, plans: d.settings.plans });
});

async function validateUserFields(body, d, existing) {
  const out = {};
  if (body.username !== undefined || !existing) {
    const username = String(body.username || '').trim();
    if (!A.USERNAME_RE.test(username)) return { error: 'اسم المستخدم غير صالح (3-24 حرفاً بدون مسافات)' };
    out.username = username;
  }
  if (body.email !== undefined || !existing) {
    const email = String(body.email || '').trim().toLowerCase();
    if (!A.EMAIL_RE.test(email)) return { error: 'البريد الإلكتروني غير صالح' };
    out.email = email;
  }
  if (out.username || out.email) {
    const dup = d.users.some((x) => x.id !== existing?.id && ((out.username && x.username.toLowerCase() === out.username.toLowerCase()) || (out.email && x.email === out.email)));
    if (dup) return { error: 'الاسم أو البريد مستخدم بالفعل', code: 409 };
  }
  if (body.role !== undefined) { if (!['user', 'admin'].includes(body.role)) return { error: 'صلاحية غير صالحة' }; out.role = body.role; }
  if (body.status !== undefined) { if (!['active', 'blocked'].includes(body.status)) return { error: 'حالة غير صالحة' }; out.status = body.status; }
  if (body.plan !== undefined) { if (!d.settings.plans[body.plan]) return { error: 'الخطة غير موجودة' }; out.plan = body.plan; }
  if (body.limits !== undefined) {
    const lim = {};
    for (const k of ['dailyLimit', 'maxKeys']) {
      const v = body.limits?.[k];
      if (v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 100000000) return { error: `قيمة ${k} غير صالحة` };
      lim[k] = n;
    }
    out.limits = lim;
  }
  if (body.password) {
    const pw = String(body.password);
    if (pw.length < 8 || pw.length > 128) return { error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' };
    out.pw = await store.hashPassword(pw);
  }
  return { out };
}

router.post('/users', async (req, res) => {
  try {
    const d = store.read();
    if (!req.body.password) return bad(res, 'كلمة المرور مطلوبة');
    const { out, error, code } = await validateUserFields(req.body, d, null);
    if (error) return bad(res, error, code || 400);
    const user = store.mutate((db) => {
      const u = { id: store.id(), username: out.username, email: out.email, salt: out.pw.salt, passwordHash: out.pw.hash, role: out.role || 'user', status: out.status || 'active', plan: out.plan || db.settings.defaultPlan, limits: out.limits || {}, tokenVersion: 0, createdAt: store.now() };
      db.users.push(u); return u;
    });
    log(req, 'user.create', { id: user.id, username: user.username });
    res.status(201).json({ status: true, user: adminUser(user) });
  } catch (e) { console.error(e); bad(res, 'خطأ غير متوقع', 500); }
});

router.patch('/users/:id', async (req, res) => {
  try {
    const d = store.read();
    const u = d.users.find((x) => x.id === req.params.id);
    if (!u) return bad(res, 'المستخدم غير موجود', 404);
    const root = u.id === 'root-admin', self = u.id === req.user.id;
    if ((root || self) && (req.body.status === 'blocked' || req.body.role === 'user')) return bad(res, 'لا يمكن إيقاف أو تخفيض هذا الحساب');
    const { out, error, code } = await validateUserFields(req.body, d, u);
    if (error) return bad(res, error, code || 400);
    store.mutate(() => {
      const { pw, ...rest } = out;
      Object.assign(u, rest);
      if (pw) { u.salt = pw.salt; u.passwordHash = pw.hash; u.tokenVersion = (u.tokenVersion || 0) + 1; }
      if (req.body.revokeSessions) u.tokenVersion = (u.tokenVersion || 0) + 1;
      if (req.body.resetUsage && d.usage[u.id]) d.usage[u.id].count = 0;
    });
    log(req, 'user.update', { id: u.id, username: u.username, fields: Object.keys(req.body).filter((k) => k !== 'password') });
    res.json({ status: true, user: adminUser(u) });
  } catch (e) { console.error(e); bad(res, 'خطأ غير متوقع', 500); }
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === 'root-admin' || req.params.id === req.user.id) return bad(res, 'لا يمكن حذف هذا الحساب');
  const removed = store.mutate((d) => {
    const u = d.users.find((x) => x.id === req.params.id);
    if (!u) return null;
    d.users = d.users.filter((x) => x.id !== u.id);
    d.apiKeys = d.apiKeys.filter((k) => k.userId !== u.id);
    d.tickets = d.tickets.filter((t) => t.userId !== u.id);
    delete d.usage[u.id];
    return u;
  });
  if (!removed) return bad(res, 'المستخدم غير موجود', 404);
  log(req, 'user.delete', { id: removed.id, username: removed.username });
  res.json({ status: true, message: 'تم حذف المستخدم' });
});

/* ================= المفاتيح ================= */
const adminKey = (k, d) => ({
  id: k.id, userId: k.userId, owner: d.users.find((u) => u.id === k.userId)?.username || '—', name: k.name,
  hint: `tb_live_••••${k.last6 || k.last4}`, active: k.active, requests: k.requests || 0, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null,
  limits: k.limits || {}, endpointLimits: k.endpointLimits || {},
});
router.get('/keys', (req, res) => {
  const d = store.read();
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = d.apiKeys.slice().reverse().map((k) => adminKey(k, d));
  if (q) list = list.filter((k) => k.owner.toLowerCase().includes(q) || k.name.toLowerCase().includes(q) || k.hint.toLowerCase().includes(q));
  if (req.query.active === '1') list = list.filter((k) => k.active);
  if (req.query.active === '0') list = list.filter((k) => !k.active);
  res.json({ status: true, ...paged(list, req, 15) });
});
router.post('/keys', (req, res) => {
  const raw = `tb_live_${crypto.randomBytes(24).toString('hex')}`;
  const userId = String(req.body.userId || '');
  const key = store.mutate((d) => {
    if (!d.users.some((u) => u.id === userId)) return null;
    const k = { id: store.id(), userId, name: String(req.body.name || 'مفتاح من الإدارة').trim().slice(0, 40), secretHash: store.sha256(raw), last4: raw.slice(-4), last6: raw.slice(-6), createdAt: store.now(), requests: 0, active: true, limits: sanitizeLimit(req.body.limits), endpointLimits: {} };
    d.apiKeys.push(k); return k;
  });
  if (!key) return bad(res, 'المستخدم غير موجود', 404);
  log(req, 'key.create', { id: key.id, userId });
  res.status(201).json({ status: true, message: 'انسخ المفتاح الآن؛ لن يظهر كاملاً مرة أخرى', key: { ...adminKey(key, store.read()), token: raw } });
});
function sanitizeLimit(l) {
  const out = {};
  if (l && l.limit !== undefined && l.limit !== '' && l.limit !== null) {
    const n = Number(l.limit), w = Number(l.windowSeconds || 60);
    if (Number.isInteger(n) && n >= 0 && Number.isInteger(w) && w >= 1 && w <= 2592000) { out.limit = n; out.windowSeconds = w; }
  }
  return out;
}
router.patch('/keys/:id', (req, res) => {
  const k = store.mutate((d) => {
    const x = d.apiKeys.find((y) => y.id === req.params.id);
    if (!x) return null;
    if (req.body.active !== undefined) x.active = !!req.body.active;
    if (req.body.name !== undefined) x.name = String(req.body.name).trim().slice(0, 40) || x.name;
    if (req.body.limits !== undefined) x.limits = sanitizeLimit(req.body.limits);
    return x;
  });
  if (!k) return bad(res, 'المفتاح غير موجود', 404);
  log(req, 'key.update', { id: k.id, fields: Object.keys(req.body) });
  res.json({ status: true, key: adminKey(k, store.read()) });
});
router.delete('/keys/:id', (req, res) => {
  const ok = store.mutate((d) => { const n = d.apiKeys.length; d.apiKeys = d.apiKeys.filter((k) => k.id !== req.params.id); return d.apiKeys.length !== n; });
  if (!ok) return bad(res, 'المفتاح غير موجود', 404);
  log(req, 'key.delete', { id: req.params.id });
  res.json({ status: true });
});

/* ================= الأقسام والخدمات (الكتالوج) ================= */
const touchCatalog = () => { store.bumpCatalog(); store.save(); };
const cleanMethod = (m) => (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(m).toUpperCase()) ? String(m).toUpperCase() : 'GET');
const ICONS_OK = /^[a-z0-9-]{2,24}$/;

router.get('/catalog', (req, res) => {
  const routes = catalog.discoverRoutes();
  const cats = catalog.full().map((c) => ({ ...c, items: (c.items || []).map((i) => ({ ...i, routeExists: (i.kind && i.kind !== 'builtin') || routes.some((r) => catalog.pathToRegex(r.path).test(String(i.path).split('?')[0])) })) }));
  res.json({ status: true, categories: cats });
});

router.post('/catalog/categories', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return bad(res, 'اسم القسم مطلوب');
  const c = store.mutate((d) => {
    const cat = catalog.ensure();
    const taken = new Set(cat.categories.map((x) => x.slug));
    const created = { id: store.id(), slug: catalog.uniqueSlug(catalog.slugify(name, 'category'), taken), name, title: String(req.body.title || name).trim().slice(0, 40), icon: ICONS_OK.test(req.body.icon || '') ? req.body.icon : 'cube', description: String(req.body.description || '').slice(0, 200), enabled: req.body.enabled !== false, order: cat.categories.length, items: [] };
    cat.categories.push(created); cat.updatedAt = store.now(); return created;
  });
  touchCatalog(); log(req, 'catalog.category.create', { id: c.id, name });
  res.status(201).json({ status: true, category: c });
});
router.patch('/catalog/categories/:id', (req, res) => {
  const c = store.mutate(() => {
    const x = catalog.ensure().categories.find((y) => y.id === req.params.id);
    if (!x) return null;
    if (req.body.name !== undefined) x.name = String(req.body.name).trim().slice(0, 40) || x.name;
    if (req.body.title !== undefined) x.title = String(req.body.title).trim().slice(0, 40) || x.name;
    if (req.body.icon !== undefined && ICONS_OK.test(req.body.icon)) x.icon = req.body.icon;
    if (req.body.description !== undefined) x.description = String(req.body.description).slice(0, 200);
    if (req.body.enabled !== undefined) x.enabled = !!req.body.enabled;
    return x;
  });
  if (!c) return bad(res, 'القسم غير موجود', 404);
  touchCatalog(); log(req, 'catalog.category.update', { id: c.id, fields: Object.keys(req.body) });
  res.json({ status: true, category: c });
});
router.delete('/catalog/categories/:id', (req, res) => {
  const ok = store.mutate(() => { const cat = catalog.ensure(); const n = cat.categories.length; cat.categories = cat.categories.filter((c) => c.id !== req.params.id); return cat.categories.length !== n; });
  if (!ok) return bad(res, 'القسم غير موجود', 404);
  touchCatalog(); log(req, 'catalog.category.delete', { id: req.params.id });
  res.json({ status: true });
});
router.post('/catalog/categories/:id/move', (req, res) => {
  const dir = Number(req.body.dir) < 0 ? -1 : 1;
  store.mutate(() => {
    const list = catalog.ensure().categories.sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = list.findIndex((c) => c.id === req.params.id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((c, n) => { c.order = n; });
  });
  touchCatalog();
  res.json({ status: true });
});

function validItem(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) { const n = String(body.name || '').trim().slice(0, 60); if (!n) return { error: 'اسم الخدمة مطلوب' }; out.name = n; }
  if (!partial || body.path !== undefined) {
    const p = String(body.path || '').trim().slice(0, 400);
    if (!p.startsWith('/') || /\s/.test(p) || p.startsWith('//')) return { error: 'المسار يجب أن يبدأ بـ / وبدون مسافات' };
    out.path = p;
  }
  if (body.desc !== undefined) out.desc = String(body.desc).slice(0, 300);
  if (body.method !== undefined) out.method = cleanMethod(body.method);
  if (body.enabled !== undefined) out.enabled = !!body.enabled;
  if (body.note !== undefined) out.note = String(body.note).slice(0, 200);
  if (body.kind !== undefined || body.target !== undefined || body.response !== undefined) {
    const v = custom.validate(body, partial);
    if (v.error) return { error: v.error };
    Object.assign(out, v.out);
  }
  return { out };
}
function checkCustom(out, existing) {
  const kind = out.kind || (existing && existing.kind) || 'builtin';
  if (kind === 'builtin') return null;
  const full = { ...(existing || {}), ...out };
  const e = custom.checkPath(full.path, existing && existing.id);
  if (e) return e;
  if (kind === 'proxy') { const v = custom.validate({ kind, target: full.target }, false); if (v.error) return v.error; }
  if (kind === 'static') { const v = custom.validate({ kind, response: full.response }, false); if (v.error) return v.error; }
  return null;
}
router.post('/catalog/categories/:id/items', (req, res) => {
  const { out, error } = validItem(req.body);
  if (error) return bad(res, error);
  const ce = checkCustom(out, null); if (ce) return bad(res, ce);
  const item = store.mutate(() => {
    const c = catalog.ensure().categories.find((x) => x.id === req.params.id);
    if (!c) return null;
    const taken = new Set(c.items.map((i) => i.slug));
    const it = { id: store.id(), slug: catalog.uniqueSlug(catalog.slugify(out.name, 'api'), taken), name: out.name, desc: out.desc || '', path: out.path, method: out.method || 'GET', methods: [out.method || 'GET'], enabled: out.enabled !== false, note: '', kind: out.kind || 'builtin', target: out.target || '', response: out.response || '' };
    c.items.push(it); return it;
  });
  if (!item) return bad(res, 'القسم غير موجود', 404);
  touchCatalog(); log(req, 'catalog.item.create', { id: item.id, name: item.name, path: item.path });
  res.status(201).json({ status: true, item });
});
router.patch('/catalog/items/:id', (req, res) => {
  const { out, error } = validItem(req.body, true);
  if (error) return bad(res, error);
  let existing = null;
  for (const c of catalog.ensure().categories) { const f = c.items.find((x) => x.id === req.params.id); if (f) existing = f; }
  if (!existing) return bad(res, 'الخدمة غير موجودة', 404);
  const ce = checkCustom(out, existing); if (ce) return bad(res, ce);
  const toCat = req.body.categoryId;
  if (toCat && !catalog.ensure().categories.some((c) => c.id === toCat)) return bad(res, 'القسم المستهدف غير موجود', 404);
  const item = store.mutate(() => {
    for (const c of catalog.ensure().categories) {
      const it = c.items.find((x) => x.id === req.params.id);
      if (it) {
        Object.assign(it, out); if (out.method) it.methods = [out.method];
        if (toCat && toCat !== c.id) {
          const dest = catalog.ensure().categories.find((x) => x.id === toCat);
          c.items = c.items.filter((x) => x !== it);
          it.slug = catalog.uniqueSlug(catalog.slugify(it.name, 'api'), new Set(dest.items.map((x) => x.slug)));
          dest.items.push(it);
        }
        return it;
      }
    }
    return null;
  });
  if (!item) return bad(res, 'الخدمة غير موجودة', 404);
  touchCatalog(); log(req, 'catalog.item.update', { id: item.id, fields: Object.keys(req.body) });
  res.json({ status: true, item });
});
router.delete('/catalog/items/:id', (req, res) => {
  const ok = store.mutate(() => {
    for (const c of catalog.ensure().categories) { const n = c.items.length; c.items = c.items.filter((i) => i.id !== req.params.id); if (c.items.length !== n) return true; }
    return false;
  });
  if (!ok) return bad(res, 'الخدمة غير موجودة', 404);
  touchCatalog(); log(req, 'catalog.item.delete', { id: req.params.id });
  res.json({ status: true });
});
router.post('/catalog/items/:id/move', (req, res) => {
  const dir = Number(req.body.dir) < 0 ? -1 : 1;
  store.mutate(() => {
    for (const c of catalog.ensure().categories) {
      const i = c.items.findIndex((x) => x.id === req.params.id), j = i + dir;
      if (i >= 0) { if (j >= 0 && j < c.items.length) [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; return; }
    }
  });
  touchCatalog();
  res.json({ status: true });
});
router.post('/catalog/reset', (req, res) => {
  store.mutate((d) => { d.catalog = null; });
  catalog.ensure(); touchCatalog(); log(req, 'catalog.reset', {});
  res.json({ status: true, message: 'تمت إعادة الأقسام إلى الوضع الافتراضي' });
});

/* ================= سياسات الـ Endpoints ================= */
router.get('/endpoints', (req, res) => {
  const d = store.read();
  const routes = catalog.discoverRoutes().concat(catalog.full().flatMap((c) => (c.items || []).filter((i) => i.kind && i.kind !== 'builtin').map((i) => ({ method: i.method || 'GET', path: String(i.path).split('?')[0], category: c.slug, file: 'مخصص' }))));
  res.json({ status: true, endpoints: routes.map((r) => ({ ...r, hits: d.stats.paths[r.path] || 0, policy: d.endpointPolicies[r.path] || null })), policies: d.endpointPolicies });
});
const KEY_MODES = ['default', 'none', 'account', 'custom'];
const maskKey = (k) => (k ? `${String(k).slice(0, 3)}…(${String(k).length})` : '');
router.put('/endpoints', (req, res) => {
  const id = String(req.body.id || '');
  if (!id.startsWith('/') || id.length > 200) return bad(res, 'مسار غير صالح');
  const limit = Number(req.body.limit ?? 0), windowSeconds = Number(req.body.windowSeconds || 60);
  if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 2592000) return bad(res, 'قيمة limit أو windowSeconds غير صالحة');
  // وضع المفتاح (يدعم الصيغة القديمة requireKey)
  const keyMode = req.body.keyMode !== undefined ? String(req.body.keyMode) : (req.body.requireKey ? 'account' : 'default');
  if (!KEY_MODES.includes(keyMode)) return bad(res, 'وضع المفتاح غير معروف');
  let apiKey = '';
  if (keyMode === 'custom') {
    apiKey = String(req.body.apiKey ?? store.read().endpointPolicies[id]?.apiKey ?? '').trim();
    if (!/^[\x21-\x7E]{8,128}$/.test(apiKey)) return bad(res, 'المفتاح يجب أن يكون من 8 إلى 128 حرفاً بدون مسافات (حروف إنجليزية وأرقام ورموز)');
  }
  const policy = store.mutate((d) => {
    d.endpointPolicies[id] = { enabled: req.body.enabled !== false, disabled: !!req.body.disabled, keyMode, requireKey: keyMode === 'account' || keyMode === 'custom', apiKey, limit, windowSeconds, updatedAt: store.now() };
    return d.endpointPolicies[id];
  });
  log(req, 'endpoint.policy.update', { id, policy: { ...policy, apiKey: maskKey(policy.apiKey) } });
  res.json({ status: true, policy });
});
router.delete('/endpoints', (req, res) => {
  const id = String(req.query.id || req.body?.id || '');
  const ok = store.mutate((d) => { const had = !!d.endpointPolicies[id]; delete d.endpointPolicies[id]; return had; });
  if (!ok) return bad(res, 'لا توجد سياسة لهذا المسار', 404);
  log(req, 'endpoint.policy.delete', { id });
  res.json({ status: true });
});

/* ================= سجل الطلبات ================= */
router.get('/requests', (req, res) => {
  const d = store.read();
  const q = String(req.query.q || '').trim().toLowerCase();
  let list = d.requests.slice().reverse();
  if (q) list = list.filter((r) => String(r.path).toLowerCase().includes(q));
  if (req.query.status === 'ok') list = list.filter((r) => r.statusCode < 400);
  else if (req.query.status === 'err') list = list.filter((r) => r.statusCode >= 400);
  else if (/^\d{3}$/.test(req.query.status || '')) list = list.filter((r) => String(r.statusCode) === req.query.status);
  if (req.query.userId) list = list.filter((r) => r.userId === req.query.userId);
  const out = paged(list, req, 25);
  const names = new Map(d.users.map((u) => [u.id, u.username]));
  out.items = out.items.map((r) => ({ ...r, user: r.userId ? names.get(r.userId) || '—' : 'زائر' }));
  res.json({ status: true, ...out });
});
router.delete('/requests', (req, res) => {
  const n = store.mutate((d) => { const c = d.requests.length; d.requests = []; return c; });
  log(req, 'requests.clear', { count: n });
  res.json({ status: true, cleared: n });
});

/* ================= التذاكر ================= */
router.get('/tickets', (req, res) => {
  const d = store.read();
  let list = d.tickets.slice().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  if (req.query.status) list = list.filter((t) => t.status === req.query.status);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) list = list.filter((t) => `${t.subject} ${t.message} ${t.username || ''}`.toLowerCase().includes(q));
  const names = new Map(d.users.map((u) => [u.id, u.username]));
  const out = paged(list, req, 20);
  out.items = out.items.map((t) => ({ ...t, username: t.username || names.get(t.userId) || '—', replies: t.replies || [] }));
  res.json({ status: true, ...out });
});
router.patch('/tickets/:id', (req, res) => {
  const t = store.mutate((d) => {
    const x = d.tickets.find((y) => y.id === req.params.id);
    if (!x) return null;
    if (req.body.status !== undefined) { if (!['open', 'in_progress', 'closed'].includes(req.body.status)) return { error: 'حالة غير صالحة' }; x.status = req.body.status; }
    if (req.body.priority !== undefined) { if (!['low', 'normal', 'high'].includes(req.body.priority)) return { error: 'أولوية غير صالحة' }; x.priority = req.body.priority; }
    x.updatedAt = store.now(); return x;
  });
  if (!t) return bad(res, 'التذكرة غير موجودة', 404);
  if (t.error) return bad(res, t.error);
  log(req, 'ticket.update', { id: t.id, status: t.status });
  res.json({ status: true, ticket: t });
});
router.post('/tickets/:id/reply', (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 4000);
  if (message.length < 2) return bad(res, 'اكتب الرد');
  const t = store.mutate((d) => {
    const x = d.tickets.find((y) => y.id === req.params.id);
    if (!x) return null;
    (x.replies ||= []).push({ id: store.id(), by: 'admin', name: req.user.username, message, createdAt: store.now() });
    if (x.status === 'open') x.status = 'in_progress';
    if (req.body.close) x.status = 'closed';
    x.updatedAt = store.now(); return x;
  });
  if (!t) return bad(res, 'التذكرة غير موجودة', 404);
  log(req, 'ticket.reply', { id: t.id });
  res.status(201).json({ status: true, ticket: t });
});
router.delete('/tickets/:id', (req, res) => {
  const ok = store.mutate((d) => { const n = d.tickets.length; d.tickets = d.tickets.filter((t) => t.id !== req.params.id); return d.tickets.length !== n; });
  if (!ok) return bad(res, 'التذكرة غير موجودة', 404);
  log(req, 'ticket.delete', { id: req.params.id });
  res.json({ status: true });
});

/* ================= الإعدادات ================= */
router.get('/settings', (req, res) => res.json({ status: true, settings: store.read().settings }));
router.patch('/settings', (req, res) => {
  const b = req.body || {};
  const errors = [];
  const next = store.mutate((d) => {
    const s = d.settings;
    const str = (v, max) => String(v).trim().slice(0, max);
    for (const k of ['registrationEnabled', 'maintenance', 'requireKeyGlobal']) if (typeof b[k] === 'boolean') s[k] = b[k];
    if (b.siteName !== undefined) s.siteName = str(b.siteName, 40) || s.siteName;
    if (b.tagline !== undefined) s.tagline = str(b.tagline, 200);
    if (b.maintenanceMessage !== undefined) s.maintenanceMessage = str(b.maintenanceMessage, 300);
    if (b.anonymousPerMinute !== undefined) {
      const n = Number(b.anonymousPerMinute);
      if (Number.isInteger(n) && n >= 1 && n <= 100000) s.anonymousPerMinute = n; else errors.push('حد الزوار غير صالح');
    }
    if (b.announcement && typeof b.announcement === 'object') {
      s.announcement = { enabled: !!b.announcement.enabled, text: str(b.announcement.text || '', 300), type: ['info', 'warn', 'success'].includes(b.announcement.type) ? b.announcement.type : 'info' };
    }
    if (b.contact && typeof b.contact === 'object') {
      const url = (v) => { const x = str(v || '', 200); return x === '' || /^https?:\/\//i.test(x) ? x : (errors.push('الروابط يجب أن تبدأ بـ http(s)://'), ''); };
      s.contact = { email: str(b.contact.email || '', 120), telegram: url(b.contact.telegram), discord: url(b.contact.discord) };
    }
    if (b.defaultPlan !== undefined) { if (s.plans[b.defaultPlan] || (b.plans && b.plans[b.defaultPlan])) s.defaultPlan = b.defaultPlan; else errors.push('الخطة الافتراضية غير موجودة'); }
    if (b.plans && typeof b.plans === 'object') {
      const plans = {};
      for (const [key, p] of Object.entries(b.plans)) {
        if (!/^[a-z0-9_-]{2,20}$/.test(key)) { errors.push(`معرّف الخطة "${key}" غير صالح (حروف إنجليزية صغيرة وأرقام)`); continue; }
        const dailyLimit = Number(p.dailyLimit), maxKeys = Number(p.maxKeys);
        if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || !Number.isInteger(maxKeys) || maxKeys < 1) { errors.push(`قيم الخطة "${key}" غير صالحة`); continue; }
        plans[key] = { name: str(p.name || key, 40), dailyLimit, maxKeys };
      }
      const inUse = new Set(d.users.map((u) => u.plan || s.defaultPlan));
      const missing = [...inUse].filter((k) => !plans[k]);
      if (!Object.keys(plans).length) errors.push('يجب وجود خطة واحدة على الأقل');
      else if (missing.length) errors.push(`لا يمكن حذف خطة مستخدمة: ${missing.join('، ')}`);
      else { s.plans = plans; if (!plans[s.defaultPlan]) s.defaultPlan = Object.keys(plans)[0]; }
    }
    return s;
  });
  log(req, 'settings.update', { fields: Object.keys(b) });
  if (errors.length) return res.status(400).json({ status: false, message: errors[0], errors, settings: next });
  res.json({ status: true, settings: next });
});

/* ================= السجل والنسخ الاحتياطي ================= */
router.get('/audit', (req, res) => res.json({ status: true, ...paged(store.read().auditLog, req, 25) }));
router.get('/backup', (req, res) => {
  log(req, 'backup.download', {});
  const d = store.read();
  const copy = { ...d, users: d.users.map(({ salt, passwordHash, ...u }) => u) }; // بدون هاشات كلمات المرور
  res.setHeader('Content-Disposition', `attachment; filename="terbo-backup-${store.today()}.json"`);
  res.type('application/json').send(JSON.stringify(copy, null, 2));
});

module.exports = { router };

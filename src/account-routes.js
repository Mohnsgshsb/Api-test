'use strict';
/** مسارات الحسابات: /api/account/* */
const crypto = require('crypto');
const express = require('express');
const store = require('./store');
const A = require('./auth');

const router = express.Router();

const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, role: u.role, plan: u.plan || store.read().settings.defaultPlan, createdAt: u.createdAt });
const ip = (req) => req.ip || req.socket?.remoteAddress || 'unknown';
const bad = (res, message, code = 400) => res.status(code).json({ status: false, message });
const TTL = { short: 60 * 60 * 24 * 2, normal: 60 * 60 * 24 * 7, remember: 60 * 60 * 24 * 30 };

function issue(req, res, user, remember) {
  const ttl = remember ? TTL.remember : TTL.normal;
  const token = store.tokenFor(user, ttl);
  A.setSession(req, res, token, ttl);
  return token;
}

/* ---------- التسجيل ---------- */
router.post('/auth/register', async (req, res) => {
  try {
    const settings = store.read().settings;
    if (settings.registrationEnabled === false) return bad(res, 'التسجيل مغلق حالياً', 403);
    if (A.hit(`reg:${ip(req)}`, 10, 60 * 60 * 1000)) return bad(res, 'محاولات كثيرة، حاول لاحقاً', 429);

    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!A.USERNAME_RE.test(username)) return bad(res, 'اسم المستخدم يجب أن يكون 3-24 حرفاً (حروف أو أرقام أو _ . -) بدون مسافات');
    if (!A.EMAIL_RE.test(email) || email.length > 120) return bad(res, 'البريد الإلكتروني غير صالح');
    if (password.length < 8 || password.length > 128) return bad(res, 'كلمة المرور يجب ألا تقل عن 8 أحرف');
    if (req.body.confirm !== undefined && req.body.confirm !== password) return bad(res, 'كلمتا المرور غير متطابقتين');

    const pw = await store.hashPassword(password);
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const result = store.mutate((d) => {
      if (d.users.some((u) => u.username.toLowerCase() === username.toLowerCase() || u.email === email)) return { error: 'اسم المستخدم أو البريد مستخدم بالفعل' };
      const user = {
        id: store.id(), username, email, salt: pw.salt, passwordHash: pw.hash,
        role: adminEmail && email === adminEmail ? 'admin' : 'user', status: 'active',
        plan: d.settings.defaultPlan, limits: {}, tokenVersion: 0, createdAt: store.now(), lastLoginAt: store.now(),
      };
      d.users.push(user);
      return { user };
    });
    if (result.error) return bad(res, result.error, 409);
    store.audit('user.register', { id: result.user.id, username }, username);
    const token = issue(req, res, result.user, false);
    res.status(201).json({ status: true, message: 'تم إنشاء الحساب بنجاح', token, user: publicUser(result.user) });
  } catch (e) { console.error('[register]', e); bad(res, 'حدث خطأ غير متوقع', 500); }
});

/* ---------- الدخول ---------- */
async function login(req, res, adminOnly = false) {
  try {
    const identity = String(req.body.identity || req.body.username || req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!identity || !password) return bad(res, 'أدخل اسم المستخدم وكلمة المرور');
    const failKey = `fail:${ip(req)}|${identity}`;
    if (A.peek(failKey, 5, 15 * 60 * 1000)) return bad(res, 'تم إيقاف المحاولات مؤقتاً بسبب كثرة الأخطاء. حاول بعد 15 دقيقة', 429);
    if (A.hit(`login:${ip(req)}`, 30, 10 * 60 * 1000)) return bad(res, 'محاولات كثيرة، حاول لاحقاً', 429);

    const user = store.read().users.find((u) => u.username.toLowerCase() === identity || u.email === identity);
    const ok = user ? await store.verifyPassword(password, user) : (await store.hashPassword(password), false);
    if (!ok || user.status === 'blocked' || (adminOnly && user.role !== 'admin')) {
      A.hit(failKey, 5, 15 * 60 * 1000);
      if (user && user.status === 'blocked' && ok) return bad(res, 'هذا الحساب موقوف. تواصل مع الدعم', 403);
      return bad(res, adminOnly ? 'بيانات المدير غير صحيحة' : 'بيانات تسجيل الدخول غير صحيحة', 401);
    }
    A.reset(failKey);
    store.mutate(() => { user.lastLoginAt = store.now(); });
    const token = issue(req, res, user, !!req.body.remember);
    res.json({ status: true, message: 'تم تسجيل الدخول', token, user: publicUser(user) });
  } catch (e) { console.error('[login]', e); bad(res, 'حدث خطأ غير متوقع', 500); }
}
router.post('/auth/login', (req, res) => login(req, res, false));
router.post('/admin/auth/login', (req, res) => login(req, res, true));

router.post('/auth/logout', (req, res) => {
  const u = A.resolveUser(A.bearer(req)) || A.userFromCookie(req);
  if (u && req.body?.all) store.mutate(() => { u.tokenVersion = (u.tokenVersion || 0) + 1; });
  A.clearSession(res);
  res.json({ status: true, message: 'تم تسجيل الخروج' });
});

/** استعادة الجلسة من الكوكي (HttpOnly) — يتجاهل CORS/CSRF لأن الكوكي SameSite=Lax ولا يُرسل عبر مواقع أخرى. */
router.get('/auth/session', (req, res) => {
  const u = A.userFromCookie(req);
  if (!u) return res.json({ status: true, token: null, user: null });
  res.json({ status: true, token: store.tokenFor(u, TTL.normal), user: publicUser(u) });
});

router.get('/auth/me', A.auth, (req, res) => {
  const plan = store.planOf(req.user);
  res.json({ status: true, user: publicUser(req.user), plan });
});

router.patch('/auth/profile', A.auth, async (req, res) => {
  try {
    const u = req.user;
    const username = String(req.body.username ?? u.username).trim();
    const email = String(req.body.email ?? u.email).trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!A.USERNAME_RE.test(username)) return bad(res, 'اسم المستخدم غير صالح (3-24 حرفاً بدون مسافات)');
    if (!A.EMAIL_RE.test(email)) return bad(res, 'البريد الإلكتروني غير صالح');
    let pw = null;
    if (password) {
      if (password.length < 8 || password.length > 128) return bad(res, 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
      if (!(await store.verifyPassword(String(req.body.currentPassword || ''), u))) return bad(res, 'كلمة المرور الحالية غير صحيحة', 403);
      pw = await store.hashPassword(password);
    }
    const result = store.mutate((d) => {
      if (d.users.some((x) => x.id !== u.id && (x.username.toLowerCase() === username.toLowerCase() || x.email === email))) return { error: 'الاسم أو البريد مستخدم بالفعل' };
      u.username = username; u.email = email;
      if (pw) { u.salt = pw.salt; u.passwordHash = pw.hash; u.tokenVersion = (u.tokenVersion || 0) + 1; }
      return { ok: true };
    });
    if (result.error) return bad(res, result.error, 409);
    let token;
    if (pw || username !== req.user.username) token = issue(req, res, u, true);
    res.json({ status: true, message: 'تم تحديث الحساب', user: publicUser(u), token });
  } catch (e) { console.error('[profile]', e); bad(res, 'حدث خطأ غير متوقع', 500); }
});

/* ---------- لوحة تحكم المستخدم ---------- */
router.get('/dashboard', A.auth, (req, res) => {
  const d = store.read();
  const u = req.user;
  const plan = store.planOf(u);
  const usage = store.usageFor(u.id);
  const keys = d.apiKeys.filter((k) => k.userId === u.id);
  const days = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(); dt.setUTCDate(dt.getUTCDate() - (6 - i));
    const key = dt.toISOString().slice(0, 10);
    return { date: key, count: usage.days[key] || 0 };
  });
  const requests = [];
  for (let i = d.requests.length - 1; i >= 0 && requests.length < 20; i--) if (d.requests[i].userId === u.id) requests.push(d.requests[i]);
  res.json({
    status: true,
    user: publicUser(u),
    plan,
    stats: {
      keys: keys.filter((k) => k.active).length,
      requests: usage.total, successful: usage.ok, usedToday: usage.count,
      dailyLimit: plan.dailyLimit, remaining: plan.dailyLimit === 0 ? null : Math.max(0, plan.dailyLimit - usage.count),
    },
    keys: keys.map(cleanKey),
    requests: requests.map((r) => ({ id: r.id, path: r.path, method: r.method, statusCode: r.statusCode, durationMs: r.durationMs, createdAt: r.createdAt })),
    days,
  });
});

/* ---------- مفاتيح API ---------- */
const cleanKey = (k) => ({ id: k.id, name: k.name, hint: `tb_live_••••${k.last6 || k.last4}`, last4: k.last4, active: k.active, requests: k.requests || 0, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt || null });
function newKeySecret() { return `tb_live_${crypto.randomBytes(24).toString('hex')}`; }

router.get('/keys', A.auth, (req, res) => {
  res.json({ status: true, keys: store.read().apiKeys.filter((k) => k.userId === req.user.id).map(cleanKey) });
});
router.post('/keys', A.auth, (req, res) => {
  const plan = store.planOf(req.user);
  const name = String(req.body.name || 'مفتاح جديد').trim().slice(0, 40) || 'مفتاح جديد';
  const raw = newKeySecret();
  const result = store.mutate((d) => {
    const active = d.apiKeys.filter((k) => k.userId === req.user.id && k.active).length;
    if (active >= plan.maxKeys) return { error: `وصلت للحد الأقصى من المفاتيح (${plan.maxKeys}) في خطتك` };
    const key = { id: store.id(), userId: req.user.id, name, secretHash: store.sha256(raw), last4: raw.slice(-4), last6: raw.slice(-6), createdAt: store.now(), requests: 0, active: true, limits: {}, endpointLimits: {} };
    d.apiKeys.push(key);
    return { key };
  });
  if (result.error) return bad(res, result.error, 403);
  res.status(201).json({ status: true, message: 'احفظ المفتاح الآن؛ لن يظهر كاملاً مرة أخرى', key: { ...cleanKey(result.key), token: raw } });
});
router.patch('/keys/:id', A.auth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 40);
  if (!name) return bad(res, 'اكتب اسماً للمفتاح');
  const k = store.mutate((d) => { const x = d.apiKeys.find((y) => y.id === req.params.id && y.userId === req.user.id); if (x) x.name = name; return x; });
  if (!k) return bad(res, 'المفتاح غير موجود', 404);
  res.json({ status: true, key: cleanKey(k) });
});
router.delete('/keys/:id', A.auth, (req, res) => {
  const r = store.mutate((d) => {
    const i = d.apiKeys.findIndex((k) => k.id === req.params.id && k.userId === req.user.id);
    if (i < 0) return null;
    if (d.apiKeys[i].active) { d.apiKeys[i].active = false; return 'revoked'; }
    d.apiKeys.splice(i, 1); return 'deleted';
  });
  if (!r) return bad(res, 'المفتاح غير موجود', 404);
  res.json({ status: true, message: r === 'revoked' ? 'تم إلغاء المفتاح' : 'تم حذف المفتاح' });
});

/* ---------- الدعم الفني ---------- */
const ticketView = (t, full = false) => ({
  id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt || t.createdAt,
  replies: (t.replies || []).length, ...(full ? { message: t.message, thread: t.replies || [] } : {}),
});
function createTicket(req, res) {
  if (A.hit(`ticket:${req.user.id}`, 8, 60 * 60 * 1000)) return bad(res, 'أرسلت تذاكر كثيرة، حاول لاحقاً', 429);
  const subject = String(req.body.subject || 'طلب دعم').trim().slice(0, 100) || 'طلب دعم';
  const message = String(req.body.message || '').trim().slice(0, 4000);
  if (message.length < 5) return bad(res, 'اكتب رسالة أوضح (5 أحرف على الأقل)');
  const t = store.mutate((d) => {
    const ticket = { id: store.id(), userId: req.user.id, username: req.user.username, email: req.user.email, subject, message, status: 'open', priority: 'normal', createdAt: store.now(), updatedAt: store.now(), replies: [] };
    d.tickets.push(ticket); return ticket;
  });
  res.status(201).json({ status: true, message: 'تم إرسال رسالتك، سنرد عليك قريباً', ticketId: t.id, ticket: ticketView(t) });
}
router.post('/support', A.auth, createTicket);
router.post('/tickets', A.auth, createTicket);
router.get('/tickets', A.auth, (req, res) => {
  res.json({ status: true, tickets: store.read().tickets.filter((t) => t.userId === req.user.id).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).map((t) => ticketView(t)) });
});
router.get('/tickets/:id', A.auth, (req, res) => {
  const t = store.read().tickets.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!t) return bad(res, 'التذكرة غير موجودة', 404);
  res.json({ status: true, ticket: ticketView(t, true) });
});
router.post('/tickets/:id/reply', A.auth, (req, res) => {
  const message = String(req.body.message || '').trim().slice(0, 4000);
  if (message.length < 2) return bad(res, 'اكتب ردك');
  const t = store.mutate((d) => {
    const x = d.tickets.find((y) => y.id === req.params.id && y.userId === req.user.id);
    if (!x) return null;
    (x.replies ||= []).push({ id: store.id(), by: 'user', name: req.user.username, message, createdAt: store.now() });
    x.status = 'open'; x.updatedAt = store.now(); return x;
  });
  if (!t) return bad(res, 'التذكرة غير موجودة', 404);
  res.status(201).json({ status: true, ticket: ticketView(t, true) });
});

module.exports = { router, publicUser };

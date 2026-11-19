'use strict';
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'terbo_token';

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  });
  return out;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** يتحقق من التوكن ويرجع المستخدم أو null. */
function resolveUser(token) {
  if (!token) return null;
  const payload = store.verifyToken(token);
  if (!payload) return null;
  const user = store.read().users.find((u) => u.id === payload.sub);
  if (!user || user.status === 'blocked') return null;
  if ((user.tokenVersion || 0) !== (payload.tv || 0)) return null;
  return user;
}

/** حماية الـ API: Authorization Bearer فقط (لا كوكيز، لتفادي CSRF). */
function auth(req, res, next) {
  const user = resolveUser(bearer(req));
  if (!user) return res.status(401).json({ status: false, message: 'يلزم تسجيل الدخول' });
  req.user = user;
  next();
}
function admin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ status: false, message: 'غير مصرح لك بهذه العملية' });
  next();
}

/** للصفحات فقط: يقرأ الجلسة من الكوكي (HttpOnly). */
function userFromCookie(req) {
  return resolveUser(parseCookies(req.headers.cookie)[COOKIE]);
}

function setSession(req, res, token, maxAgeSec) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---------- حدود بسيطة في الذاكرة ---------- */
const buckets = new Map();
/** يرجع true إذا تم تجاوز الحد. */
function hit(key, limit, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || t - b.start > windowMs) b = { start: t, count: 0 };
  b.count++;
  buckets.set(key, b);
  if (buckets.size > 20000) for (const [k, v] of buckets) if (t - v.start > windowMs) buckets.delete(k);
  return b.count > limit;
}
const peek = (key, limit, windowMs) => { const b = buckets.get(key); return !!b && Date.now() - b.start <= windowMs && b.count >= limit; };
const reset = (key) => buckets.delete(key);

/** إنشاء حساب المدير الرئيسي عند أول تشغيل (أو مزامنته مع .env). */
async function bootstrapAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const envPass = process.env.ADMIN_PASSWORD || '';
  const fp = envPass ? store.sha256(envPass) : '';
  let u = store.read().users.find((x) => x.id === 'root-admin');

  if (!u) {
    let pass = envPass, generated = false;
    if (!pass) { pass = crypto.randomBytes(9).toString('base64url'); generated = true; }
    const pw = await store.hashPassword(pass);
    store.mutate((d) => {
      d.users.push({
        id: 'root-admin', username, email: (process.env.ADMIN_EMAIL || 'admin@terbo.local').toLowerCase(),
        salt: pw.salt, passwordHash: pw.hash, role: 'admin', status: 'active', plan: 'unlimited', limits: {},
        tokenVersion: 0, envPassFp: fp, createdAt: store.now(),
      });
    });
    if (generated) {
      const line = '='.repeat(58);
      console.log(`\n${line}\n  تم إنشاء حساب المدير (يظهر هذا مرة واحدة فقط):\n  اسم المستخدم : ${username}\n  كلمة المرور  : ${pass}\n  غيّرها من لوحة الأدمن أو اضبط ADMIN_PASSWORD في .env\n${line}\n`);
    }
    return;
  }

  const patch = {};
  if (envPass && u.envPassFp !== fp) {
    const pw = await store.hashPassword(envPass);
    Object.assign(patch, { salt: pw.salt, passwordHash: pw.hash, envPassFp: fp, tokenVersion: (u.tokenVersion || 0) + 1 });
  }
  if (process.env.ADMIN_USERNAME && u.username !== username && !store.read().users.some((x) => x.id !== u.id && x.username.toLowerCase() === username.toLowerCase())) patch.username = username;
  if (u.role !== 'admin') patch.role = 'admin';
  if (u.status !== 'active') patch.status = 'active';
  if (!u.passwordHash) {
    const pass = envPass || crypto.randomBytes(9).toString('base64url');
    const pw = await store.hashPassword(pass);
    Object.assign(patch, { salt: pw.salt, passwordHash: pw.hash });
    if (!envPass) console.log(`\n[auth] تم تعيين كلمة مرور جديدة للمدير "${u.username}": ${pass}\n`);
  }
  if (Object.keys(patch).length) store.mutate(() => Object.assign(u, patch));
}

module.exports = {
  COOKIE, USERNAME_RE, EMAIL_RE, parseCookies, bearer, resolveUser, auth, admin, userFromCookie,
  setSession, clearSession, hit, peek, reset, bootstrapAdmin,
};

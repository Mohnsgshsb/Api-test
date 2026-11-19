'use strict';
/**
 * TERBO API — قاعدة البيانات (ملف JSON محلي).
 * - تُحمَّل مرة واحدة في الذاكرة وتُكتب على القرص بشكل مؤجل (debounce) وذرّي (tmp + rename)
 *   بدل إعادة كتابة الملف كله مع كل طلب.
 * - كلمات المرور: scrypt. التوكن: JWT HS256 مكتوب يدوياً بدون مكتبات.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const remote = require('./remote-db');

const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const REMOTE = remote.enabled();

/** مجلد البيانات: على Vercel (قرص للقراءة فقط) نستخدم /tmp، وأي مسار غير قابل للكتابة يتحول لـ /tmp أيضاً. */
function pickDataDir() {
  const want = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  if (!IS_VERCEL) {
    try { fs.mkdirSync(want, { recursive: true }); fs.accessSync(want, fs.constants.W_OK); return want; } catch (_) { /* fallback */ }
  }
  return path.join(os.tmpdir(), 'terbo-data');
}
const dataDir = pickDataDir();
const dbPath = path.join(dataDir, 'app-db.json');

const DEFAULT_PLANS = {
  free: { name: 'الخطة المجانية', dailyLimit: 1000, maxKeys: 3 },
  pro: { name: 'الخطة الاحترافية', dailyLimit: 20000, maxKeys: 10 },
  unlimited: { name: 'غير محدودة', dailyLimit: 0, maxKeys: 50 }, // 0 = بدون حد
};

const DEFAULT_SETTINGS = {
  siteName: 'TERBO API',
  tagline: 'منصة API متكاملة وسريعة تلبي جميع احتياجاتك التقنية',
  registrationEnabled: true,
  maintenance: false,
  maintenanceMessage: 'نقوم حالياً بأعمال صيانة وتحديث. سنعود قريباً.',
  requireKeyGlobal: false,
  anonymousPerMinute: 120,
  defaultPlan: 'free',
  announcement: { enabled: false, text: '', type: 'info' },
  contact: { email: 'support@terboapi.com', telegram: 'https://t.me/TerboAPI', discord: '' },
  plans: DEFAULT_PLANS,
};

function freshDb() {
  return {
    users: [], apiKeys: [], requests: [], tickets: [], endpointPolicies: {},
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    auditLog: [], usage: {}, catalog: null,
    stats: { totals: { total: 0, ok: 0 }, daily: {}, paths: {} },
    createdAt: new Date().toISOString(),
  };
}

let db = null;
let dirty = false;
let timer = null;
let catalogVersion = 0;
let remoteDirty = false;
let lastPull = 0;
let pulling = null;
let pushing = null;

function ensureDir() { try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) { /* ignore */ } }

function normalize(parsed) {
  const base = freshDb();
  const out = parsed ? { ...base, ...parsed } : base;
  out.settings = { ...base.settings, ...(parsed?.settings || {}) };
  out.settings.announcement = { ...base.settings.announcement, ...(out.settings.announcement || {}) };
  out.settings.contact = { ...base.settings.contact, ...(out.settings.contact || {}) };
  if (!out.settings.plans || !Object.keys(out.settings.plans).length) out.settings.plans = JSON.parse(JSON.stringify(DEFAULT_PLANS));
  out.stats = { ...base.stats, ...(parsed?.stats || {}) };
  out.stats.totals ||= { total: 0, ok: 0 };
  for (const k of ['users', 'apiKeys', 'requests', 'tickets', 'auditLog']) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of ['endpointPolicies', 'usage']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  return out;
}

function load() {
  ensureDir();
  let parsed = null;
  if (fs.existsSync(dbPath)) {
    try { parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
    catch (e) {
      const bad = `${dbPath}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(dbPath, bad); } catch (_) { /* ignore */ }
      console.error(`[store] ملف قاعدة البيانات تالف. تم حفظ نسخة في ${bad} وسيتم البدء بقاعدة جديدة.`);
    }
  }
  db = normalize(parsed);
}

function flushSync() {
  if (!dirty || !db) return;
  ensureDir();
  const tmp = `${dbPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(tmp, dbPath);
  dirty = false;
}
/** volatile = تغييرات خفيفة (إحصائيات/عدّادات) لا تستحق كتابة دائمة بعيدة. */
function schedule(volatile = false) {
  dirty = true;
  if (!volatile) remoteDirty = true;
  if (REMOTE) return; // على Vercel الحفظ يتم عبر commit() قبل إنهاء الرد
  if (timer) return;
  timer = setTimeout(() => { timer = null; try { flushSync(); } catch (e) { console.error('[store] فشل الحفظ:', e.message); } }, 400);
  if (timer.unref) timer.unref();
}

function read() { if (!db) load(); return db; }
/** تعديل متزامن ثم حفظ مؤجل. */
function mutate(fn, volatile = false) { if (!db) load(); const r = fn(db); schedule(volatile); return r; }
/** نفس mutate لكن يرجع Promise (للتوافق). */
function update(fn) { try { return Promise.resolve(mutate(fn)); } catch (e) { return Promise.reject(e); } }
function save(volatile = false) { schedule(volatile); }


/* ---------- التخزين الدائم البعيد (Vercel) ---------- */
function replaceDb(next) {
  const keepRequests = db?.requests || [];
  const fresh = normalize(next);
  fresh.requests = keepRequests;
  if (db) { for (const k of Object.keys(db)) delete db[k]; Object.assign(db, fresh); } else db = fresh;
  catalogVersion++;
}

function mergeFromRemote(remoteData) {
  // عند التعارض: نضيف أي سجلات موجودة عند الطرف الآخر وغير موجودة عندنا (مستخدمين/مفاتيح/تذاكر) ثم نكتب
  const r = normalize(remoteData);
  for (const k of ['users', 'apiKeys', 'tickets']) {
    const have = new Set(db[k].map((x) => x.id));
    for (const item of r[k]) if (!have.has(item.id)) db[k].push(item);
  }
}

/** تحميل آخر نسخة من GitHub (مع كاش قصير). force=true يتجاهل الكاش. */
async function sync(force = false) {
  if (!REMOTE) return;
  if (pushing) await pushing.catch(() => {});
  if (!force && db && Date.now() - lastPull < 2000) return;
  if (pulling) return pulling;
  pulling = (async () => {
    const r = await remote.pull();
    lastPull = Date.now();
    if (r.error && !db) load();
    else if (r.changed) {
      if (r.data) replaceDb(r.data);
      else if (!db) { db = normalize(null); }
      if (!r.data) remoteDirty = true; // أول تشغيل: نكتب النسخة الأولية
    }
    if (!db) load();
  })().finally(() => { pulling = null; });
  return pulling;
}

/** يكتب التغييرات المهمة إلى GitHub (يُستدعى قبل إنهاء الرد على Vercel). */
async function commit() {
  if (!REMOTE || !remoteDirty || !db) return;
  if (pushing) { await pushing.catch(() => {}); if (!remoteDirty) return; }
  pushing = (async () => {
    remoteDirty = false;
    const snapshot = () => ({ ...db, requests: [], auditLog: db.auditLog.slice(0, 200) });
    let r = await remote.push(snapshot());
    for (let i = 0; i < 2 && r.conflict; i++) {
      const latest = await remote.pull();
      if (latest.data) mergeFromRemote(latest.data);
      r = await remote.push(snapshot());
    }
    if (!r.ok) { remoteDirty = true; console.error('[store] تعذر حفظ قاعدة البيانات على GitHub'); }
    else lastPull = Date.now();
  })().finally(() => { pushing = null; });
  return pushing;
}

for (const sig of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { flushSync(); } catch (_) { /* ignore */ } if (sig !== 'exit') process.exit(0); });
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ---------- كلمات المرور ---------- */
async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const buf = await scrypt(String(password), salt, 64);
  return { salt, hash: buf.toString('hex') };
}
async function verifyPassword(password, user) {
  if (!user?.salt || !user?.passwordHash) return false;
  const buf = await scrypt(String(password), user.salt, 64);
  const expected = Buffer.from(user.passwordHash, 'hex');
  return buf.length === expected.length && crypto.timingSafeEqual(buf, expected);
}

/* ---------- JWT ---------- */
let cachedSecret = null;
function secret() {
  if (cachedSecret) return cachedSecret;
  const env = process.env.JWT_SECRET;
  if (env && env.length >= 32) return (cachedSecret = env);
  // وضع Vercel/GitHub: السر يُحفظ داخل قاعدة البيانات المشتركة حتى تتفق عليه كل الـ instances
  if (REMOTE) {
    const d = read();
    if (!d.jwtSecret || String(d.jwtSecret).length < 32) mutate((x) => { x.jwtSecret = crypto.randomBytes(48).toString('hex'); });
    return (cachedSecret = d.jwtSecret);
  }
  ensureDir();
  const file = path.join(dataDir, '.jwt-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return (cachedSecret = s);
  } catch (_) { /* سيتم الإنشاء */ }
  const s = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(file, s, { mode: 0o600 }); } catch (e) { console.error('[auth] تعذر حفظ JWT secret:', e.message); }
  console.warn('[auth] JWT_SECRET غير مضبوط؛ تم إنشاء سر عشوائي (يُفضّل ضبطه في .env / متغيرات Vercel).');
  return (cachedSecret = s);
}
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
function tokenFor(user, ttlSeconds = 60 * 60 * 24 * 7) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: user.id, username: user.username, role: user.role, tv: user.tokenVersion || 0, iat, exp: iat + ttlSeconds });
  const sig = crypto.createHmac('sha256', secret()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${h}.${p}`).digest();
  let actual;
  try { actual = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

/* ---------- الإحصائيات والاستهلاك ---------- */
function recordRequest(rec) {
  mutate((d) => {
    d.requests.push(rec);
    if (d.requests.length > 5000) d.requests.splice(0, d.requests.length - 5000);
    const day = rec.createdAt.slice(0, 10);
    const ok = rec.statusCode < 400;
    d.stats.totals.total++; if (ok) d.stats.totals.ok++;
    const dd = (d.stats.daily[day] ||= { total: 0, ok: 0, err: 0, users: 0 });
    dd.total++; ok ? dd.ok++ : dd.err++;
    const base = String(rec.path).split('?')[0];
    d.stats.paths[base] = (d.stats.paths[base] || 0) + 1;
    const keys = Object.keys(d.stats.paths);
    if (keys.length > 600) {
      const top = keys.sort((a, b) => d.stats.paths[b] - d.stats.paths[a]).slice(0, 300);
      const next = {}; top.forEach((k) => { next[k] = d.stats.paths[k]; }); d.stats.paths = next;
    }
    const days = Object.keys(d.stats.daily).sort();
    if (days.length > 120) days.slice(0, days.length - 120).forEach((k) => delete d.stats.daily[k]);
    if (rec.userId) {
      const u = (d.usage[rec.userId] ||= { date: day, count: 0, total: 0, ok: 0, days: {} });
      u.total++; if (ok) u.ok++;
      u.days[day] = (u.days[day] || 0) + 1;
      const ud = Object.keys(u.days).sort();
      if (ud.length > 31) ud.slice(0, ud.length - 31).forEach((k) => delete u.days[k]);
    }
  }, true);
}

/** يرجع استهلاك المستخدم لليوم الحالي (مع التصفير عند تغيّر اليوم). */
function usageFor(userId) {
  const d = read();
  const t = today();
  const u = (d.usage[userId] ||= { date: t, count: 0, total: 0, ok: 0, days: {} });
  if (u.date !== t) { u.date = t; u.count = 0; }
  return u;
}

function planOf(user) {
  const plans = read().settings.plans;
  const key = user?.plan && plans[user.plan] ? user.plan : read().settings.defaultPlan;
  const plan = plans[key] || plans.free || Object.values(plans)[0] || { name: key, dailyLimit: 1000, maxKeys: 3 };
  const limits = user?.limits || {};
  const num = (v, fb) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? fb : Number(v));
  return { id: key, name: plan.name, dailyLimit: num(limits.dailyLimit, plan.dailyLimit), maxKeys: num(limits.maxKeys, plan.maxKeys) };
}

function audit(action, details = {}, actor = 'system') {
  mutate((d) => {
    d.auditLog.unshift({ id: id(), action, details, actor, createdAt: now() });
    if (d.auditLog.length > 3000) d.auditLog.length = 3000;
  });
}

const catalogVer = () => catalogVersion;
const bumpCatalog = () => { catalogVersion++; };

module.exports = {
  read, mutate, update, save, id, now, today, sha256, hashPassword, verifyPassword, tokenFor, verifyToken,
  recordRequest, usageFor, planOf, audit, catalogVer, bumpCatalog, flushSync, sync, commit,
  DEFAULT_PLANS, DEFAULT_SETTINGS, dataDir, REMOTE,
};

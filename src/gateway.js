'use strict';
/**
 * بوابة الخدمات: تُطبَّق على كل مسارات الـ API العامة (وليس مسارات الحسابات أو الصفحات).
 * الترتيب: صيانة ← خدمة معطّلة ← مفتاح API ← سياسة الـ endpoint ← حد الخطة اليومي ← حد الزوار ← تسجيل الطلب.
 */
const crypto = require('crypto');
const store = require('./store');
const catalog = require('./catalog');

const SERVICE_PREFIXES = ['/api/', '/download/', '/search/', '/tools/', '/islami/', '/info/'];
const NOT_SERVICE = ['/api/account', '/api/public'];

const isService = (p) => SERVICE_PREFIXES.some((x) => p.startsWith(x)) && !NOT_SERVICE.some((x) => p === x || p.startsWith(`${x}/`));

const windows = new Map();   // سياسات الـ endpoint
const anon = new Map();      // حد الزوار لكل IP

function sweep(map, ttl) {
  if (map.size < 5000) return;
  const t = Date.now();
  for (const [k, v] of map) if (t - v.start > ttl) map.delete(k);
}

function findKey(raw) {
  if (!raw) return null;
  const h = store.sha256(raw);
  return store.read().apiKeys.find((k) => k.secretHash === h) || null;
}

/** مقارنة آمنة زمنياً لمفتاح الـ endpoint المخصّص. */
function sameKey(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * وضع المفتاح لهذا الـ endpoint:
 *  default = حسب الإعداد العام | none = بدون مفتاح | account = أي مفتاح حساب صالح | custom = مفتاح مخصّص يحدده الأدمن
 * (السياسات القديمة: requireKey=true تعني account).
 */
function keyModeOf(policy) {
  if (!policy) return 'default';
  if (['default', 'none', 'account', 'custom'].includes(policy.keyMode)) return policy.keyMode;
  return policy.requireKey ? 'account' : 'default';
}

const rxCache = new Map();
function policyFor(reqPath) {
  for (const [id, pol] of Object.entries(store.read().endpointPolicies)) {
    let rx = rxCache.get(id);
    if (!rx) { rx = catalog.pathToRegex(id); rxCache.set(id, rx); }
    if (rx.test(reqPath)) return { id, ...pol };
  }
  return null;
}

function gateway(req, res, next) {
  if (!isService(req.path)) return next();
  const d = store.read();
  const s = d.settings;
  const fail = (code, message, extra = {}) => res.status(code).json({ status: false, message, ...extra });

  if (s.maintenance) return fail(503, s.maintenanceMessage || 'الخدمة تحت الصيانة حالياً');
  if (catalog.isDisabled(req.path)) return fail(503, 'هذه الخدمة متوقفة مؤقتاً');

  // مفتاح API (من الهيدر أو من ?apikey=)
  let raw = req.get('x-api-key') || '';
  if (!raw && typeof req.query.apikey === 'string') raw = req.query.apikey;
  if (!raw) { const a = req.get('authorization') || ''; if (a.startsWith('Bearer tb_')) raw = a.slice(7).trim(); }

  const policy = policyFor(req.path);
  if (policy?.disabled) return fail(503, 'هذه الخدمة متوقفة مؤقتاً من الإدارة');
  const mode = keyModeOf(policy);
  let key = null, user = null;

  if (mode === 'custom') {
    // مفتاح خاص بهذا الـ endpoint فقط، يحدده الأدمن (مفاتيح الحسابات لا تعمل هنا)
    if (!policy.apiKey) return fail(503, 'هذه الخدمة غير مهيأة: لم يتم ضبط مفتاحها بعد');
    if (!raw) return fail(401, 'API Key مطلوب لهذه الخدمة');
    if (!sameKey(raw, policy.apiKey)) return fail(401, 'API Key غير صالح لهذه الخدمة');
  } else if (mode === 'none') {
    // بدون مفتاح: أي مفتاح مُرسل يُتجاهل
  } else {
    if (raw) {
      key = findKey(raw);
      if (!key || !key.active) return fail(401, 'API Key غير صالح أو ملغي');
      user = d.users.find((u) => u.id === key.userId);
      if (!user || user.status === 'blocked') return fail(403, 'الحساب غير متاح');
    }
    if ((mode === 'account' || s.requireKeyGlobal) && !key) return fail(401, 'API Key مطلوب لهذه الخدمة. أنشئ مفتاحاً من لوحة التحكم');
  }

  const t = Date.now();
  // سياسة الـ endpoint (حد لكل مفتاح/IP على هذا المسار)
  if (policy?.enabled && policy.limit > 0) {
    const override = key?.endpointLimits?.[policy.id] || key?.limits || {};
    const limit = Number(override.limit ?? policy.limit);
    const period = Number(override.windowSeconds ?? policy.windowSeconds ?? 60) * 1000;
    const id = `${key ? key.id : `ip:${req.ip}`}:${policy.id}`;
    let b = windows.get(id);
    if (!b || t - b.start >= period) b = { start: t, count: 0 };
    if (b.count >= limit) {
      const retry = Math.max(1, Math.ceil((b.start + period - t) / 1000));
      res.set('Retry-After', String(retry));
      return fail(429, 'تم استهلاك حد الطلبات لهذه الخدمة', { limit, remaining: 0, retryAfter: retry });
    }
    b.count++; windows.set(id, b); sweep(windows, 3600e3);
    res.set('X-RateLimit-Limit', String(limit)); res.set('X-RateLimit-Remaining', String(Math.max(0, limit - b.count)));
  }

  if (user) {
    // حد الخطة اليومي
    const plan = store.planOf(user);
    const usage = store.usageFor(user.id);
    if (plan.dailyLimit > 0 && usage.count >= plan.dailyLimit) {
      return fail(429, `انتهى حد خطتك اليومي (${plan.dailyLimit} طلب). يتجدد غداً أو يمكنك ترقية الخطة`, { limit: plan.dailyLimit, remaining: 0 });
    }
    usage.count++;
    key.lastUsedAt = store.now(); key.requests = (key.requests || 0) + 1;
    store.save(true);
    if (plan.dailyLimit > 0) { res.set('X-Daily-Limit', String(plan.dailyLimit)); res.set('X-Daily-Remaining', String(Math.max(0, plan.dailyLimit - usage.count))); }
  } else if (mode === 'custom' || (mode === 'none' && policy?.enabled && policy.limit > 0)) {
    // الحد الخاص بالـ endpoint (أعلاه) هو الحد الوحيد المطبّق؛ لا حاجة لحد الزوار العام
  } else {
    // زائر بدون مفتاح: حد لكل IP في الدقيقة
    const limit = Number(s.anonymousPerMinute || 120);
    let b = anon.get(req.ip);
    if (!b || t - b.start > 60000) b = { start: t, count: 0 };
    b.count++; anon.set(req.ip, b); sweep(anon, 60000);
    if (b.count > limit) { res.set('Retry-After', '60'); return fail(429, 'طلبات كثيرة، حاول بعد دقيقة (أنشئ مفتاح API لزيادة الحد)'); }
  }

  const started = Date.now();
  res.on('finish', () => {
    try {
      store.recordRequest({ id: store.id(), userId: user?.id || null, keyId: key?.id || null, path: String(req.originalUrl).slice(0, 300), method: req.method, statusCode: res.statusCode, durationMs: Date.now() - started, ip: req.ip, createdAt: store.now() });
    } catch (e) { console.error('[gateway] log error:', e.message); }
  });
  next();
}

module.exports = { gateway, isService };

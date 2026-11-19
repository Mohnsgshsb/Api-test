'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');

const store = require('./src/store');
const catalog = require('./src/catalog');
const A = require('./src/auth');
const pages = require('./src/pages');
const { gateway, isService } = require('./src/gateway');
const account = require('./src/account-routes');
const adminRoutes = require('./src/admin-routes');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const startedAt = Date.now();

app.disable('x-powered-by');
app.enable('trust proxy');
app.set('json spaces', 2);

// تهيئة أول تشغيل: تحميل قاعدة البيانات (من GitHub على Vercel) + الكتالوج + حساب المدير
const ready = (async () => {
  await store.sync(true);
  store.read();
  catalog.ensure();
  await A.bootstrapAdmin();
  await store.commit();
})().catch((e) => console.error('[bootstrap]', e));

// قبل كل طلب: تأكد من التهيئة وأحدث نسخة من البيانات، وبعد الرد احفظ أي تغيير مهم قبل ما يتجمّد الـ instance
app.use(async (req, res, next) => {
  try {
    await ready;
    if (store.REMOTE && !req.path.startsWith('/assets/') && req.path !== '/healthz' && !req.path.startsWith('/favicon')) {
      await store.sync();
      const end = res.end;
      res.end = function patchedEnd(...args) {
        res.end = end;
        store.commit().catch((e) => console.error('[commit]', e.message)).finally(() => end.apply(res, args));
        return res;
      };
    }
  } catch (e) { console.error('[sync]', e.message); }
  next();
});

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((x) => x.trim()) : true, credentials: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

/* ---------- ملفات ثابتة ---------- */
app.use('/assets', express.static(path.join(PUBLIC, 'assets'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/favicon.svg', (req, res) => res.type('image/svg+xml').sendFile(path.join(PUBLIC, 'favicon.svg')));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.floor(process.uptime()) }));

/* ---------- واجهات عامة (بدون تسجيل) ---------- */
const settingsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'settings.json'), 'utf8'));
const creator = settingsJson.apiSettings?.creator || 'TERBO API';

app.get('/api/public/config', (req, res) => {
  const s = store.read().settings;
  const plans = {};
  for (const [k, p] of Object.entries(s.plans)) plans[k] = { name: p.name, dailyLimit: p.dailyLimit, maxKeys: p.maxKeys };
  res.set('Cache-Control', 'no-store').json({
    status: true, siteName: s.siteName, tagline: s.tagline, registrationEnabled: s.registrationEnabled !== false,
    maintenance: !!s.maintenance, requireKeyGlobal: !!s.requireKeyGlobal, announcement: s.announcement, contact: s.contact, plans, defaultPlan: s.defaultPlan,
  });
});
app.get('/api/public/catalog', (req, res) => {
  res.set('Cache-Control', 'no-store').json({ status: true, categories: catalog.publicView() });
});
app.get('/api/public/stats', (req, res) => {
  const d = store.read();
  const cats = catalog.publicView();
  const recent = d.requests.slice(-200);
  const avgMs = recent.length ? Math.round(recent.reduce((s, r) => s + (r.durationMs || 0), 0) / recent.length) : 0;
  const sec = Math.floor(process.uptime());
  const days = Math.floor(sec / 86400), hours = Math.floor((sec % 86400) / 3600), minutes = Math.floor((sec % 3600) / 60);
  res.set('Cache-Control', 'no-store').json({
    status: true,
    apiCount: cats.reduce((n, c) => n + c.items.length, 0),
    categories: cats.length,
    users: d.users.filter((u) => u.id !== 'root-admin').length,
    successfulRequests: d.stats.totals.ok,
    totalRequests: d.stats.totals.total,
    avgMs,
    uptime: days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`,
    startedAt: new Date(startedAt).toISOString(),
  });
});
// توافق مع الملف القديم
app.get('/src/settings.json', (req, res) => res.set('Cache-Control', 'no-store').json(catalog.legacyView()));

/* ---------- الحسابات والأدمن ---------- */
app.use('/api/account', (req, res, next) => {
  if (A.hit(`acct:${req.ip}`, 600, 60 * 1000)) return res.status(429).json({ status: false, message: 'طلبات كثيرة، حاول بعد دقيقة' });
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/account', account.router);
app.use('/api/account/admin', adminRoutes.router);

/* ---------- الصفحات (لكل صفحة رابط مخصص) ---------- */
app.use(pages.build());

/* ---------- الخدمات: توحيد شكل الاستجابة + حماية + بوابة الحدود ---------- */
app.use((req, res, next) => {
  if (!isService(req.path)) return next();
  const original = res.json;
  res.json = function (data) {
    if (data && typeof data === 'object' && !Array.isArray(data)) return original.call(this, { status: data.status, creator, ...data });
    return original.call(this, data);
  };
  next();
});
app.use('/api/data', A.auth, A.admin); // مسارات تخزين GitHub للمدير فقط
app.use(gateway);
app.use(require('./src/custom').handler);

let totalRoutes = 0;
const apiFolder = path.join(__dirname, 'src', 'api');
for (const sub of fs.readdirSync(apiFolder)) {
  const dir = path.join(apiFolder, sub);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir)) {
    if (path.extname(file) !== '.js') continue;
    try { require(path.join(dir, file))(app); totalRoutes++; } catch (e) { console.error(`[routes] تعذر تحميل ${sub}/${file}: ${e.message}`); }
  }
}

/* ---------- 404 و 500 ---------- */
const wantsJson = (req) => isService(req.path) || req.path.startsWith('/api/') || !req.accepts(['html', 'json']) || req.accepts(['html', 'json']) === 'json';
app.use((req, res) => {
  if (wantsJson(req)) return res.status(404).json({ status: false, message: 'المسار غير موجود' });
  res.status(404).type('html').send(pages.html('404'));
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ status: false, message: 'صيغة JSON غير صحيحة' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ status: false, message: 'حجم الطلب كبير جداً' });
  console.error(err?.stack || err);
  if (wantsJson(req)) return res.status(500).json({ status: false, message: 'خطأ في الخادم' });
  res.status(500).type('html').send(pages.html('500'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TERBO API يعمل على المنفذ ${PORT} — ${totalRoutes} ملف خدمات تم تحميله`);
    console.log(`  الموقع:        http://localhost:${PORT}/`);
    console.log(`  لوحة الأدمن:   http://localhost:${PORT}/admin`);
  });
}

module.exports = app;

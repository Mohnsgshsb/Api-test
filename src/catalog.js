'use strict';
/**
 * كتالوج الأقسام والخدمات. يُزرع أول مرة من src/settings.json ثم يُدار بالكامل من لوحة الأدمن (يُحفظ في قاعدة البيانات).
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const API_DIR = path.join(__dirname, 'api');

const CATEGORY_META = {
  ai: { title: 'ذكاء اصطناعي', icon: 'brain', description: 'دردشة، صوت، صور ومساعدات ذكية بالذكاء الاصطناعي' },
  downloader: { title: 'التحميل', icon: 'download', description: 'API قوي لتحميل الملفات من أشهر المنصات' },
  canvas: { title: 'كانفاس', icon: 'palette', description: 'بطاقات وصور ترحيب وبروفايل جاهزة' },
  islami: { title: 'إسلامي', icon: 'moon', description: 'أحاديث ومواقيت الصلاة' },
  tools: { title: 'أدوات متنوعة', icon: 'wrench', description: 'أدوات مساعدة للصور والصوت والروابط' },
  'anime mods': { title: 'أنمي', icon: 'star', description: 'صور عشوائية لشخصيات الأنمي' },
  'search tools': { title: 'بحث ومعلومات', icon: 'search', description: 'بحث في يوتيوب وجيتهاب والأغاني والكلمات' },
  info: { title: 'بيانات ومعلومات', icon: 'database', description: 'معلومات وجداول متنوعة' },
  status: { title: 'الحالة', icon: 'signal', description: 'حالة الخدمة والخادم' },
  random: { title: 'عشوائي (Random)', icon: 'shuffle', description: 'محتوى عشوائي' },
};

function slugify(s, fallback = 'item') {
  const out = String(s || '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return out || fallback;
}
function uniqueSlug(base, taken) {
  let slug = base, n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

/** كل مسارات الخدمات المعرّفة فعلياً داخل ملفات src/api. */
function discoverRoutes() {
  const out = [];
  const re = /app\.(get|post|put|patch|delete)\s*\(\s*(['"`])(.*?)\2/g;
  for (const d of fs.readdirSync(API_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(API_DIR, d.name))) {
      if (!f.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(API_DIR, d.name, f), 'utf8');
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m[3].startsWith('/')) out.push({ method: m[1].toUpperCase(), path: m[3], category: d.name, file: f });
      }
    }
  }
  const seen = new Set();
  return out.filter((r) => { const k = `${r.method}:${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function pathToRegex(p) {
  const esc = String(p).split('?')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return new RegExp(`^${esc}/?$`);
}

function routeExists(routes, itemPath) {
  const base = String(itemPath || '').split('?')[0];
  return routes.some((r) => pathToRegex(r.path).test(base));
}

function seed() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8'));
  const routes = discoverRoutes();
  const takenCats = new Set();
  const categories = (raw.categories || []).map((c, ci) => {
    const meta = CATEGORY_META[String(c.name).trim().toLowerCase()] || {};
    const takenItems = new Set();
    return {
      id: store.id(),
      slug: uniqueSlug(slugify(c.name, `cat-${ci}`), takenCats),
      name: String(c.name).trim(),
      title: meta.title || String(c.name).trim(),
      icon: meta.icon || 'cube',
      description: meta.description || '',
      enabled: true,
      order: ci,
      items: (c.items || []).map((it, ii) => {
        const exists = routeExists(routes, it.path);
        return {
          id: store.id(),
          slug: uniqueSlug(slugify(it.name, `api-${ii}`), takenItems),
          name: String(it.name || '').replace(/[『】【]/g, '').trim(),
          desc: String(it.desc || '').trim(),
          path: it.path,
          method: 'GET',
          methods: ['GET'],
          // الخدمات التي لا يوجد لها route فعلي في السيرفر تُعطَّل تلقائياً (يمكن تفعيلها من لوحة الأدمن عند إضافة الكود).
          enabled: exists,
          note: exists ? '' : 'لا يوجد route لهذه الخدمة في السيرفر',
        };
      }),
    };
  });
  // خدمات موجودة في السيرفر لكنها غير مدرجة في الكتالوج القديم
  const islami = categories.find((c) => c.slug === 'islami');
  if (islami && !islami.items.some((i) => i.path.startsWith('/islami/jadwalsholat'))) {
    islami.items.push({ id: store.id(), slug: 'jadwal-sholat', name: 'مواقيت الصلاة', desc: 'مواقيت الصلاة حسب المدينة', path: '/islami/jadwalsholat?city=', method: 'GET', methods: ['GET'], enabled: true, note: '' });
  }
  return categories;
}

function ensure() {
  const db = store.read();
  if (!db.catalog || !Array.isArray(db.catalog.categories)) {
    store.mutate((d) => { d.catalog = { categories: seed(), updatedAt: store.now() }; });
    store.bumpCatalog();
  }
  return store.read().catalog;
}

function full() { return ensure().categories.slice().sort((a, b) => (a.order || 0) - (b.order || 0)); }

/** هل الأدمن فرض مفتاح API على هذا المسار؟ (مفتاح مخصص، أو مفتاح حساب، أو إلزام عام) */
function needsKey(itemPath) {
  const d = store.read();
  const base = String(itemPath || '').split('?')[0];
  for (const [id, pol] of Object.entries(d.endpointPolicies || {})) {
    if (!pathToRegex(id).test(base)) continue;
    const mode = ['default', 'none', 'account', 'custom'].includes(pol.keyMode) ? pol.keyMode : (pol.requireKey ? 'account' : 'default');
    if (mode === 'custom' || mode === 'account') return true;
    if (mode === 'none') return false;
    break;
  }
  return !!d.settings.requireKeyGlobal;
}

/** النسخة العامة: فقط الأقسام والخدمات المفعّلة. */
function publicView() {
  return full().filter((c) => c.enabled !== false).map((c) => ({
    slug: c.slug, name: c.name, title: c.title || c.name, icon: c.icon, description: c.description,
    items: (c.items || []).filter((i) => i.enabled !== false).map((i) => ({
      slug: i.slug, name: i.name, desc: i.desc, path: i.path, method: i.method || 'GET', methods: i.methods || [i.method || 'GET'], needsKey: needsKey(i.path),
    })),
  })).filter((c) => c.items.length);
}

/** نفس شكل settings.json القديم للتوافق مع أي عميل خارجي. */
function legacyView() {
  return { name: store.read().settings.siteName, categories: publicView().map((c) => ({ name: c.name, items: c.items.map((i) => ({ name: i.name, desc: i.desc, path: i.path })) })) };
}

let disabledCache = { ver: -1, list: [] };
/** مسارات الخدمات المعطّلة (قسم معطّل أو خدمة معطّلة). */
function disabledMatchers() {
  const v = store.catalogVer();
  if (disabledCache.ver === v && disabledCache.db === store.read().catalog) return disabledCache.list;
  const list = [];
  const enabledBases = new Set();
  const cats = full();
  for (const c of cats) for (const i of c.items || []) if (c.enabled !== false && i.enabled !== false) enabledBases.add(String(i.path).split('?')[0]);
  for (const c of cats) for (const i of c.items || []) {
    const base = String(i.path).split('?')[0];
    if ((c.enabled === false || i.enabled === false) && !enabledBases.has(base)) list.push(pathToRegex(base));
  }
  disabledCache = { ver: v, db: store.read().catalog, list };
  return list;
}
const isDisabled = (reqPath) => disabledMatchers().some((rx) => rx.test(reqPath));

module.exports = { ensure, full, publicView, legacyView, discoverRoutes, pathToRegex, isDisabled, slugify, uniqueSlug, CATEGORY_META };

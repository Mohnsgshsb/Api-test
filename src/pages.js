'use strict';
/**
 * كل صفحة لها رابط (endpoint) مخصص يُخدَّم من السيرفر مباشرة، فالريفرش يبقى في نفس الصفحة ولا يرجع للرئيسية.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('./store');
const catalog = require('./catalog');
const A = require('./auth');

const DIR = path.join(__dirname, '..', 'public', 'pages');
const PROD = process.env.NODE_ENV === 'production';
const cache = new Map();
function html(name) {
  if (PROD && cache.has(name)) return cache.get(name);
  const s = fs.readFileSync(path.join(DIR, `${name}.html`), 'utf8');
  if (PROD) cache.set(name, s);
  return s;
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DOC_SECTIONS = ['usage', 'examples', 'auth', 'limits', 'errors'];

/** يمنع إعادة التوجيه لروابط خارجية. */
function safeNext(n, fallback) {
  const s = String(n || '');
  return /^\/(?!\/)[^\s\\]*$/.test(s) ? s : fallback;
}

function send(res, name, status = 200) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(html(name));
}

function build() {
  const r = express.Router();

  // وضع الصيانة للصفحات العامة (المدير يتجاوزها، وصفحات الدخول والإدارة مستثناة)
  r.use((req, res, next) => {
    if (!store.read().settings.maintenance) return next();
    if (req.path === '/login' || req.path.startsWith('/admin')) return next();
    if (req.method !== 'GET') return next();
    const u = A.userFromCookie(req);
    if (u?.role === 'admin') return next();
    const msg = escHtml(store.read().settings.maintenanceMessage || '');
    res.status(503).set({ 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '600' }).send(html('maintenance').replace('{{MESSAGE}}', msg));
  });

  r.get('/index.html', (req, res) => res.redirect(301, '/'));

  // صفحات عامة
  r.get('/', (req, res) => send(res, 'home'));
  r.get('/categories', (req, res) => send(res, 'categories'));
  r.get('/category/:slug', (req, res, next) => {
    const c = catalog.publicView().find((x) => x.slug === req.params.slug);
    return c ? send(res, 'category') : next();
  });
  r.get('/category/:slug/:service', (req, res, next) => {
    const c = catalog.publicView().find((x) => x.slug === req.params.slug);
    return c && c.items.some((i) => i.slug === req.params.service) ? send(res, 'category') : next();
  });
  r.get('/docs', (req, res) => send(res, 'docs'));
  r.get('/docs/:section', (req, res, next) => (DOC_SECTIONS.includes(req.params.section) ? send(res, 'docs') : next()));
  r.get('/support', (req, res) => send(res, 'support'));
  r.get('/terms', (req, res) => send(res, 'legal'));
  r.get('/privacy', (req, res) => send(res, 'legal'));

  // الدخول والتسجيل: لو المستخدم مسجّل بالفعل يُحوَّل للوحة
  const guest = (name, adminArea = false) => (req, res) => {
    const u = A.userFromCookie(req);
    if (u && (!adminArea || u.role === 'admin')) return res.redirect(safeNext(req.query.next, adminArea ? '/admin' : (u.role === 'admin' ? '/admin' : '/dashboard')));
    send(res, name);
  };
  r.get('/login', guest('login'));
  r.get('/register', guest('login'));
  r.get('/admin/login', guest('login', true));

  // صفحات تتطلب تسجيل دخول
  const protect = (name) => (req, res) => {
    const u = A.userFromCookie(req);
    if (!u) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    send(res, name);
  };
  r.get('/dashboard', protect('dashboard'));
  r.get('/keys', protect('keys'));
  r.get('/account', protect('account'));

  // لوحة الأدمن (كل قسم له رابط مخصص)
  const ADMIN_SECTIONS = ['users', 'keys', 'catalog', 'endpoints', 'requests', 'tickets', 'settings', 'audit'];
  const adminGuard = (req, res, next) => {
    const u = A.userFromCookie(req);
    if (!u || u.role !== 'admin') return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    next();
  };
  r.get('/admin', adminGuard, (req, res) => send(res, 'admin'));
  r.get('/admin/:section', (req, res, next) => (ADMIN_SECTIONS.includes(req.params.section) ? adminGuard(req, res, () => send(res, 'admin')) : next()));

  return r;
}

module.exports = { build, html, escHtml };

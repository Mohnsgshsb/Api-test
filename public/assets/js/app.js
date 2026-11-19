/* TERBO API — shared client runtime (no dependencies) */
(function () {
  'use strict';
  const T = (window.T = {});

  /* ---------- Icons (inline SVG, no CDN) ---------- */
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5v-15Z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/><path d="M9 8h7"/>',
    headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4.5" height="6.5" rx="2"/><rect x="16.5" y="14" width="4.5" height="6.5" rx="2"/><path d="M19 20.5c0 1-1.5 1.5-3.5 1.5H13"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M18 14.3c2.2.7 3.5 2.5 3.5 5.7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9.5-9.5"/><path d="m16 7 3 3"/>',
    gauge: '<path d="M3.5 17a9 9 0 1 1 17 0"/><path d="m12 14.5 4-5"/><circle cx="12" cy="14.5" r="1.2"/>',
    dashboard: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2"/><rect x="3" y="15" width="8" height="6" rx="2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-6M13 17V7M18 17v-9"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    cloudDown: '<path d="M7 18a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 18.8 9.5 4.3 4.3 0 0 1 17.5 18"/><path d="M12 11.5v8"/><path d="m9 16.5 3 3 3-3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    play: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="m10.2 9.4 4.6 2.6-4.6 2.6V9.4Z" fill="currentColor"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    star: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8L12 3Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.7h.01"/>',
    signal: '<path d="M4 20v-3M9 20v-7M14 20V9M19 20V4"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    telegram: '<path d="M21.5 3.5 2.8 10.7c-.8.3-.8 1.4 0 1.7l4.7 1.6 1.8 5.6c.2.7 1.1.9 1.6.4l2.6-2.4 4.5 3.3c.6.4 1.4.1 1.6-.6l3-15.2c.2-.9-.7-1.5-1.5-1.1Z"/><path d="m8 14 9-6.5"/>',
    discord: '<path d="M7.5 6.5c3-1.3 6-1.3 9 0 2 2.8 3 6 3 9.5-1.4 1.4-3.5 2.1-4.7 2.2l-1-1.8h-4.6l-1 1.8C6.9 18.1 4.8 17.4 3.5 16c0-3.5 1-6.7 3-9.5Z"/><circle cx="9.3" cy="12.6" r="1.3"/><circle cx="14.7" cy="12.6" r="1.3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M5.5 15.5H5A2 2 0 0 1 3 13.5V5a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>',
    edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 7.5 3 3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    cog: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3 8.2 7.5 9.5 4.5-1.3 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.4 2.4 4-4.4"/>',
    bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4l2-2Z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z"/>',
    rocket: '<path d="M5 15c-1.5 1-2 4-2 6 2 0 5-.5 6-2"/><path d="M12 15 9 12c1-4 4.5-8.5 11-9 0 6.5-5 10-8 12Z"/><circle cx="15.5" cy="8.5" r="1.4"/><path d="M9 12H5l2-3h3M12 15v4l3-2v-3"/>',
    chevL: '<path d="m15 6-6 6 6 6"/>', chevR: '<path d="m9 6 6 6-6 6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
    arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.7"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4-4-7.8-9-7.8Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
    cube: '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    power: '<path d="M12 3v9"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    ticket: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M8 10h8M8 13h5"/>',
    megaphone: '<path d="m3 11 14-6v14L3 13v-2Z"/><path d="M7 14l1.5 6h3L10 15"/><path d="M20 9.5v5"/>',
    save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20Z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  };
  P.brain = P.cpu; P.tools = P.wrench; P.video = P.play; P.cloud = P.cloudDown; P.settings = P.cog;
  T.iconNames = Object.keys(P).filter((k) => !['brain', 'tools', 'video', 'cloud', 'settings', 'chevL', 'chevR', 'chevD', 'up', 'down', 'arrowL', 'x', 'check', 'eye', 'eyeOff', 'plus', 'trash', 'edit', 'copy', 'logout', 'menu'].includes(k));
  T.icon = (name, cls) => `<svg class="i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.cube}</svg>`;

  /* ---------- Helpers ---------- */
  T.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  T.$ = (s, r) => (r || document).querySelector(s);
  T.$$ = (s, r) => [...(r || document).querySelectorAll(s)];
  T.num = (n) => Number(n || 0).toLocaleString('en-US');
  T.compact = (n) => { n = Number(n || 0); if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'; return String(n); };
  T.date = (iso) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); };
  T.time = (iso) => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false }); };
  T.ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (isNaN(s)) return '—'; if (s < 60) return 'الآن'; if (s < 3600) return `منذ ${Math.floor(s / 60)} د`;
    if (s < 86400) return `منذ ${Math.floor(s / 3600)} س`; if (s < 86400 * 30) return `منذ ${Math.floor(s / 86400)} يوم`; return T.date(iso);
  };
  T.dayName = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short', timeZone: 'UTC' });
  T.copy = async (text, msg = 'تم النسخ') => {
    try { await navigator.clipboard.writeText(text); }
    catch (_) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } t.remove(); }
    T.toast(msg);
  };
  T.qs = (k) => new URLSearchParams(location.search).get(k);
  T.safeNext = (n, fb) => (/^\/(?!\/)[^\s\\]*$/.test(n || '') ? n : fb);
  T.debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  T.highlight = (json) => T.esc(json).replace(/(&quot;[^&]*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*)/g, (m, str, colon, kw, num) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (kw) return `<span class="n">${kw}</span>`; if (num) return `<span class="n">${num}</span>`; return m;
  });

  /* ---------- Toast & modal ---------- */
  T.toast = (msg, type = 'ok') => {
    let box = T.$('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = `toast ${type}`; el.innerHTML = `${T.icon(type === 'err' ? 'alert' : 'check')}<span>${T.esc(msg)}</span>`;
    box.appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, type === 'err' ? 4200 : 2600);
  };
  T.err = (e) => T.toast(e && e.message ? e.message : String(e), 'err');
  T.modal = ({ title = '', html = '', wide = false, actions = [], onClose } = {}) => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><h3>${title}</h3><div class="mbody">${html}</div><div class="actions"></div></div>`;
    document.body.appendChild(bg);
    const close = () => { bg.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    const box = T.$('.actions', bg);
    actions.forEach((a) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = `btn ${a.cls || 'btn-ghost'}`; b.innerHTML = a.label;
      b.onclick = async () => { if (a.close !== false && !a.onClick) return close(); b.disabled = true; try { const r = await a.onClick(bg, close); if (r !== false && a.close !== false) close(); } catch (e) { T.err(e); } finally { b.disabled = false; } };
      box.appendChild(b);
    });
    if (!actions.length) box.remove();
    const first = T.$('input,select,textarea', bg); if (first && !matchMedia('(pointer:coarse)').matches) setTimeout(() => first.focus(), 30);
    return { el: bg, close };
  };
  T.confirm = (msg, { ok = 'تأكيد', danger = true } = {}) => new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    T.modal({ title: T.icon('alert') + ' تأكيد', html: `<p style="margin:0;color:#d0c6f0;line-height:1.9">${T.esc(msg)}</p>`, onClose: () => fin(false),
      actions: [{ label: T.esc(ok), cls: danger ? 'btn-danger' : 'btn-primary', onClick: () => { fin(true); } }, { label: 'إلغاء', cls: 'btn-ghost' }] });
  });
  T.showSecret = (title, token, note) => T.modal({
    title: T.icon('key') + ' ' + T.esc(title),
    html: `<p class="muted" style="margin:0 0 4px">${T.esc(note || 'انسخ المفتاح الآن، لن يظهر كاملاً مرة أخرى.')}</p><div class="secret-box"><code id="sec">${T.esc(token)}</code><button class="btn btn-primary btn-sm" id="secCopy">${T.icon('copy')} نسخ</button></div>`,
    actions: [{ label: 'تم، حفظته', cls: 'btn-ghost' }],
  }).el.querySelector('#secCopy').addEventListener('click', () => T.copy(token, 'تم نسخ المفتاح'));

  /* ---------- Auth state ---------- */
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  T.token = LS.get('terbo_token') || '';
  try { T.user = JSON.parse(LS.get('terbo_user') || 'null'); } catch (e) { T.user = null; }
  if (!T.token) T.user = null;
  T.setAuth = (token, user) => { T.token = token || T.token; if (user) T.user = user; LS.set('terbo_token', T.token); LS.set('terbo_user', JSON.stringify(T.user)); try { sessionStorage.removeItem('terbo_nosess'); } catch (e) { /* ignore */ } };
  T.clearAuth = () => { T.token = ''; T.user = null; LS.del('terbo_token'); LS.del('terbo_user'); };
  T.logout = async (redirect = '/') => {
    try { await fetch('/api/account/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* ignore */ }
    T.clearAuth(); try { sessionStorage.setItem('terbo_nosess', '1'); } catch (e) { /* ignore */ }
    if (redirect) location.href = redirect;
  };
  /** لو الكوكي صالح لكن localStorage فارغ (مثلاً مسحه المتصفح) نستعيد الجلسة بدل ما نعمل لوب. */
  T.restoreSession = async () => {
    if (T.token) return true;
    try { if (sessionStorage.getItem('terbo_nosess')) return false; } catch (e) { /* ignore */ }
    try {
      const r = await fetch('/api/account/auth/session', { headers: { Accept: 'application/json' } });
      const d = await r.json();
      if (r.ok && d.token) { T.setAuth(d.token, d.user); return true; }
    } catch (e) { /* ignore */ }
    try { sessionStorage.setItem('terbo_nosess', '1'); } catch (e) { /* ignore */ }
    return false;
  };

  T.api = async (path, { method = 'GET', body, auth = true, headers = {} } = {}) => {
    const h = { Accept: 'application/json', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (auth && T.token) h.Authorization = `Bearer ${T.token}`;
    let res, data;
    try { res = await fetch(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت'); }
    try { data = await res.json(); } catch (e) { data = { status: false, message: 'استجابة غير مفهومة من الخادم' }; }
    if (res.status === 401 && auth && T.token && path.startsWith('/api/account')) {
      T.clearAuth(); fetch('/api/account/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).finally(() => { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search); });
      throw new Error(data.message || 'انتهت الجلسة');
    }
    if (!res.ok || data.status === false) { const e = new Error(data.message || data.error || 'حدث خطأ غير متوقع'); e.status = res.status; e.data = data; throw e; }
    return data;
  };
  T.acc = (p, o) => T.api('/api/account' + p, o);
  T.adm = (p, o) => T.api('/api/account/admin' + p, o);

  T.requireUser = async (admin = false) => {
    if (!(await T.restoreSession())) { location.replace(`/${admin ? 'admin/' : ''}login?next=${encodeURIComponent(location.pathname + location.search)}`); return new Promise(() => {}); }
    try {
      const me = await T.acc('/auth/me'); T.setAuth(T.token, me.user); T.plan = me.plan;
      if (admin && me.user.role !== 'admin') { location.replace('/dashboard'); return new Promise(() => {}); }
      return me.user;
    } catch (e) { if (e.status === 401) return new Promise(() => {}); throw e; }
  };

  /* ---------- Config / catalog ---------- */
  let cfgP, catP;
  T.config = () => (cfgP ||= fetch('/api/public/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ siteName: 'TERBO API', contact: {}, plans: {} })));
  T.catalog = () => (catP ||= fetch('/api/public/catalog', { cache: 'no-store' }).then((r) => r.json()).then((d) => d.categories || []).catch(() => []));

  /* ---------- Layout: header / footer ---------- */
  const logoHtml = '<a href="/" class="logo" aria-label="TERBO API"><span class="mark">&lt;/&gt;</span><b>TERBO</b> <b>API</b></a>';
  T.logoHtml = logoHtml;
  const NAV = [
    { href: '/', label: 'الرئيسية', icon: 'home', match: (p) => p === '/' },
    { href: '/categories', label: 'الأقسام', icon: 'layers', match: (p) => p.startsWith('/categor') },
    { href: '/docs', label: 'الوثائق', icon: 'book', match: (p) => p.startsWith('/docs') },
    { href: '/support', label: 'الدعم الفني', icon: 'headset', match: (p) => p.startsWith('/support') },
  ];
  function renderHeader() {
    const host = T.$('#hdr'); if (!host) return;
    const p = location.pathname.replace(/\/+$/, '') || '/';
    const items = NAV.slice();
    if (T.user) items.push({ href: '/dashboard', label: 'لوحة التحكم', icon: 'gauge', match: (x) => ['/dashboard', '/keys', '/account'].some((y) => x.startsWith(y)) });
    const links = (cls) => items.map((n) => `<a href="${n.href}" class="${n.match(p) ? 'active' : ''}">${T.icon(n.icon)} ${n.label}</a>`).join('');
    const u = T.user;
    const right = u
      ? `<div class="user-menu"><button class="user-chip" id="userBtn" aria-haspopup="true"><span class="avatar">${T.esc((u.username || '?')[0].toUpperCase())}</span><span class="nm">${T.esc(u.username)}</span>${T.icon('chevD')}</button>
          <div class="dropdown" id="userDrop"><div class="who">${T.esc(u.email || '')}</div>
            <a href="/dashboard">${T.icon('gauge')} لوحة التحكم</a><a href="/keys">${T.icon('key')} مفاتيح API</a><a href="/account">${T.icon('user')} حسابي</a>
            ${u.role === 'admin' ? `<a href="/admin">${T.icon('shield')} لوحة الإدارة</a>` : ''}<hr><button id="logoutBtn">${T.icon('logout')} تسجيل الخروج</button></div></div>`
      : `<a href="/login?next=${encodeURIComponent(p === '/login' || p === '/register' ? '/dashboard' : location.pathname)}" class="btn btn-ghost btn-sm">تسجيل الدخول</a><a href="/register" class="btn btn-primary btn-sm">إنشاء حساب</a>`;
    host.innerHTML = `<div id="announce"></div><header class="site-header"><div class="container bar">${logoHtml}<nav class="nav">${links()}</nav>
      <div class="head-actions">${right}<button class="icon-btn menu-btn" id="menuBtn" aria-label="القائمة">${T.icon('menu')}</button></div></div>
      <nav class="mobile-nav" id="mobNav">${links()}</nav></header>`;
    T.$('#menuBtn').onclick = () => T.$('#mobNav').classList.toggle('open');
    const ub = T.$('#userBtn'), ud = T.$('#userDrop');
    if (ub) {
      ub.onclick = (e) => { e.stopPropagation(); ud.classList.toggle('open'); };
      document.addEventListener('click', () => ud.classList.remove('open'));
      T.$('#logoutBtn').onclick = () => T.logout('/');
    }
  }
  function renderFooter() {
    const host = T.$('#ftr'); if (!host) return;
    host.innerHTML = `<footer class="site-footer"><div class="container bar"><span>© ${new Date().getFullYear()} TERBO API. جميع الحقوق محفوظة</span>
      <span class="links"><a href="/terms">الشروط والأحكام</a><a href="/privacy">سياسة الخصوصية</a><a href="/support">تواصل معنا</a></span>
      <span>صُنع بـ <span class="heart">♥</span> نحو مستقبل أفضل</span></div></footer>`;
  }
  async function renderAnnounce() {
    const c = await T.config(); const a = c.announcement; const host = T.$('#announce');
    if (host && a && a.enabled && a.text) host.innerHTML = `<div class="announce ${T.esc(a.type)}">${T.icon('megaphone')} ${T.esc(a.text)}</div>`;
    return c;
  }

  const queue = []; let booted = false;
  T.ready = (fn) => (booted ? fn() : queue.push(fn));
  async function boot() {
    if (!T.token) await T.restoreSession();
    renderHeader(); renderFooter(); renderAnnounce();
    booted = true; for (const fn of queue.splice(0)) { try { await fn(); } catch (e) { console.error(e); T.err(e); } }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  /* ---------- Charts ---------- */
  T.lineChart = (labels, values, { h = 220 } = {}) => {
    const W = 560, H = h, pl = 42, pr = 14, pt = 16, pb = 30;
    const max = Math.max(1, ...values);
    const step = Math.pow(10, Math.floor(Math.log10(max))); let top = Math.ceil(max / step) * step; if (top / step < 2) top = step * 2;
    if (top < 12) top = Math.max(3, Math.ceil(max / 3) * 3);
    const x = (i) => pl + (values.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (values.length - 1));
    const y = (v) => pt + (H - pt - pb) * (1 - v / top);
    const pts = values.map((v, i) => [x(i), y(v)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)},${Math.min(Math.max(c1[1], pt), H - pb).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(Math.max(c2[1], pt), H - pb).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    const area = `${d} L${pts[pts.length - 1][0]},${H - pb} L${pts[0][0]},${H - pb} Z`;
    const ticks = [0, 1, 2, 3].map((i) => top * (i / 3));
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="رسم بياني">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a855f7" stop-opacity=".45"/><stop offset="1" stop-color="#a855f7" stop-opacity="0"/></linearGradient>
      <filter id="${id}b"><feGaussianBlur stdDeviation="3"/></filter></defs>
      ${ticks.map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(139,92,246,.18)" stroke-dasharray="3 5"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end">${T.compact(Math.round(t))}</text>`).join('')}
      <path d="${area}" fill="url(#${id})"/><path d="${d}" fill="none" stroke="#a855f7" stroke-width="6" opacity=".5" filter="url(#${id}b)"/>
      <path d="${d}" fill="none" stroke="#c4b5fd" stroke-width="2.6" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.5" fill="#150b38" stroke="#c084fc" stroke-width="2.2"><title>${T.esc(labels[i])}: ${T.num(values[i])}</title></circle>`).join('')}
      ${labels.map((l, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${T.esc(l)}</text>`).join('')}</svg>`;
  };

  T.spinBtn = async (btn, fn) => {
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
  };
})();

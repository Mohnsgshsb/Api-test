'use strict';
/**
 * تخزين دائم لقاعدة البيانات داخل ملف JSON في مستودع GitHub (نفس إعدادات DATA_REPO_*).
 * يُستخدم على Vercel لأن قرص Vercel للقراءة فقط وكل طلب قد يمر على instance مختلف.
 * يعتمد على fetch المدمج في Node 18+ (بدون مكتبات).
 */
const owner = process.env.DATA_REPO_OWNER;
const repo = process.env.DATA_REPO_NAME || 'api-data';
const branch = process.env.DATA_REPO_BRANCH || 'main';
const token = process.env.DATA_REPO_TOKEN;
const FILE = process.env.DATA_REPO_DB_FILE || 'terbo/app-db.json';
const API = process.env.GITHUB_API_BASE || 'https://api.github.com';
const url = `${API}/repos/${owner}/${repo}/contents/${FILE}`;

const IS_VERCEL = !!(process.env.VERCEL || process.env.VERCEL_ENV);
const enabled = () => Boolean(owner && token && (IS_VERCEL || process.env.REMOTE_DB === '1'));

const headers = (extra = {}) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'terbo-api', ...extra });
const timeout = (ms) => AbortSignal.timeout(ms);

let sha = null;
let etag = null;

/** يرجع { changed, data } — data = null لو الملف غير موجود بعد. */
async function pull() {
  try {
    const r = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: headers(etag ? { 'If-None-Match': etag } : {}), signal: timeout(8000) });
    if (r.status === 304) return { changed: false };
    if (r.status === 404) { sha = null; etag = null; return { changed: true, data: null }; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const meta = await r.json();
    sha = meta.sha; etag = r.headers.get('etag');
    let text;
    if (meta.content) text = Buffer.from(meta.content, 'base64').toString('utf8');
    else { // ملف أكبر من 1MB: نقرأه بصيغة raw
      const raw = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: headers({ Accept: 'application/vnd.github.raw+json' }), signal: timeout(15000) });
      if (!raw.ok) throw new Error(`raw HTTP ${raw.status}`);
      text = await raw.text();
    }
    return { changed: true, data: JSON.parse(text) };
  } catch (e) {
    console.error('[remote-db] pull failed:', e.message);
    return { changed: false, error: true };
  }
}

/** يكتب الملف. عند التعارض يرجع { conflict: true } ليتولى المستدعي الدمج وإعادة المحاولة. */
async function push(value, message = 'update db') {
  const body = { message, branch, content: Buffer.from(JSON.stringify(value)).toString('base64'), ...(sha ? { sha } : {}) };
  try {
    const r = await fetch(url, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: timeout(15000) });
    if (r.status === 409 || r.status === 422) return { conflict: true };
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    sha = j.content.sha; etag = null; // الـ etag القديم لم يعد صالحاً
    return { ok: true };
  } catch (e) {
    console.error('[remote-db] push failed:', e.message);
    return { error: true };
  }
}

module.exports = { enabled, pull, push, FILE };

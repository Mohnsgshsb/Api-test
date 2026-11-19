'use strict';
/**
 * تخزين دائم داخل ريبو GitHub: كل جزء من البيانات في ملف .json مستقل داخل مجلد (الافتراضي terbo-data/).
 * يعتمد على fetch المدمج في Node 18+ (بدون مكتبات).
 *  - listing واحد للمجلد (مع ETag) يكشف أي ملف تغيّر، ثم نقرأ الملفات المتغيرة فقط.
 *  - الكتابة ملف بملف (Contents API) مع sha، وعند التعارض يرجع { conflict: true }.
 */
const owner = process.env.DATA_REPO_OWNER;
const repo = process.env.DATA_REPO_NAME || 'api-data';
const branch = process.env.DATA_REPO_BRANCH || 'main';
const token = process.env.DATA_REPO_TOKEN;
const DIR = String(process.env.DATA_REPO_DIR || 'terbo-data').replace(/^\/+|\/+$/g, '');
const API = process.env.GITHUB_API_BASE || 'https://api.github.com';
const base = `${API}/repos/${owner}/${repo}`;

/** مفعّل تلقائياً لو DATA_REPO_OWNER و DATA_REPO_TOKEN موجودين (REMOTE_DB=0 لإيقافه). */
const enabled = () => Boolean(owner && token && process.env.REMOTE_DB !== '0');

const headers = (extra = {}) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'terbo-api', ...extra });
const sig = (ms) => AbortSignal.timeout(ms);
const q = `ref=${encodeURIComponent(branch)}`;

const shas = {};   // name -> sha الحالي في GitHub
let etag = null;

async function getBlob(sha) {
  const r = await fetch(`${base}/git/blobs/${sha}`, { headers: headers(), signal: sig(20000) });
  if (!r.ok) throw new Error(`blob HTTP ${r.status}`);
  const j = await r.json();
  return Buffer.from(j.content, 'base64').toString('utf8');
}

/** يرجع { changed, files: {name: parsedJson}, empty } — files = الملفات التي تغيّرت فقط. */
async function pull() {
  try {
    const r = await fetch(`${base}/contents/${DIR}?${q}`, { headers: headers(etag ? { 'If-None-Match': etag } : {}), signal: sig(8000) });
    if (r.status === 304) return { changed: false, files: {} };
    if (r.status === 404) { for (const k of Object.keys(shas)) delete shas[k]; etag = null; return { changed: true, files: {}, empty: true }; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const list = (await r.json()).filter((e) => e.type === 'file' && e.name.endsWith('.json'));
    etag = r.headers.get('etag');
    const todo = list.filter((e) => shas[e.name] !== e.sha);
    const files = {};
    await Promise.all(todo.map(async (e) => { files[e.name] = JSON.parse(await getBlob(e.sha)); shas[e.name] = e.sha; }));
    return { changed: todo.length > 0, files, empty: list.length === 0 };
  } catch (e) {
    console.error('[remote-db] pull failed:', e.message);
    return { changed: false, files: {}, error: true };
  }
}

/** قراءة ملف واحد (للدمج عند التعارض) وتحديث sha الخاص به. */
async function pullFile(name) {
  try {
    const r = await fetch(`${base}/contents/${DIR}/${name}?${q}`, { headers: headers(), signal: sig(8000) });
    if (r.status === 404) { delete shas[name]; return null; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const meta = await r.json();
    shas[name] = meta.sha; etag = null;
    return JSON.parse(meta.content ? Buffer.from(meta.content, 'base64').toString('utf8') : await getBlob(meta.sha));
  } catch (e) {
    console.error(`[remote-db] pullFile ${name} failed:`, e.message);
    return null;
  }
}

/** يكتب ملفاً واحداً. { ok } | { conflict } | { error } */
async function putFile(name, text, message) {
  const body = { message: message || `update ${name}`, branch, content: Buffer.from(text).toString('base64'), ...(shas[name] ? { sha: shas[name] } : {}) };
  try {
    const r = await fetch(`${base}/contents/${DIR}/${name}`, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: sig(20000) });
    if (r.status === 409 || r.status === 422) return { conflict: true };
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    shas[name] = (await r.json()).content.sha; etag = null;
    return { ok: true };
  } catch (e) {
    console.error(`[remote-db] push ${name} failed:`, e.message);
    return { error: true };
  }
}

module.exports = { enabled, pull, pullFile, putFile, DIR };

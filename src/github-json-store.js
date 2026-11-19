const axios = require('axios');

const owner = process.env.DATA_REPO_OWNER;
const repo = process.env.DATA_REPO_NAME || 'api-data';
const branch = process.env.DATA_REPO_BRANCH || 'main';
const token = process.env.DATA_REPO_TOKEN;
const base = `https://api.github.com/repos/${owner}/${repo}/contents`;

function ready() {
  return Boolean(owner && token);
}
function headers() {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}
function safePath(file) {
  const value = String(file || '').replace(/^\/+/, '');
  if (!/^[a-zA-Z0-9_./-]+\.json$/.test(value) || value.includes('..')) throw new Error('Invalid JSON file path');
  return value;
}
async function read(file) {
  if (!ready()) throw new Error('GitHub JSON storage is not configured');
  const path = safePath(file);
  const { data } = await axios.get(`${base}/${path}`, { headers: headers(), params: { ref: branch } });
  const raw = Buffer.from(data.content, 'base64').toString('utf8');
  return { path, sha: data.sha, data: JSON.parse(raw) };
}
async function write(file, value, message = 'Update JSON data') {
  if (!ready()) throw new Error('GitHub JSON storage is not configured');
  const path = safePath(file);
  let sha;
  try { sha = (await axios.get(`${base}/${path}`, { headers: headers(), params: { ref: branch } })).data.sha; } catch (e) { if (e.response?.status !== 404) throw e; }
  const content = Buffer.from(JSON.stringify(value, null, 2) + '\n').toString('base64');
  const { data } = await axios.put(`${base}/${path}`, { message, content, branch, ...(sha ? { sha } : {}) }, { headers: headers() });
  return { path, sha: data.content.sha, commit: data.commit.html_url };
}
async function importAll(files = []) { const result = {}; for (const file of files) result[file] = (await read(file)).data; return result; }
module.exports = { ready, read, write, importAll };

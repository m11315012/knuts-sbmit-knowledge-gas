import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const env = parseEnv(await readFile('.env', 'utf8')), base = env.APP_ORIGIN;
for (const path of ['/', '/admin', '/assets/styles.css', '/assets/submit.js', '/assets/admin.js', '/api/health']) {
  const response = await fetch(base + path); assert.equal(response.status, 200, path);
  if (path === '/' || path === '/admin') { assert.match(response.headers.get('content-security-policy'), /script-src 'self'/); assert.doesNotMatch(await response.text(), /<\?!=|admin123|staff123/); }
}
let cookie = '', csrf = '';
async function api(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const setCookie = response.headers.getSetCookie(); if (setCookie.length) cookie = setCookie.map(value => value.split(';')[0]).join('; ');
  const result = await response.json(); assert.equal(response.status, 200); if (result.csrf) csrf = result.csrf; return result;
}
await api('/api/session');
assert.equal((await api('/api/login', { account: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD })).actor.role, 'ADMIN');
assert.equal((await api('/api/cases')).actor.account, env.ADMIN_USERNAME);
await api('/api/logout', {});
console.log('Local deployment verified: public form, admin page, assets, database health, administrator login and logout.');

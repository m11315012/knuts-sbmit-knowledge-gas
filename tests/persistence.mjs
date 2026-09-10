import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile), base = 'http://localhost:3001';
let cookie = '', csrf = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); if (result.csrf) csrf = result.csrf; return result;
}
await request('/api/session');
await request('/api/login', 'POST', { account: 'testadmin', password: 'integration-test-password-123' });
const before = await request('/api/cases'); assert.ok(before.total > 0, 'Run integration test first.');
const args = ['compose','-p','corpo-knowledge-test','-f','compose.yaml','-f','tests/compose.test.yaml'];
await run('docker', [...args, 'down'], { timeout: 60000 });
await run('docker', [...args, 'up', '-d', '--no-build', '--wait'], { timeout: 120000 });
const after = await request('/api/cases');
assert.equal(after.total, before.total); assert.deepEqual(after.cases, before.cases);
assert.equal((await request('/api/session')).actor.account, 'testadmin');
console.log('Persistence verified: cases and authenticated session survived container removal and recreation.');

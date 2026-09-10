import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { submissionSchema, decisionSchema, userSchema } from '../server/validation.js';
import { hashPassword, verifyPassword } from '../server/password.js';

test('Passwords are salted, verifiable, and reject wrong passwords', async () => {
  const one = await hashPassword('a-test-password-123'), two = await hashPassword('a-test-password-123');
  assert.notEqual(one, two); assert.equal(await verifyPassword('a-test-password-123', one), true);
  assert.equal(await verifyPassword('wrong-password', one), false); assert.equal(await verifyPassword('password', 'invalid'), false);
});
test('Submission validation rejects active content, credentials in URLs, and forged state fields', () => {
  const input = { requestId: '705198ab-7710-41cc-b8e8-89453d9e9896', name: '測試', email: 'test@example.com', identity: '老師', folderUrl: 'https://drive.google.com/drive/folders/test', notes: '' };
  assert.equal(submissionSchema.safeParse(input).success, true);
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) assert.equal(submissionSchema.safeParse({ ...input, folderUrl: url }).success, false);
  assert.equal(submissionSchema.safeParse({ ...input, status: 'APPROVED' }).success, false);
  assert.equal(submissionSchema.safeParse({ ...input, email: 'invalid' }).success, false);
});
test('Decisions require current version and a rejection reason; short passwords fail', () => {
  assert.equal(decisionSchema.safeParse({ version: 1, action: 'REJECT', note: '' }).success, false);
  assert.equal(decisionSchema.safeParse({ version: 1, action: 'APPROVE' }).success, true);
  assert.equal(decisionSchema.safeParse({ action: 'APPROVE' }).success, false);
  assert.equal(userSchema.safeParse({ account: 'admin', name: '管理員', role: 'ADMIN', enabled: true, password: 'short' }).success, false);
});
test('Both native browser clients parse and refer only to existing HTML IDs', () => {
  for (const page of ['admin', 'submit']) {
    const js = readFileSync(`public/${page}.js`, 'utf8'), html = readFileSync(`public/${page}.html`, 'utf8');
    new vm.Script(js, { filename: page + '.js' });
    assert.doesNotMatch(js, /google\.script|\.innerHTML\s*=|FrontendDemo/);
    assert.doesNotMatch(html, /<\?!=|admin123|staff123/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const match of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), 'Missing element: ' + match[1]);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { initialized, response } from './gas-mock.mjs';

test('All deployable JavaScript parses; password bundle runs without Node, DOM, TextEncoder or Web Crypto', () => {
  for (const file of readdirSync('.').filter(name => name.endsWith('.gs'))) new vm.Script(readFileSync(file, 'utf8'), { filename: file });
  new vm.Script(readFileSync('Client.html', 'utf8').replace(/^<script>\s*|\s*<\/script>\s*$/g, ''));
  const gas = vm.createContext({ Uint8Array });
  vm.runInContext(readFileSync('PasswordCrypto.gs', 'utf8'), gas);
  const result = gas.PasswordCrypto.derive(Uint8Array.from(Buffer.from('password')), Uint8Array.from(Buffer.from('salt')));
  assert.equal(result, pbkdf2Sync('password', 'salt', 600000, 32, 'sha256').toString('hex'));
});

test('Initialization hashes password, removes bootstrap secret and is repeatable', () => {
  const env = initialized(), users = env.sheets.get('使用者權限');
  assert.equal(users.data.length, 2);
  assert.notEqual(users.data[1][4], 'test-password-123');
  assert.equal(env.properties.has('INITIAL_ADMIN_PASSWORD'), false);
  env.context.setup_(); assert.equal(users.data.length, 2);
});

test('Authentication rejects wrong password, creates revocable session and exposes no credentials', () => {
  const { context: gas } = initialized();
  assert.throws(() => gas.login('admin', 'wrong'), /帳號或密碼/);
  const session = gas.login('ADMIN', 'test-password-123');
  assert.equal(gas.getDashboard(session.token).actor.account, 'admin');
  assert.deepEqual(Object.keys(gas.getUsers(session.token)[0]).sort(), ['account', 'enabled', 'name', 'role']);
  gas.logout(session.token); assert.throws(() => gas.getDashboard(session.token), /登入已過期/);
  assert.throws(() => gas.getDashboard('fake-session'), /請先登入/);
});

test('Submission is deduplicated, formula text is escaped, trigger installation is repeatable', () => {
  const env = initialized(), gas = env.context;
  const r = response('response-1', { '補充資訊': '=IMPORTXML("https://example.com", "//a")' });
  gas.ingest_(r); gas.ingest_(r);
  const rows = env.sheets.get('提交案件').data;
  assert.equal(rows.length, 2); assert.equal(rows[1][7], '=IMPORTXML("https://example.com", "//a")');
  assert.equal(gas.plain_('=1+1'), "'=1+1");
  gas.installFormTrigger_(); gas.installFormTrigger_(); assert.equal(env.triggers.length, 1);
  assert.throws(() => gas.onFormSubmit_({ response: r, source: { getId: () => 'wrong-form' } }), /設定的 Google Form/);
});

test('Staff cannot review or see pending cases; approved cases can be imported once', () => {
  const env = initialized(), gas = env.context;
  const admin = gas.login('admin', 'test-password-123');
  gas.saveUser(admin.token, { account: 'staff', name: '行政人員', password: 'staff-password-123', role: 'STAFF', enabled: true });
  const staff = gas.login('staff', 'staff-password-123');
  gas.ingest_(response());
  const item = gas.getDashboard(admin.token).cases[0];
  assert.equal(gas.getDashboard(staff.token).cases.length, 0);
  assert.throws(() => gas.getUsers(staff.token), /只有管理員/);
  assert.throws(() => gas.updateCase(staff.token, { id: item.id, version: 1, action: 'APPROVE' }), /只有管理員/);
  assert.throws(() => gas.updateCase(staff.token, { id: item.id, version: 1, action: 'IMPORT' }), /只有已通過/);
  gas.updateCase(admin.token, { id: item.id, version: 1, action: 'APPROVE', note: '已確認' });
  assert.equal(gas.getDashboard(staff.token).cases.length, 1);
  assert.throws(() => gas.updateCase(admin.token, { id: item.id, version: 1, action: 'REJECT', note: 'stale' }), /其他人更新/);
  gas.updateCase(staff.token, { id: item.id, version: 2, action: 'IMPORT' });
  const imported = gas.getDashboard(staff.token).cases[0];
  assert.equal(imported.importStatus, 'IMPORTED'); assert.equal(imported.history.length, 3); assert.equal(imported.importedBy, 'staff');
  assert.throws(() => gas.updateCase(staff.token, { id: item.id, version: 3, action: 'IMPORT' }), /只有已通過/);
});

test('Reject requires a note and disabled users lose active access immediately', () => {
  const env = initialized(), gas = env.context;
  const admin = gas.login('admin', 'test-password-123');
  gas.ingest_(response()); const item = gas.getDashboard(admin.token).cases[0];
  assert.throws(() => gas.updateCase(admin.token, { id: item.id, version: 1, action: 'REJECT', note: ' ' }), /填寫原因/);
  gas.updateCase(admin.token, { id: item.id, version: 1, action: 'REJECT', note: '請補充來源' });
  assert.equal(gas.getDashboard(admin.token).cases[0].status, 'REJECTED');
  gas.saveUser(admin.token, { account: 'staff', name: '行政', password: 'staff-password-123', role: 'STAFF', enabled: true });
  const staff = gas.login('staff', 'staff-password-123');
  gas.saveUser(admin.token, { account: 'staff', name: '行政', password: '', role: 'STAFF', enabled: false });
  assert.throws(() => gas.getDashboard(staff.token), /尚未取得/);
  assert.throws(() => gas.saveUser(admin.token, { account: 'admin', name: '管理員', password: '', role: 'STAFF', enabled: true }), /不能停用或降級/);
});

test('Password reset invalidates old sessions; reset password can log in', () => {
  const { context: gas } = initialized();
  const session = gas.login('admin', 'test-password-123');
  gas.saveUser(session.token, { account: 'admin', name: '管理員', password: 'new-password-123', role: 'ADMIN', enabled: true });
  assert.throws(() => gas.getDashboard(session.token), /尚未取得/);
  assert.equal(gas.login('admin', 'new-password-123').actor.role, 'ADMIN');
});

test('Expired sessions and repeated password guesses are rejected', () => {
  const env = initialized(), gas = env.context;
  const session = gas.login('admin', 'test-password-123');
  const key = 'session:' + gas.digest_(session.token), data = JSON.parse(env.cache.get(key));
  data.expiresAt = 0; env.cache.set(key, JSON.stringify(data));
  assert.throws(() => gas.getDashboard(session.token), /登入已過期/);
  for (let n = 0; n < 5; n++) assert.throws(() => gas.login('admin', 'wrong'), /帳號或密碼/);
  assert.throws(() => gas.login('admin', 'test-password-123'), /次數已達上限/);
});

test('Production HTML contains no demo credentials, unsafe interpolation, or Google OAuth', () => {
  const html = readFileSync('Index.html', 'utf8'), client = readFileSync('Client.html', 'utf8'), auth = readFileSync('Auth.gs', 'utf8');
  assert.doesNotMatch(html, /include_\('FrontendDemo'\)|admin123|staff123|GOOGLE IDENTITY|AUTH_CALLBACK/);
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
  assert.doesNotMatch(auth, /accounts\.google|oauth2\.google|Session\.get/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of client.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), 'Missing HTML element: ' + match[1]);
});

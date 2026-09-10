import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
function client() {
  let cookie = '', csrf = '';
  return {
    async request(path, method = 'GET', body, headers = {}) {
      const response = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const setCookies = response.headers.getSetCookie(); if (setCookies.length) cookie = setCookies.map(item => item.split(';')[0]).join('; ');
      const data = await response.json(); if (data.csrf) csrf = data.csrf;
      return { status: response.status, data, headers: response.headers };
    },
    async login(account, password) { await this.request('/api/session'); return this.request('/api/login', 'POST', { account, password }); }
  };
}
test('PostgreSQL-backed submission, authorization, review, audit, idempotency and revocation', async () => {
  const admin = client(), staff = client(), publicUser = client();
  const signIn = await admin.login('testadmin', 'integration-test-password-123'); assert.equal(signIn.status, 200);
  assert.match(signIn.headers.get('set-cookie'), /HttpOnly/i); assert.match(signIn.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.equal((await staff.request('/api/cases')).status, 401);
  assert.equal((await admin.request('/api/users','POST',{}, { Origin: 'https://attacker.example' })).status,403);
  assert.equal((await admin.request('/api/users','POST',{}, { 'X-CSRF-Token': '' })).status,403);
  const account = 'staff_' + randomUUID().slice(0,8);
  assert.equal((await admin.request('/api/users', 'POST', { account, name:'測試行政',role:'STAFF',enabled:true,password:'test-staff-password-123' })).status,200);
  assert.equal((await staff.login(account,'test-staff-password-123')).status,200);
  const users = (await admin.request('/api/users')).data;
  assert.ok(users.every(user => !('password_hash' in user) && !('password' in user)));
  assert.equal((await staff.request('/api/users')).status,403);
  await publicUser.request('/api/session');
  const body = { requestId:randomUUID(),name:'整合測試提交',email:'integration@example.com',identity:'老師',folderUrl:'https://drive.google.com/drive/folders/test',notes:'<script>alert(1)</script>' };
  const submission = await publicUser.request('/api/submissions','POST',body); assert.equal(submission.status,201);
  const id = submission.data.id;
  const duplicate = await publicUser.request('/api/submissions','POST',body); assert.equal(duplicate.status,200); assert.equal(duplicate.data.id,id);
  assert.equal((await publicUser.request('/api/submissions','POST',{ ...body, name:'different' })).status,409);
  assert.equal((await publicUser.request('/api/submissions','POST',{ ...body,requestId:randomUUID(),status:'APPROVED' })).status,400);
  assert.equal((await publicUser.request('/api/cases/' + id)).status,401);
  assert.equal((await staff.request('/api/cases/' + id)).status,404);
  assert.ok(!(await staff.request('/api/cases')).data.cases.some(item => item.id === id));
  assert.equal((await staff.request('/api/cases/'+id+'/decision','POST',{version:1,action:'APPROVE',note:''})).status,404);
  assert.equal((await admin.request('/api/cases/'+id+'/decision','POST',{version:1,action:'IMPORT',note:''})).status,409);
  assert.equal((await admin.request('/api/cases/'+id+'/decision','POST',{version:1,action:'REJECT',note:''})).status,400);
  assert.equal((await admin.request('/api/cases/'+id+'/decision','POST',{version:1,action:'APPROVE',note:'內容已核對'})).status,200);
  assert.equal((await admin.request('/api/cases/'+id+'/decision','POST',{version:1,action:'REJECT',note:'stale'})).status,409);
  assert.equal((await staff.request('/api/cases/'+id)).status,200);
  const results = await Promise.all([staff.request('/api/cases/'+id+'/decision','POST',{version:2,action:'IMPORT',note:''}),staff.request('/api/cases/'+id+'/decision','POST',{version:2,action:'IMPORT',note:''})]);
  assert.deepEqual(results.map(item=>item.status).sort(),[200,409]);
  const detail = (await admin.request('/api/cases/'+id)).data;
  assert.equal(detail.importStatus,'IMPORTED'); assert.equal(detail.history.length,3); assert.equal(detail.notes,body.notes);
  assert.equal((await admin.request('/api/cases?filter=IMPORTED&search='+id)).data.total,1);
  const staffRecord = users.find(user=>user.account === account);
  assert.equal((await admin.request('/api/users','POST',{account,name:'測試行政',role:'STAFF',enabled:false,password:'',version:staffRecord.version})).status,200);
  assert.equal((await staff.request('/api/cases')).status,401);
  const self = users.find(user=>user.account==='testadmin');
  assert.equal((await admin.request('/api/users','POST',{account:'testadmin',name:'管理員',role:'STAFF',enabled:true,password:'',version:self.version})).status,400);
  assert.equal((await admin.request('/api/logout','POST',{})).status,200);
  assert.equal((await admin.request('/api/cases')).status,401);
  assert.equal((await admin.login('testadmin','bad-password')).status,401);
});

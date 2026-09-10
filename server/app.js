import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { pool, transaction } from './db.js';
import { hashPassword, verifyPassword } from './password.js';
import { loginSchema, submissionSchema, decisionSchema, userSchema, querySchema, uuid, problem } from './validation.js';

const publicUser = row => ({ id: row.id, account: row.username, name: row.name, role: row.role, enabled: row.enabled, version: row.version });
const item = row => ({ id: row.id, name: row.name, email: row.email, identity: row.identity, folderUrl: row.folder_url, notes: row.notes,
  status: row.status, importStatus: row.import_status, submittedAt: row.submitted_at, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
  reviewNote: row.review_note, importedBy: row.imported_by, importedAt: row.imported_at, version: row.version });
const saveSession = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const rate = (windowMs, limit, message) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: message } });

export async function createApp() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const app = express(), secure = process.env.COOKIE_SECURE === 'true';
  const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
  const proxyHops = Number(process.env.TRUST_PROXY || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('Invalid TRUST_PROXY.');
  if (proxyHops) app.set('trust proxy', proxyHops);
  app.disable('x-powered-by');
  app.use(helmet({ strictTransportSecurity: secure ? undefined : false, contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: secure ? [] : null } } }));
  app.get('/api/health', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', rate(60000, 240, '請求過於頻繁，請稍後再試。'));
  app.use('/api', express.json({ limit: '32kb' }));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({ pool, tableName: 'session', createTableIfMissing: false });
  app.use('/api', session({ store, secret, name: 'corpo.sid', resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure, maxAge: 8 * 60 * 60 * 1000 } }));
  app.get('/api/session', async (req, res) => {
    req.session.csrf ||= randomBytes(32).toString('hex');
    let actor = null;
    if (req.session.user) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.session.user.id]);
      const user = rows[0];
      if (user?.enabled && user.auth_version === req.session.user.authVersion && req.session.user.expiresAt > Date.now()) actor = publicUser(user);
      else delete req.session.user;
    }
    await saveSession(req); res.json({ csrf: req.session.csrf, actor });
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('origin') !== origin) return next(problem(403, '請從系統網頁送出操作。'));
    const expected = req.session.csrf, actual = req.get('x-csrf-token');
    if (!expected || !actual || !/^[a-f0-9]{64}$/.test(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return next(problem(403, '驗證已失效，請重新整理頁面。'));
    next();
  });
  async function authenticated(req, res, next) {
    const auth = req.session.user;
    if (!auth || auth.expiresAt <= Date.now()) throw problem(401, '登入已過期，請重新登入。');
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [auth.id]);
    const user = rows[0];
    if (!user?.enabled || user.auth_version !== auth.authVersion) { delete req.session.user; throw problem(401, '帳號權限已異動，請重新登入。'); }
    req.actor = user; next();
  }
  function administrator(req, res, next) { if (req.actor.role !== 'ADMIN') throw problem(403, '只有管理員可以執行此操作。'); next(); }
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const accountLimiter = rateLimit({ windowMs: 15 * 60000, limit: 10, skipSuccessfulRequests: true, keyGenerator: req => String(req.body?.account || '').trim().toLowerCase().slice(0,64), standardHeaders: 'draft-8', legacyHeaders: false, message: { error: '登入嘗試次數已達上限，請 15 分鐘後再試。' } });
  app.post('/api/login', rate(15 * 60000, 30, '登入請求過於頻繁，請稍後再試。'), accountLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [input.account]);
    const user = rows[0], valid = await verifyPassword(input.password, user?.password_hash || dummyHash);
    if (!valid || !user?.enabled) throw problem(401, '帳號或密碼不正確，或此帳號已停用。');
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = { id: user.id, authVersion: user.auth_version, expiresAt: Date.now() + 8 * 3600000 };
    req.session.csrf = randomBytes(32).toString('hex'); await saveSession(req);
    res.json({ actor: publicUser(user), csrf: req.session.csrf });
  });
  app.post('/api/logout', async (req, res) => {
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('corpo.sid', { httpOnly: true, sameSite: 'strict', secure }); res.json({ ok: true });
  });

  app.post('/api/submissions', rate(60 * 60000, 20, '本時段提交次數已達上限，請稍後再試。'), async (req, res) => {
    const input = submissionSchema.parse(req.body);
    const result = await transaction(async db => {
      const values = [randomUUID(), input.requestId, input.name, input.email, input.identity, input.folderUrl, input.notes];
      const created = await db.query('INSERT INTO submissions(id,request_id,name,email,identity,folder_url,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(request_id) DO NOTHING RETURNING id,submitted_at', values);
      if (!created.rowCount) {
        const old = (await db.query('SELECT * FROM submissions WHERE request_id=$1', [input.requestId])).rows[0];
        if (!old || old.name !== input.name || old.email !== input.email || old.identity !== input.identity || old.folder_url !== input.folderUrl || old.notes !== input.notes) throw problem(409, '提交編號已使用，請重新整理後再填寫。');
        return { id: old.id, submittedAt: old.submitted_at, duplicate: true };
      }
      const row = created.rows[0];
      await db.query("INSERT INTO audit_events(id,submission_id,actor,action) VALUES ($1,$2,$3,'SUBMIT')", [randomUUID(), row.id, input.name]);
      return { id: row.id, submittedAt: row.submitted_at, duplicate: false };
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  app.get('/api/cases', authenticated, async (req, res) => {
    const query = querySchema.parse(req.query), parameters = [], conditions = [];
    if (req.actor.role !== 'ADMIN') conditions.push("status='APPROVED'");
    const visibility = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const counts = (await pool.query(`SELECT count(*)::int AS total,count(*) FILTER (WHERE status='PENDING')::int AS pending,count(*) FILTER (WHERE status='APPROVED' AND import_status='PENDING')::int AS approved,count(*) FILTER (WHERE import_status='IMPORTED')::int AS imported FROM submissions ${visibility}`)).rows[0];
    if (query.filter === 'APPROVED') conditions.push("status='APPROVED' AND import_status='PENDING'");
    else if (query.filter === 'IMPORTED') conditions.push("import_status='IMPORTED'");
    else if (query.filter !== 'ALL') { parameters.push(query.filter); conditions.push(`status=$${parameters.length}`); }
    if (query.search) { parameters.push('%' + query.search.replace(/[\\%_]/g, '\\$&') + '%'); conditions.push(`(name ILIKE $${parameters.length} OR email ILIKE $${parameters.length} OR id::text ILIKE $${parameters.length})`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const total = (await pool.query(`SELECT count(*)::int AS total FROM submissions ${where}`, parameters)).rows[0].total;
    const pageSize = 25, page = Math.min(query.page, Math.max(1, Math.ceil(total / pageSize)));
    parameters.push(pageSize, (page-1) * pageSize);
    const rows = (await pool.query(`SELECT * FROM submissions ${where} ORDER BY submitted_at DESC,id DESC LIMIT $${parameters.length-1} OFFSET $${parameters.length}`, parameters)).rows;
    res.json({ actor: publicUser(req.actor), cases: rows.map(item), counts, total, page, pageSize });
  });
  app.get('/api/cases/:id', authenticated, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const row = (await pool.query('SELECT * FROM submissions WHERE id=$1', [id])).rows[0];
    if (!row || (req.actor.role !== 'ADMIN' && row.status !== 'APPROVED')) throw problem(404, '找不到此案件。');
    const events = (await pool.query('SELECT actor,action,note,created_at AS at FROM audit_events WHERE submission_id=$1 ORDER BY created_at,id', [id])).rows;
    res.json({ ...item(row), history: events });
  });
  app.post('/api/cases/:id/decision', authenticated, async (req, res) => {
    const id = uuid.parse(req.params.id), input = decisionSchema.parse(req.body);
    await transaction(async db => {
      // Check the latest user record inside the same transaction as the mutation.
      const actor = (await db.query('SELECT * FROM users WHERE id=$1 FOR SHARE', [req.actor.id])).rows[0];
      if (!actor?.enabled || actor.auth_version !== req.session.user.authVersion) throw problem(401, '帳號權限已異動，請重新登入。');
      const row = (await db.query('SELECT * FROM submissions WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row || (actor.role === 'STAFF' && row.status !== 'APPROVED')) throw problem(404, '找不到此案件。');
      if (row.version !== input.version) throw problem(409, '案件已被其他人更新，請關閉明細並重新整理後再操作。');
      if (input.action === 'IMPORT') {
        if (row.status !== 'APPROVED' || row.import_status !== 'PENDING') throw problem(409, '只有已通過且尚未匯入的案件可以標記完成。');
        await db.query("UPDATE submissions SET import_status='IMPORTED',imported_by=$2,imported_at=now(),version=version+1 WHERE id=$1", [id, actor.username]);
      } else {
        if (actor.role !== 'ADMIN') throw problem(403, '只有管理員可以審核案件。');
        if (row.status !== 'PENDING') throw problem(409, '此案件已完成審核。');
        await db.query('UPDATE submissions SET status=$2,import_status=$3,reviewed_by=$4,reviewed_at=now(),review_note=$5,version=version+1 WHERE id=$1', [id, input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', input.action === 'APPROVE' ? 'PENDING' : 'NOT_READY', actor.username, input.note]);
      }
      await db.query('INSERT INTO audit_events(id,submission_id,user_id,actor,action,note) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, actor.id, actor.username, input.action, input.note]);
    });
    res.json({ ok: true });
  });
  app.get('/api/users', authenticated, administrator, async (req, res) => { res.json((await pool.query('SELECT * FROM users ORDER BY username')).rows.map(publicUser)); });
  app.post('/api/users', authenticated, administrator, async (req, res) => {
    const input = userSchema.parse(req.body);
    const hashed = input.password ? await hashPassword(input.password) : null;
    const result = await transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(8091032)');
      const actor = (await db.query('SELECT * FROM users WHERE id=$1 FOR SHARE', [req.actor.id])).rows[0];
      if (!actor?.enabled || actor.role !== 'ADMIN' || actor.auth_version !== req.session.user.authVersion) throw problem(401, '帳號權限已異動，請重新登入。');
      const old = (await db.query('SELECT * FROM users WHERE username=$1 FOR UPDATE', [input.account])).rows[0];
      if (input.account === actor.username && (!input.enabled || input.role !== 'ADMIN')) throw problem(400, '不能停用或降級目前登入的管理員。');
      if (old && old.version !== input.version) throw problem(409, '使用者資料已更新，請重新載入後再編輯。');
      if (!old && !hashed) throw problem(400, '新增使用者時必須設定密碼。');
      const changedAuth = !old || !!hashed || old.role !== input.role || old.enabled !== input.enabled;
      const id = old?.id || randomUUID();
      if (old) await db.query('UPDATE users SET name=$2,role=$3,enabled=$4,password_hash=$5,auth_version=auth_version+$6,version=version+1,updated_at=now() WHERE id=$1', [id,input.name,input.role,input.enabled,hashed || old.password_hash,changedAuth ? 1 : 0]);
      else await db.query('INSERT INTO users(id,username,name,password_hash,role,enabled) VALUES($1,$2,$3,$4,$5,$6)', [id,input.account,input.name,hashed,input.role,input.enabled]);
      await db.query('INSERT INTO audit_events(id,user_id,actor,action,details) VALUES ($1,$2,$3,$4,$5)', [randomUUID(),id,actor.username,old ? 'UPDATE_USER' : 'CREATE_USER',JSON.stringify({ role: input.role, enabled: input.enabled, passwordChanged: !!hashed })]);
      return { ok: true, sessionInvalidated: id === actor.id && changedAuth };
    });
    res.json(result);
  });
  const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
  app.use('/assets', express.static(publicDir, { index: false, dotfiles: 'deny', maxAge: 0 }));
  app.get('/', (req, res) => res.sendFile('submit.html', { root: publicDir }));
  app.get('/admin', (req, res) => res.sendFile('admin.html', { root: publicDir }));
  app.use((req, res) => res.status(404).json({ error: '找不到此頁面。' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) return res.status(400).json({ error: '欄位格式不正確，請確認必填欄位、網址與密碼長度。' });
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('Request failed:', error.code || error.name);
    res.status(status).json({ error: status >= 500 ? '系統暫時無法完成操作，請稍後重試。' : error.message });
  });
  return { app, store };
}

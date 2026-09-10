const CASE_HEADERS = ['案件ID', '來源回應ID', '提交時間', '電子郵件地址', '提交者姓名', '身分', '資料上傳資料夾URL', '補充資訊', '審核狀態', '審核人', '審核時間', '審核意見', '匯入狀態', '匯入人', '匯入時間', '版本', '操作歷程'];
const USER_HEADERS = ['帳號', '姓名', '角色', '啟用', '密碼雜湊', '密碼鹽值', '驗證版本', '權限歷程'];

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('CORPO｜知識庫審核系統')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

function config_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key) || PROJECT_CONFIG[key];
  if (!value) throw new Error('系統尚未完成設定，請聯絡系統管理員。');
  return value.trim();
}

function database_() { return SpreadsheetApp.openById(config_('SYSTEM_SPREADSHEET_ID')); }

function table_(name, headers) {
  const sheet = database_().getSheetByName(name);
  if (!sheet || sheet.getLastColumn() !== headers.length ||
      JSON.stringify(sheet.getRange(1, 1, 1, headers.length).getValues()[0]) !== JSON.stringify(headers)) {
    throw new Error('系統資料表結構不符，請聯絡系統管理員。');
  }
  return sheet;
}

function rows_(sheet) {
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

function locked_(action) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('系統忙碌中，請稍後重試。');
  try { return action(); } finally { lock.releaseLock(); }
}

function enabled_(value) { return value === true || String(value).toUpperCase() === 'TRUE'; }
function plain_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+@\-]/.test(text) ? "'" + text : text;
}
function clean_(value, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error('輸入內容格式或長度不符。');
  return value.trim();
}

function actor_(token) {
  if (typeof token !== 'string' || !/^[a-f0-9-]{72}$/.test(token)) throw new Error('請先登入系統。');
  const raw = CacheService.getScriptCache().get('session:' + digest_(token));
  if (!raw) throw new Error('登入已過期，請重新登入。');
  const session = JSON.parse(raw);
  if (session.expiresAt <= Date.now()) throw new Error('登入已過期，請重新登入。');
  const user = rows_(table_('使用者權限', USER_HEADERS)).find(row => String(row[0]).toLowerCase() === session.account);
  if (!user || !enabled_(user[3]) || Number(user[6]) !== session.version || !['ADMIN', 'STAFF'].includes(user[2])) {
    throw new Error('此帳號尚未取得系統使用權限，請聯絡管理員。');
  }
  return { account: session.account, name: String(user[1] || session.account), role: user[2] };
}

function admin_(token) {
  const actor = actor_(token);
  if (actor.role !== 'ADMIN') throw new Error('只有管理員可以執行此操作。');
  return actor;
}

function case_(row) {
  return { id: row[0], sourceId: row[1], submittedAt: String(row[2]), email: row[3], name: row[4], identity: row[5],
    folderUrl: row[6], notes: row[7], status: row[8], reviewedBy: row[9], reviewedAt: String(row[10]), reviewNote: row[11],
    importStatus: row[12], importedBy: row[13], importedAt: String(row[14]), version: Number(row[15]), history: JSON.parse(row[16] || '[]') };
}

function getDashboard(token) {
  const actor = actor_(token);
  const cases = rows_(table_('提交案件', CASE_HEADERS)).map(case_)
    .filter(item => actor.role === 'ADMIN' || item.status === 'APPROVED')
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return { actor, cases };
}

function updateCase(token, input) {
  return locked_(() => {
    const actor = actor_(token);
    if (!input || !['APPROVE', 'REJECT', 'IMPORT'].includes(input.action)) throw new Error('無效的操作。');
    const sheet = table_('提交案件', CASE_HEADERS);
    const records = rows_(sheet);
    const index = records.findIndex(row => row[0] === input.id);
    if (index < 0) throw new Error('找不到此案件。');
    const row = records[index];
    if (Number(row[15]) !== input.version) throw new Error('案件已被其他人更新，請重新整理後再操作。');
    const now = new Date().toISOString();
    const note = clean_(input.note || '', 2000);
    if (input.action === 'IMPORT') {
      if (!['ADMIN', 'STAFF'].includes(actor.role) || row[8] !== 'APPROVED' || row[12] !== 'PENDING') {
        throw new Error('只有已通過且尚未匯入的案件可以標記完成。');
      }
      row[12] = 'IMPORTED'; row[13] = actor.account; row[14] = now;
    } else {
      if (actor.role !== 'ADMIN') throw new Error('只有管理員可以審核案件。');
      if (row[8] !== 'PENDING') throw new Error('此案件已完成審核。');
      if (input.action === 'REJECT' && !note) throw new Error('退回時請填寫原因。');
      row[8] = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      row[9] = actor.account; row[10] = now; row[11] = note;
      row[12] = input.action === 'APPROVE' ? 'PENDING' : 'NOT_READY';
    }
    const history = JSON.parse(row[16] || '[]');
    history.push({ at: now, actor: actor.account, action: input.action, note });
    row[15] = Number(row[15]) + 1; row[16] = JSON.stringify(history);
    // The decision and its audit history are saved in the same row write.
    sheet.getRange(index + 2, 1, 1, CASE_HEADERS.length).setValues([row.map(plain_)]);
    SpreadsheetApp.flush();
    return { ok: true };
  });
}

function getUsers(token) {
  admin_(token);
  return rows_(table_('使用者權限', USER_HEADERS)).map(row => ({ account: row[0], name: row[1], role: row[2], enabled: enabled_(row[3]) }));
}

function saveUser(token, input) {
  return locked_(() => {
    const actor = admin_(token);
    if (!input) throw new Error('缺少使用者資料。');
    const account = account_(clean_(input.account, 64));
    const name = clean_(input.name, 100);
    if (!name || !['ADMIN', 'STAFF'].includes(input.role) || typeof input.enabled !== 'boolean') {
      throw new Error('請填寫有效的帳號、姓名與角色。');
    }
    if (account === actor.account && (input.role !== 'ADMIN' || !input.enabled)) throw new Error('不能停用或降級目前登入的管理員帳號。');
    const sheet = table_('使用者權限', USER_HEADERS);
    const records = rows_(sheet), index = records.findIndex(row => String(row[0]).toLowerCase() === account);
    const old = index < 0 ? null : records[index];
    const password = input.password || '';
    const credentials = !old || password ? passwordRecord_(password) : { hash: old[4], salt: old[5] };
    const changedAuth = !old || password || old[2] !== input.role || enabled_(old[3]) !== input.enabled;
    const version = old ? Number(old[6]) + (changedAuth ? 1 : 0) : 1;
    const history = old ? JSON.parse(old[7] || '[]') : [];
    history.push({ at: new Date().toISOString(), actor: actor.account, action: old ? 'UPDATE_USER' : 'CREATE_USER', role: input.role, enabled: input.enabled, passwordChanged: !!password });
    if (JSON.stringify(history).length > 45000) throw new Error('權限歷程已達儲存上限，請聯絡系統維護人員封存。');
    sheet.getRange(index < 0 ? sheet.getLastRow() + 1 : index + 2, 1, 1, USER_HEADERS.length)
      .setValues([[account, plain_(name), input.role, input.enabled, credentials.hash, credentials.salt, version, JSON.stringify(history)]]);
    SpreadsheetApp.flush();
    return { ok: true, sessionInvalidated: account === actor.account && !!changedAuth };
  });
}

// Editor-only setup helpers: trailing underscores prevent google.script.run access.
function setup_() {
  return locked_(() => {
  const db = database_();
  [['提交案件', CASE_HEADERS], ['使用者權限', USER_HEADERS]].forEach(([name, headers]) => {
    const sheet = db.getSheetByName(name) || db.insertSheet(name);
    if (!sheet.getLastRow()) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    table_(name, headers);
  });
  const users = table_('使用者權限', USER_HEADERS);
  if (!rows_(users).length) {
    const account = account_(config_('INITIAL_ADMIN_ACCOUNT'));
    const password = PropertiesService.getScriptProperties().getProperty('INITIAL_ADMIN_PASSWORD');
    const credentials = passwordRecord_(password);
    users.appendRow([account, '系統管理員', 'ADMIN', true, credentials.hash, credentials.salt, 1, JSON.stringify([{ at: new Date().toISOString(), actor: 'setup', action: 'CREATE_USER' }])]);
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().deleteProperty('INITIAL_ADMIN_PASSWORD');
  }
  });
}

function installFormTrigger_() {
  const formId = config_('FORM_ID');
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'onFormSubmit_' && trigger.getTriggerSourceId() === formId);
  if (!exists) ScriptApp.newTrigger('onFormSubmit_').forForm(FormApp.openById(formId)).onFormSubmit().create();
}

function onFormSubmit_(event) {
  if (!event || !event.response || !event.source || event.source.getId() !== config_('FORM_ID')) throw new Error('需要由設定的 Google Form 提交觸發。');
  ingest_(event.response);
}

function ingest_(response) {
  return locked_(() => {
    const sheet = table_('提交案件', CASE_HEADERS);
    const sourceId = response.getId();
    if (!sourceId) throw new Error('表單回應尚未提交。');
    if (rows_(sheet).some(row => row[1] === sourceId)) return;
    const answers = {};
    response.getItemResponses().forEach(item => { answers[item.getItem().getTitle().replace(/\s/g, '')] = String(item.getResponse()); });
    const now = new Date().toISOString();
    const row = [Utilities.getUuid(), sourceId, response.getTimestamp().toISOString(), response.getRespondentEmail() || answers['電子郵件地址'] || '',
      answers['提交者姓名'] || '', answers['身分'] || '', answers['資料上傳資料夾URL'] || '', answers['補充資訊'] || '',
      'PENDING', '', '', '', 'NOT_READY', '', '', 1, JSON.stringify([{ at: now, actor: 'Google Form', action: 'SUBMIT', note: '' }])];
    if (!row[4] || !/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[a-zA-Z0-9_-]+(?:[?#].*)?$/.test(row[6])) {
      throw new Error('缺少提交者姓名或有效的 Drive 資料夾網址，請檢查表單欄位。');
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row.map(plain_)]);
    SpreadsheetApp.flush();
  });
}

function syncExistingResponses_() {
  const errors = [];
  FormApp.openById(config_('FORM_ID')).getResponses().forEach(response => {
    try { ingest_(response); } catch (error) { errors.push({ responseId: response.getId(), message: error.message }); }
  });
  if (errors.length) throw new Error('部分回應未匯入：' + JSON.stringify(errors));
}

// Run in the Apps Script editor after setup. Read-only cloud compatibility check.
function verifySetup_() {
  const started = Date.now();
  const form = FormApp.openById(config_('FORM_ID'));
  const titles = form.getItems().map(item => item.getTitle().replace(/\s/g, ''));
  ['提交者姓名', '身分', '資料上傳資料夾URL', '補充資訊'].forEach(title => {
    if (!titles.includes(title)) throw new Error('找不到表單欄位：' + title);
  });
  table_('提交案件', CASE_HEADERS); table_('使用者權限', USER_HEADERS);
  const hash = hashPassword_('password', 'salt');
  if (hash !== '669cfe52482116fda1aa2cbe409b2f56c8e4563752b7a28f6eaab614ee005178') throw new Error('密碼運算自我檢查失敗。');
  const result = { ok: true, elapsedMs: Date.now() - started, formFields: titles, triggerInstalled: ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'onFormSubmit_' && trigger.getTriggerSourceId() === config_('FORM_ID')) };
  console.log(JSON.stringify(result));
  return result;
}

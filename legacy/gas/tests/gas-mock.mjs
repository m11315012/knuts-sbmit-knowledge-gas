import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID, pbkdf2Sync } from 'node:crypto';

export function environment() {
  const properties = new Map(), cache = new Map(), sheets = new Map(), triggers = [];
  const props = { getProperty: key => properties.get(key) ?? null, setProperty(key, value) { properties.set(key, value); return this; }, deleteProperty(key) { properties.delete(key); } };
  class Sheet {
    constructor() { this.data = []; }
    getLastRow() { return this.data.length; }
    getLastColumn() { return this.data.length ? Math.max(...this.data.map(row => row.length)) : 0; }
    setFrozenRows() {}
    appendRow(row) { this.data.push([...row]); }
    getRange(r, c, h, w) {
      return {
        getValues: () => Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => this.data[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues: values => values.forEach((row, i) => { this.data[r - 1 + i] ??= []; row.forEach((value, j) => { this.data[r - 1 + i][c - 1 + j] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value; }); })
      };
    }
  }
  const db = { getSheetByName: name => sheets.get(name) || null, insertSheet: name => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; } };
  const context = vm.createContext({
    console, Uint8Array,
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key) ?? null, put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
    SpreadsheetApp: { openById: () => db, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, value) => [...createHash('sha256').update(value).digest()], base64EncodeWebSafe: value => Buffer.from(value).toString('base64url'), newBlob: value => ({ getBytes: () => [...Buffer.from(value)] }) },
    PasswordCrypto: { derive: (password, salt) => pbkdf2Sync(password, salt, 600000, 32, 'sha256').toString('hex') },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: handler => ({ forForm: form => ({ onFormSubmit: () => ({ create: () => triggers.push({ getHandlerFunction: () => handler, getTriggerSourceId: () => form.getId() }) }) }) }) },
    FormApp: { openById: id => ({ getId: () => id }) }
  });
  for (const file of ['Config.gs', 'Code.gs', 'Auth.gs']) vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file });
  return { context, properties, cache, sheets, triggers };
}

export function response(id = 'response-1', overrides = {}) {
  const fields = { '提交者姓名': '測試老師', '身分': '老師', '資料上傳資料夾 URL': 'https://drive.google.com/drive/folders/test-folder', '補充資訊': '教材說明', ...overrides };
  return { getId: () => id, getTimestamp: () => new Date('2026-09-10T07:31:55Z'), getRespondentEmail: () => 'teacher@example.com', getItemResponses: () => Object.entries(fields).map(([title, value]) => ({ getItem: () => ({ getTitle: () => title }), getResponse: () => value })) };
}

export function initialized() {
  const env = environment();
  env.properties.set('INITIAL_ADMIN_ACCOUNT', 'admin');
  env.properties.set('INITIAL_ADMIN_PASSWORD', 'test-password-123');
  env.context.setup_();
  return env;
}

/** Account/password authentication; no Google user sign-in or OAuth client. */
function digest_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)).replace(/=+$/, '');
}
function account_(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.@-]{3,64}$/.test(value)) throw new Error('帳號請使用 3～64 個英數字、底線、句點、@ 或連字號。');
  return value.toLowerCase();
}
function hashPassword_(password, salt) {
  const bytes = value => new Uint8Array(Utilities.newBlob(value).getBytes().map(byte => byte & 255));
  return PasswordCrypto.derive(bytes(password), bytes(salt));
}
function passwordRecord_(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('密碼請使用 12～128 個字元。');
  const salt = Utilities.getUuid() + Utilities.getUuid();
  return { salt, hash: hashPassword_(password, salt) };
}
function equal_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function login(account, password) {
  const invalid = '帳號或密碼不正確，或此帳號已停用。';
  if (typeof account !== 'string' || !/^[A-Za-z0-9_.@-]{3,64}$/.test(account) || typeof password !== 'string' || password.length > 128 || !password) throw new Error(invalid);
  account = account.toLowerCase();
  const snapshot = locked_(() => {
    const properties = PropertiesService.getScriptProperties(), now = Date.now();
    const global = JSON.parse(properties.getProperty('LOGIN_RATE_GLOBAL') || '{}');
    if (!global.until || global.until <= now) { global.count = 0; global.until = now + 60000; }
    if (global.count >= 30) throw new Error('登入請求過於頻繁，請稍後再試。');
    global.count++; properties.setProperty('LOGIN_RATE_GLOBAL', JSON.stringify(global));
    const row = rows_(table_('使用者權限', USER_HEADERS)).find(item => String(item[0]).toLowerCase() === account);
    if (row) {
      const key = 'LOGIN_RATE_' + digest_(account), attempts = JSON.parse(properties.getProperty(key) || '{}');
      if (!attempts.until || attempts.until <= now) { attempts.count = 0; attempts.until = now + 15 * 60000; }
      if (attempts.count >= 5) throw new Error('登入嘗試次數已達上限，請 15 分鐘後重試。');
      attempts.count++; properties.setProperty(key, JSON.stringify(attempts));
    }
    return row;
  });
  const salt = snapshot ? String(snapshot[5]) : 'invalid-account-placeholder-salt';
  const calculated = hashPassword_(password, salt);
  if (!snapshot || !equal_(calculated, String(snapshot[4])) || !enabled_(snapshot[3])) throw new Error(invalid);
  return locked_(() => {
    const row = rows_(table_('使用者權限', USER_HEADERS)).find(item => String(item[0]).toLowerCase() === account);
    if (!row || !enabled_(row[3]) || !equal_(row[4], snapshot[4]) || Number(row[6]) !== Number(snapshot[6]) || !['ADMIN', 'STAFF'].includes(row[2])) throw new Error(invalid);
    const token = Utilities.getUuid() + Utilities.getUuid();
    CacheService.getScriptCache().put('session:' + digest_(token), JSON.stringify({ account, version: Number(row[6]), expiresAt: Date.now() + 3600000 }), 3600);
    PropertiesService.getScriptProperties().deleteProperty('LOGIN_RATE_' + digest_(account));
    return { token, actor: { account, name: String(row[1]), role: row[2] } };
  });
}

function logout(token) {
  if (typeof token === 'string' && /^[a-f0-9-]{72}$/.test(token)) CacheService.getScriptCache().remove('session:' + digest_(token));
  return { ok: true };
}

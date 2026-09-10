(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { token: '', actor: null, cases: [], filter: 'ALL', selected: null, selectedIds: new Set(), busy: false, page: 1, total: 0, pageSize: 25, counts: {}, editingUser: null };
  let csrf = '', generation = 0, refreshSequence = 0, openwebuiUrl = '', live = null;
  const labels = { PENDING: '待審核', APPROVED: '待匯入', REJECTED: '已退回', IMPORTED: '已匯入', ARCHIVED: '已封存' };
  const actions = { SUBMIT: '提交資料', APPROVE: '通過審核', REJECT: '退回補正', IMPORT: '完成知識庫匯入' };
  const storage = { get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }, set(key, value) { try { localStorage.setItem(key, value); } catch (_) {} } };
  async function request(url, method = 'GET', body) {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && state.actor) resetSession(result.error);
      throw new Error(result.error || '無法完成操作，請稍後再試。');
    }
    if (result.csrf) csrf = result.csrf;
    return result;
  }
  async function rpc(name, ...args) {
    if (name === 'login') { const result = await request('/api/login', 'POST', { account: args[0], password: args[1] }); openwebuiUrl = result.openwebuiUrl || ''; return { ...result, token: String(++generation) }; }
    if (name === 'logout') { const result = await request('/api/logout', 'POST', {}); await request('/api/session'); return result; }
    if (name === 'getDashboard') return request('/api/cases?' + new URLSearchParams({ page: state.page, filter: state.filter, search: $('search').value.trim() }));
    if (name === 'getCase') return request('/api/cases/' + encodeURIComponent(args[1]));
    if (name === 'getUsers') return request('/api/users');
    if (name === 'saveUser') return request('/api/users', 'POST', { ...args[1], ...(state.editingUser ? { version: state.editingUser.version } : {}) });
    if (name === 'updateCase') { const { id, ...body } = args[1]; return request('/api/cases/' + encodeURIComponent(id) + '/decision', 'POST', body); }
    if (name === 'archiveCase') return request('/api/cases/' + encodeURIComponent(args[1]) + '/archive', 'POST', {});
    if (name === 'deleteCase') return request('/api/cases/' + encodeURIComponent(args[1]) + '/delete', 'POST', {});
    if (name === 'batchCaseAction') return request('/api/cases/batch-action', 'POST', { action: args[1], ids: args[2] });
    throw new Error('不支援的操作。');
  }
  function message(id, error) { $(id).textContent = error ? (error.message || String(error)).replace(/^Exception: /, '') : ''; }
  function resetSession(text) {
    if (live) { live.close(); live = null; }
    state.token = ''; state.actor = null; state.cases = []; state.selected = null; state.selectedIds.clear(); state.filter = 'ALL'; state.page = 1;
    $('workspace').hidden = true; $('login').hidden = false; $('case-rows').replaceChildren(); $('user-rows').replaceChildren();
    $('user-form').reset(); $('detail').close(); $('detail-fields').replaceChildren(); $('history').replaceChildren(); $('search').value = '';
    $('detail-title').textContent = ''; $('detail-id').textContent = ''; $('detail-badge').replaceChildren(); $('folder-link').removeAttribute('href');
    $('actor-name').textContent = ''; $('actor-email').textContent = ''; $('actor-role').textContent = ''; $('review-note').value = '';
    message('global-status', ''); message('login-status', text); $('login-account').focus();
  }
  function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function date(value) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
  function status(item) { return item.importStatus === 'IMPORTED' ? 'IMPORTED' : item.status; }
  function badge(item) { const value = status(item); return element('span', labels[value] || value, 'badge ' + value.toLowerCase()); }
  function theme(value) { document.documentElement.dataset.theme = value; $('theme').textContent = value === 'night' ? 'NIGHT ◐' : 'DAY ◑'; $('theme').setAttribute('aria-label', value === 'night' ? '切換日間模式' : '切換夜間模式'); storage.set('corpo-theme', value); }
  theme(storage.get('corpo-theme') === 'day' ? 'day' : 'night');
  $('theme').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night'));
  $('brand').addEventListener('click', event => { event.preventDefault(); if (state.actor) showView('cases'); });

  function showWorkspace() {
    $('login').hidden = true; $('workspace').hidden = false;
    $('actor-name').textContent = state.actor.name;
    $('actor-email').textContent = state.actor.account;
    $('actor-role').textContent = state.actor.role === 'ADMIN' ? '管理員' : '行政人員';
    $('users-nav').hidden = state.actor.role !== 'ADMIN';
    const staff = state.actor.role === 'STAFF';
    $('workspace-kicker').textContent = staff ? 'IMPORT DESK / 01' : 'REVIEW CONSOLE / 01';
    $('workspace-title').firstChild.textContent = staff ? '匯入工作台' : '提交案件';
    $('role-description').textContent = staff ? '處理已通過審核的資料，完成 OpenWebUI 知識庫匯入。' : '檢視資料，完成審核與入庫交接。';
    $('cases-nav').querySelector('span').textContent = staff ? '匯入工作台' : '提交案件';
    document.querySelectorAll('[data-filter="PENDING"], [data-filter="REJECTED"], [data-filter="ARCHIVED"]').forEach(node => { node.hidden = staff; });
    connectLive();
    showView('cases');
  }
  $('login-button').disabled = true;
  request('/api/session').then(async result => {
    if (result.actor) { state.actor = result.actor; state.token = String(++generation); openwebuiUrl = result.openwebuiUrl || ''; await refresh(); showWorkspace(); }
    $('login-button').disabled = false;
  }).catch(error => { message('login-status', error); $('login-button').disabled = !csrf; });
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('login-button'); button.disabled = true; button.textContent = '登入中…'; message('login-status', '');
    try {
      const result = await rpc('login', $('login-account').value.trim(), $('login-password').value);
      state.token = result.token; state.actor = result.actor;
      $('login-password').value = '';
      await refresh();
      showWorkspace();
    } catch (error) { state.token = ''; state.actor = null; message('login-status', error); }
    finally { button.disabled = false; button.textContent = '登入工作台 ↗'; }
  });
  $('logout').addEventListener('click', async () => {
    const token = state.token;
    resetSession('已登出。');
    try { await rpc('logout', token); } catch (_) { message('login-status', '已關閉本機登入狀態；伺服器連線失敗，原登入憑證將於到期後失效。'); }
  });
  async function refresh() {
    const token = state.token;
    const sequence = ++refreshSequence;
    $('refresh').disabled = true;
    try {
      const result = await rpc('getDashboard', token);
      if (state.token !== token || sequence !== refreshSequence) return;
      state.actor = result.actor; state.cases = result.cases;
      const visibleIds = new Set(state.cases.map(item => item.id)); state.selectedIds = new Set([...state.selectedIds].filter(id => visibleIds.has(id)));
      state.counts = result.counts; state.total = result.total; state.page = result.page; state.pageSize = result.pageSize;
      renderCases(); message('global-status', '');
    } finally { $('refresh').disabled = false; }
  }
  function connectLive() {
    if (live) live.close();
    live = new EventSource('/api/events');
    live.onopen = () => $('live-indicator').classList.remove('offline');
    live.onerror = () => $('live-indicator').classList.add('offline');
    live.addEventListener('cases_changed', () => { if (!state.busy) load(); });
    live.addEventListener('users_changed', () => { if (state.actor?.role === 'ADMIN' && !$('users-view').hidden) loadUsers().catch(error => message('global-status', error)); });
  }
  $('refresh').addEventListener('click', () => refresh().catch(error => message('global-status', error)));
  function renderCases() {
    $('count-all').textContent = String(state.counts.total || 0).padStart(2, '0');
    $('count-pending').textContent = String(state.counts.pending || 0).padStart(2, '0');
    $('count-approved').textContent = String(state.counts.approved || 0).padStart(2, '0');
    $('count-imported').textContent = String(state.counts.imported || 0).padStart(2, '0');
    const items = state.cases, canManage = state.actor?.role === 'ADMIN';
    $('select-all').closest('th').hidden = !canManage;
    const body = $('case-rows'); body.replaceChildren();
    items.forEach(item => {
      const tr = element('tr'), submitter = element('td');
      submitter.append(element('strong', item.name), element('small', item.email), element('small', '#' + item.id.slice(0, 8).toUpperCase(), 'mono'));
      const stateCell = element('td'); stateCell.append(badge(item));
      const action = element('td'), button = element('button', '檢視 ↗', 'secondary');
      button.setAttribute('aria-label', '檢視 ' + item.name + ' 的案件'); button.addEventListener('click', async () => { button.disabled = true; try { await openDetail(item.id); } catch (error) { message('global-status', error); } finally { button.disabled = false; } }); action.append(button);
      const selectCell = element('td', null, 'select-col');
      if (canManage) { const label = element('label', null, 'case-select'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selectedIds.has(item.id); checkbox.setAttribute('aria-label', '選取 ' + item.name); checkbox.addEventListener('change', () => { if (checkbox.checked) state.selectedIds.add(item.id); else state.selectedIds.delete(item.id); updateSelectionUI(); }); label.append(checkbox); selectCell.append(label); }
      selectCell.hidden = !canManage;
      tr.append(selectCell, submitter, element('td', item.identity), element('td', date(item.submittedAt)), stateCell, action); body.append(tr);
    });
    $('empty').hidden = items.length > 0;
    $('empty').querySelector('h3').textContent = state.counts.total ? '沒有符合條件的案件' : '目前沒有案件';
    $('empty').querySelector('p').textContent = state.counts.total ? '請調整篩選條件或搜尋關鍵字。' : '新的表單資料送達後，會顯示在這裡。';
    $('result-count').textContent = '顯示 ' + items.length + ' / ' + state.total + ' 筆案件';
    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    $('page-label').textContent = state.page + ' / ' + pages; $('previous-page').disabled = state.page <= 1; $('next-page').disabled = state.page >= pages;
    document.querySelectorAll('[data-filter]').forEach(button => { button.classList.toggle('selected', button.dataset.filter === state.filter); button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)); });
    updateSelectionUI();
  }
  function updateSelectionUI() {
    const canManage = state.actor?.role === 'ADMIN', selected = state.cases.filter(item => state.selectedIds.has(item.id));
    $('bulk-actions').hidden = !canManage || state.selectedIds.size === 0;
    $('selection-count').textContent = '已選取 ' + state.selectedIds.size + ' 筆';
    $('select-all').checked = canManage && state.cases.length > 0 && selected.length === state.cases.length;
    $('select-all').indeterminate = canManage && selected.length > 0 && selected.length < state.cases.length;
  }
  async function batchAction(action) {
    if (state.busy || state.actor?.role !== 'ADMIN' || state.selectedIds.size === 0) return;
    const ids = [...state.selectedIds];
    const prompt = action === 'ARCHIVE' ? '確定要封存選取的 ' + ids.length + ' 筆案件嗎？' : '確定要刪除選取的 ' + ids.length + ' 筆案件嗎？此操作會保留稽核紀錄。';
    if (!window.confirm(prompt)) return;
    state.busy = true; $('bulk-archive').disabled = true; $('bulk-delete').disabled = true; message('global-status', '處理中…');
    try { const result = await rpc('batchCaseAction', state.token, action, ids); state.selectedIds.clear(); await refresh(); message('global-status', (action === 'ARCHIVE' ? '已封存 ' : '已刪除 ') + result.count + ' 筆案件。'); }
    catch (error) { message('global-status', error); }
    finally { state.busy = false; $('bulk-archive').disabled = false; $('bulk-delete').disabled = false; }
  }
  const load = () => refresh().catch(error => message('global-status', error));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { state.filter = button.dataset.filter; state.page = 1; state.selectedIds.clear(); load(); }));
  $('select-all').addEventListener('change', () => { if ($('select-all').checked) state.cases.forEach(item => state.selectedIds.add(item.id)); else state.cases.forEach(item => state.selectedIds.delete(item.id)); renderCases(); });
  $('clear-selection').addEventListener('click', () => { state.selectedIds.clear(); renderCases(); });
  $('bulk-archive').addEventListener('click', () => batchAction('ARCHIVE'));
  $('bulk-delete').addEventListener('click', () => batchAction('DELETE'));
  let searchTimer;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.page = 1; state.selectedIds.clear(); load(); }, 250); });
  $('previous-page').addEventListener('click', () => { state.page--; state.selectedIds.clear(); load(); });
  $('next-page').addEventListener('click', () => { state.page++; state.selectedIds.clear(); load(); });
  function showView(view) {
    if (view === 'users' && state.actor.role !== 'ADMIN') return;
    $('cases-view').hidden = view !== 'cases'; $('users-view').hidden = view !== 'users';
    $('cases-nav').classList.toggle('active', view === 'cases'); $('users-nav').classList.toggle('active', view === 'users');
    if (view === 'users') loadUsers().catch(error => message('global-status', error));
  }
  $('cases-nav').addEventListener('click', () => showView('cases'));
  $('users-nav').addEventListener('click', () => showView('users'));
  async function openDetail(id) {
    const token = state.token;
    const item = await rpc('getCase', token, id); if (state.token !== token || !state.actor) return;
    state.selected = item;
    $('detail-id').textContent = '#' + item.id.toUpperCase(); $('detail-title').textContent = item.name + ' 的提交資料';
    $('detail-badge').replaceChildren(badge(item));
    const fields = [['電子郵件', item.email], ['身分', item.identity], ['提交時間', date(item.submittedAt)], ['資料夾網址', item.folderUrl], ['補充資訊', item.notes || '無']];
    if (item.reviewedBy) fields.push(['審核人 / 時間', item.reviewedBy + ' / ' + date(item.reviewedAt)], ['審核意見', item.reviewNote || '無']);
    if (item.importedBy) fields.push(['匯入人 / 時間', item.importedBy + ' / ' + date(item.importedAt)]);
    $('detail-fields').replaceChildren(); fields.forEach(([key, value]) => $('detail-fields').append(element('dt', key), element('dd', value)));
    $('folder-link').removeAttribute('href');
    try { const url = new URL(item.folderUrl); if (url.protocol === 'https:' && !url.username && !url.password) $('folder-link').href = url.href; } catch (_) {}
    $('folder-link').hidden = !$('folder-link').hasAttribute('href');
    $('review-form').hidden = state.actor.role !== 'ADMIN' || item.status !== 'PENDING';
    $('import-form').hidden = item.status !== 'APPROVED' || item.importStatus !== 'PENDING';
    $('record-admin-actions').hidden = state.actor.role !== 'ADMIN'; $('archive').hidden = !!item.archivedAt;
    $('openwebui-link').hidden = !openwebuiUrl; if (openwebuiUrl) $('openwebui-link').href = openwebuiUrl;
    $('review-note').value = ''; $('import-confirm').checked = false; $('mark-imported').disabled = true; message('detail-status', '');
    $('history').replaceChildren(); item.history.forEach(entry => { const li = element('li'); li.append(element('strong', actions[entry.action] || entry.action), element('small', date(entry.at) + ' · ' + entry.actor)); if (entry.note) li.append(element('p', entry.note)); $('history').append(li); });
    if (!$('detail').open) $('detail').showModal();
  }
  $('close-detail').addEventListener('click', () => { if (!state.busy) $('detail').close(); });
  $('detail').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
  $('import-confirm').addEventListener('change', () => { $('mark-imported').disabled = !$('import-confirm').checked || state.busy; });
  async function decide(action) {
    if (state.busy || !state.selected) return;
    if (action === 'REJECT' && !$('review-note').value.trim()) { message('detail-status', '退回時請填寫原因。'); $('review-note').focus(); return; }
    if (action === 'IMPORT' && !$('import-confirm').checked) return;
    state.busy = true; ['approve', 'reject', 'mark-imported', 'close-detail'].forEach(id => { $(id).disabled = true; });
    message('detail-status', '儲存中…');
    const id = state.selected.id;
    try {
      await rpc('updateCase', state.token, { id, version: state.selected.version, action, note: action === 'IMPORT' ? '' : $('review-note').value.trim() });
      await refresh(); await openDetail(id); message('detail-status', '已儲存。');
    } catch (error) { message('detail-status', error); }
    finally { state.busy = false; ['approve', 'reject', 'close-detail'].forEach(key => { $(key).disabled = false; }); $('mark-imported').disabled = !$('import-confirm').checked; }
  }
  $('approve').addEventListener('click', () => decide('APPROVE'));
  $('reject').addEventListener('click', () => decide('REJECT'));
  $('mark-imported').addEventListener('click', () => decide('IMPORT'));
  async function recordAction(action) {
    if (!state.selected || state.busy) return;
    const text = action === 'archiveCase' ? '確定要封存這筆案件嗎？它會從主要清單移除，但仍可在「已封存」查看。' : '確定要刪除這筆案件嗎？系統會保留稽核紀錄，但案件會從一般清單移除。';
    if (!window.confirm(text)) return;
    state.busy = true; message('detail-status', '處理中…');
    try { await rpc(action, state.token, state.selected.id); $('detail').close(); await refresh(); message('global-status', action === 'archiveCase' ? '案件已封存。' : '案件已刪除。'); }
    catch (error) { message('detail-status', error); }
    finally { state.busy = false; }
  }
  $('archive').addEventListener('click', () => recordAction('archiveCase'));
  $('delete-record').addEventListener('click', () => recordAction('deleteCase'));
  async function loadUsers() {
    const token = state.token;
    const users = await rpc('getUsers', token); if (token !== state.token) return;
    $('user-rows').replaceChildren();
    users.forEach(user => {
      const row = element('tr'), identity = element('td'); identity.append(element('strong', user.name), element('small', user.account));
      const cell = element('td'), button = element('button', '編輯', 'secondary');
      button.addEventListener('click', () => { state.editingUser = user; $('user-account').value = user.account; $('user-account').readOnly = true; $('user-name').value = user.name; $('user-password').value = ''; $('user-role').value = user.role; $('user-enabled').checked = user.enabled; $('editing-note').textContent = '編輯 ' + user.account + '；密碼留空會保留原密碼。'; $('user-name').focus(); });
      cell.append(button); row.append(identity, element('td', user.role === 'ADMIN' ? '管理員' : '行政人員'), element('td', user.enabled ? '啟用' : '停用'), cell); $('user-rows').append(row);
    });
  }
  $('user-form').addEventListener('reset', () => { state.editingUser = null; $('user-account').readOnly = false; $('editing-note').textContent = '新增帳號請設定至少 12 個字元的密碼。'; });
  $('user-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('user-form').querySelector('[type="submit"]'); button.disabled = true;
    try {
      const result = await rpc('saveUser', state.token, { account: $('user-account').value.trim(), name: $('user-name').value.trim(), password: $('user-password').value, role: $('user-role').value, enabled: $('user-enabled').checked });
      if (result.sessionInvalidated) { resetSession('密碼已更新，請使用新密碼登入。'); return; }
      $('user-form').reset(); await loadUsers(); message('global-status', '使用者權限已儲存。');
    } catch (error) { message('global-status', error); }
    finally { button.disabled = false; }
  });
})();

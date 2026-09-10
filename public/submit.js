(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let csrf = '', submitting = false;
  // getRandomValues also works on trusted local-network HTTP pages.
  const uuid = () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; return [...b].map((v,i) => ([4,6,8,10].includes(i) ? '-' : '') + v.toString(16).padStart(2,'0')).join(''); };
  let requestId = uuid();
  function theme(value) { document.documentElement.dataset.theme = value; $('theme').textContent = value === 'night' ? 'NIGHT ◐' : 'DAY ◑'; $('theme').setAttribute('aria-label', value === 'night' ? '切換日間模式' : '切換夜間模式'); try { localStorage.setItem('corpo-theme', value); } catch (_) {} }
  try { theme(localStorage.getItem('corpo-theme') === 'day' ? 'day' : 'night'); } catch (_) { theme('night'); }
  $('theme').addEventListener('click', () => theme(document.documentElement.dataset.theme === 'night' ? 'day' : 'night'));
  $('notes').addEventListener('input', () => { $('notes-count').textContent = $('notes').value.length; });
  async function session() { const response = await fetch('/api/session'); const result = await response.json(); if (!response.ok) throw new Error(result.error || '無法連線，請重新整理。'); csrf = result.csrf; }
  session().then(() => { $('submit-button').disabled = false; $('submit-button').textContent = '送出資料 ↗'; }).catch(error => { $('form-status').textContent = error.message; $('submit-button').textContent = '無法連線，請重新整理'; });
  $('submission-form').addEventListener('submit', async event => {
    event.preventDefault(); if (submitting) return; submitting = true; $('submit-button').disabled = true; $('submit-button').textContent = '提交中…'; $('form-status').textContent = '';
    try {
      const response = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify({ requestId, name: $('name').value.trim(), email: $('email').value.trim(), identity: $('identity').value, folderUrl: $('folder-url').value.trim(), notes: $('notes').value.trim() }) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 403) await session(); throw new Error(result.error || '提交失敗，請稍後再試。'); }
      $('form-panel').hidden = true; $('success-panel').hidden = false;
      $('receipt-id').textContent = result.id; $('receipt-date').textContent = new Date(result.submittedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }); $('success-title').focus();
    } catch (error) { $('form-status').textContent = error.message || '無法連線。資料仍保留，請重試。'; }
    finally { submitting = false; $('submit-button').disabled = false; $('submit-button').textContent = '送出資料 ↗'; }
  });
  $('copy-id').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('receipt-id').textContent); $('copy-status').textContent = '已複製案件編號。'; } catch (_) { $('copy-status').textContent = '請選取上方案件編號手動複製。'; } });
  $('another').addEventListener('click', () => { requestId = uuid(); $('submission-form').reset(); $('notes-count').textContent = '0'; $('copy-status').textContent = ''; $('success-panel').hidden = true; $('form-panel').hidden = false; $('name').focus(); });
})();

# CORPO 知識庫審核系統 TODO

## Email 通知（尚未實作）

- [ ] 決定寄信方式：Resend API、SendGrid API／SMTP，或 Google Apps Script Notification API。
- [ ] 確認寄件網域、寄件地址與 SPF／DKIM／DMARC 設定責任人。
- [ ] 建立 `email_outbox` 資料表，保存收件人、模板類型、案件 ID、寄送狀態、重試次數、錯誤訊息與時間。
- [ ] 在同一筆資料庫交易中建立狀態異動與待寄信工作，避免審核成功但通知遺失。
- [ ] 加入背景寄信 worker：重試暫時失敗、指數退避、最大重試次數與失敗告警。
- [ ] 實作郵件模板：提交成功、審核通過、退回補正、OpenWebUI 匯入完成。
- [ ] 退回通知包含案件編號、退回原因與重新提交入口；避免直接寄出不必要的資料夾內容。
- [ ] 決定是否要求 Email 驗證，避免公開表單被拿來對他人地址寄送大量通知。
- [ ] 開發環境使用 Mailpit；正式環境才切換到外部郵件服務。
- [ ] 寫單元測試與整合測試：寄信成功、重試、永久失敗、重複狀態事件與通知去重。

## Google Apps Script Notification API（替代方案，待評估）

- [ ] 確認是否使用既有 Google Workspace 寄件帳號與 Gmail／MailApp 配額。
- [ ] 建立獨立 Apps Script 專案，只負責寄信，不直接讀寫本機 PostgreSQL。
- [ ] 以 `doPost(e)` 接收 Docker 系統的通知請求。
- [ ] 使用共享密鑰或 HMAC 驗證請求；不接受只有案件 ID 的未驗證公開請求。
- [ ] 驗證 action、案件 ID、收件者 Email、退回原因長度與 request ID。
- [ ] 建立 request ID 去重，避免 Docker 重試造成重複寄信。
- [ ] Apps Script 回傳明確結果：`accepted`、`sent`、`duplicate`、`retryable_error`、`permanent_error`。
- [ ] Docker 端仍保留 `email_outbox`，不能把 Apps Script 回應當成永久成功的唯一依據。
- [ ] 使用測試收件地址驗證寄信、配額耗盡、Apps Script timeout 與服務暫停情境。
- [ ] 確認 Apps Script Web App 部署權限、執行身分、網域政策與 API URL 不會被提交到 Git。

## OpenWebUI

- [ ] 確認 OpenWebUI 版本與知識庫 API 能力。
- [ ] 決定維持目前的手動匯入，或改為由行政人員 UI 直接呼叫 OpenWebUI API。
- [ ] 若改用 API，建立最小權限 API Key、上傳進度、失敗重試與匯入結果保存。


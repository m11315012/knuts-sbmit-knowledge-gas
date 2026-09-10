# CORPO 知識庫審核系統

Google Apps Script 原生 Web App：HTML Service 前端、Apps Script 後端、Google Sheet 儲存資料。提供 CORPO 單色工業風、NIGHT／DAY 切換、系統帳密登入、管理員審核與行政人員匯入追蹤。

使用者以系統帳號登入，不需要 Google 帳號。只有部署者需要 Google 授權，讓 Apps Script 存取表單與系統試算表。

## 專案位置

- [Apps Script 編輯器](https://script.google.com/d/1_-Q8UIJYloyh8k4DIfKueCXGUJk02GEKXCUScLx716rm7Mpn_QT9Onwr/edit)
- [來源 Google Form](https://docs.google.com/forms/d/1TJscYWYpz9XugL3Qm9W0P7oCk5lt3HaRcK45BsS7auM/edit)
- [系統 Google Sheet](https://docs.google.com/spreadsheets/d/1HI_yATFQFRbF_mW-TLWpA5HCL0Awr3xm6BViQh4GXjc/edit)

表單及試算表 ID 已寫入 `Config.gs`，可用同名指令碼屬性覆寫。程式不會改動原始表單回應工作表。

## 第一次啟用

1. 開啟上方 Apps Script 編輯器，進入「專案設定」→「指令碼屬性」，新增：

   | 屬性 | 值 |
   | --- | --- |
   | `INITIAL_ADMIN_ACCOUNT` | 自訂管理員帳號，例如 `admin` |
   | `INITIAL_ADMIN_PASSWORD` | 自訂 12～128 字元的密碼；不要貼到聊天或提交 Git |

2. 在編輯器選擇 `setup_` 並執行，由部署者完成 Google 授權。此函式會在系統試算表新增「提交案件」與「使用者權限」工作表，建立第一位管理員。密碼會以隨機鹽值及 PBKDF2-HMAC-SHA256（600,000 次）儲存，成功後刪除初始化密碼屬性。重跑不會清空案件或重設既有管理員。
3. 執行 `verifySetup_`。這會在真正的 Apps Script V8 環境檢查表單欄位、試算表結構與密碼運算，並在執行記錄輸出結果及耗時。第一次尚未安裝 Trigger 時 `triggerInstalled` 為 `false` 是正常的。
4. 執行 `installFormTrigger_`，安裝來源為 Google Form 的「提交表單時」觸發條件；不是試算表版的提交事件。重跑不會在同一帳號下重複新增。只由一位部署者安裝。
5. 如需匯入目前既有的表單回應，執行 `syncExistingResponses_`。來源回應 ID 用於去重，重跑不會重複新增案件；若有無效資料，函式會列出未匯入的回應 ID。
6. 「部署」→「新增部署作業」→「網頁應用程式」：執行身分選「我」，誰可以存取選「任何人」。登入頁可公開開啟，所有資料 API 仍須通過系統登入與後端角色檢查。若組織政策禁止匿名 Web App，請由組織管理員處理部署限制。
7. 開啟部署後的 `/exec` 網址，用第一位管理員帳密登入，再到「使用者權限」新增行政人員。

`setup_`、`verifySetup_`、`installFormTrigger_` 等結尾有底線的函式只供編輯器或已安裝的 Trigger 執行，前端不能用 `google.script.run` 呼叫。

## 操作流程

1. 使用者填寫原 Google Form，提供 Drive 資料夾連結。
2. Trigger 將一筆回應寫成一筆待審核案件。
3. 管理員開啟資料夾查看檔案，決定通過或退回。退回需填寫原因。
4. 行政人員僅能取得已通過案件；將檔案手動加入 OpenWebUI 後，勾選完成並標記已匯入。
5. 每次狀態異動連同操作歷程寫入同一筆案件；版本欄位防止覆寫別人剛完成的決定。

本版不會自動呼叫 OpenWebUI API，不會寄送通知。退回後由提交者重新提交表單建立新案件。每筆案件以整個資料夾為單位，不是逐一檔案審核；資料夾連結並非不可變的檔案快照，行政人員匯入時仍需確認內容與審核時相符。

## 資料與權限

| 工作表 | 內容 |
| --- | --- |
| 提交案件 | 原始六欄、案件與來源回應 ID、審核欄位、匯入欄位、版本、JSON 操作歷程 |
| 使用者權限 | 帳號、姓名、角色、啟用、密碼雜湊、鹽值、驗證版本、權限異動歷程 |

管理員可審核、匯入及管理人員；行政人員只能讀取已通過案件並標記匯入。後端每次操作都重新檢查帳號及角色。停用、改變角色或重設密碼會讓既有登入憑證失效。登入憑證只留在當前頁面記憶體，最長一小時，重新整理頁面需重登；Google Cache 若提前清除也需重新登入。

同一帳號在十五分鐘內最多嘗試五次，登入成功後清零；全系統每分鐘最多三十次登入請求。忘記密碼可由另一位管理員在使用者管理頁重設；只有一位管理員時，由試算表／指令碼擁有者維護，不提供公開密碼重設入口。

系統試算表只分享給維護者。操作人員使用 Web App，不必取得試算表的編輯權限。Drive 資料夾的讀取權限由原上傳者另行提供，系統登入不會授予 Drive 權限。

## Apps Script 執行檔案

只需以下檔案即可在 Apps Script 執行，不需要 Node.js、npm、外部伺服器或 CDN：

- `appsscript.json`：V8、台北時區、必要 Google 服務範圍。
- `Config.gs`：資料來源 ID。
- `Code.gs`：HTML 入口、案件與使用者管理、Form Trigger、初始化。
- `Auth.gs`：帳密驗證、登入憑證、嘗試次數限制。
- `PasswordCrypto.gs`：已打包的純 JavaScript 密碼運算；授權見 `THIRD_PARTY_LICENSE.txt`。
- `Index.html`、`Styles.html`、`Client.html`：原生 HTML／CSS／JavaScript，透過 `google.script.run` 呼叫後端。

`.claspignore` 只允許以上執行檔案上傳，排除 Node 工具、測試及示範帳號。若手動複製到編輯器，也只複製上述檔案；`PasswordCrypto.gs` 必須一併加入。

## 開發驗證（選用）

```sh
npm ci
npm test
```

本機測試涵蓋 Apps Script 程式解析、無 Node／DOM／TextEncoder 環境下的密碼演算法參考向量、密碼登入、停用與重設失效、角色隔離、案件流程、重複提交及 Trigger 去重。Google 服務以 mock 模擬，因此不能取代部署後的 `verifySetup_` 和真實表單提交測試。

只有變更密碼工具來源時才需 `npm run build:crypto`。`npm run preview` 產生本機 `preview/index.html`；這是使用假資料及公開示範帳號的介面預覽，不上傳到 Apps Script，也不會讀寫真實資料。

部署後驗收：管理員登入 → 新增行政人員 → 真實表單提交一筆 → 待審核案件出現 → 行政人員無法看見 → 管理員通過 → 行政人員可見並標記匯入。另測退回原因、錯誤密碼、停用帳號、登出及 NIGHT／DAY。

官方文件：[HTML Service](https://developers.google.com/apps-script/guides/html)、[前後端通訊](https://developers.google.com/apps-script/guides/html/communication)、[Web App 部署](https://developers.google.com/apps-script/guides/web)、[Forms 事件](https://developers.google.com/apps-script/guides/triggers/events#google_forms_events)。

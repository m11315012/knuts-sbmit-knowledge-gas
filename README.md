# CORPO 知識庫審核系統

本機 Docker 系統，包含公開填表頁、管理員與行政人員登入、案件審核、匯入進度及 PostgreSQL 資料庫。介面採 CORPO 單色工業風，提供 NIGHT／DAY 切換。

## 現在可以開啟

- 填表頁：<http://localhost:3000/>
- 管理工作台：<http://localhost:3000/admin>
- 初始管理員帳號：`admin`。
- 初始密碼：本機 `.env` 中的 `ADMIN_PASSWORD`；已隨機產生，未寫入原始碼。

以管理員登入後，到「使用者權限」新增行政人員。要改自己的密碼，編輯自己的帳號並填入新密碼，儲存後用新密碼登入。

## 功能與流程

1. 使用者開啟填表頁，填寫姓名、電子郵件、身分、資料夾網址與補充資訊，不必登入。
2. 送出後取得案件編號，資料及伺服器提交時間寫入 PostgreSQL。
3. 管理員登入，開啟資料夾檢視內容，再通過或退回。退回必須填寫原因。
4. 行政人員僅能取得已通過的案件，手動將資料加入 OpenWebUI 後標記「已匯入」。
5. 操作歷程與狀態在同一資料庫交易內儲存。案件版本防止多人同時操作覆寫結果。

維持填寫 HTTPS 資料夾網址，不直接上傳檔案。資料夾的讀取權限仍需由提交者提供。整個資料夾是一筆審核案件；內容並非不可變的快照，行政人員匯入前應再次核對。退回後由使用者重新提交；本版不寄送通知，不自動呼叫 OpenWebUI API。

## 啟動、停止與更新

需要 Docker Desktop／Docker Engine 及 Docker Compose。若這是新的電腦或沒有 `.env`，先執行：

```sh
node scripts/setup-env.mjs
```

這個初始化工具只產生本機密碼檔，不覆寫既有 `.env`。也可自行將 `.env.example` 複製為 `.env`，設定資料庫密碼、至少 32 字元的 `SESSION_SECRET`，以及至少 12 字元的管理員密碼。

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail 50 app
```

停止並保留資料：

```sh
docker compose down
```

程式修改後更新：

```sh
docker compose up -d --build
```

網站容器採 Node.js 24，資料庫採 PostgreSQL 17。資料存在命名 volume `corpo-knowledge_postgres_data`，包含案件、人員、操作紀錄及登入 session。普通停止、重新建置或移除容器不會刪除 volume；不要在需要保留資料時使用 `docker compose down -v`。

第一次啟動會自動套用 SQL migration 並建立初始管理員。已有使用者時不會重設管理員密碼，因此後續修改 `.env` 的 `ADMIN_PASSWORD` 不會覆蓋資料庫內的密碼。

## 區域網路使用

目前預設僅本機可開啟，網站綁定 `127.0.0.1:3000`，資料庫沒有對外開放連接埠。

如需同網路其他電腦填表，將 `.env` 設為實際伺服器 IP，例如：

```dotenv
BIND_ADDRESS=0.0.0.0
APP_PORT=3000
APP_ORIGIN=http://192.168.1.100:3000
```

重新執行 `docker compose up -d`，並在作業系統防火牆允許需要的內網存取。之後以設定的 `APP_ORIGIN` 網址開啟；此值也用於驗證表單的請求來源，不能隨意換成另一個網域或 `localhost`。

放到 HTTPS 反向代理後，使用 HTTPS 的 `APP_ORIGIN`、`COOKIE_SECURE=true`；只有確定前方代理數量時才設定 `TRUST_PROXY`。不要把 PostgreSQL 的連接埠公開。

## 帳密與權限

- 密碼使用 Node.js 內建 scrypt 加隨機鹽值儲存，前端不含帳密清單。
- 登入使用 HttpOnly、SameSite=Strict cookie；session 儲存在 PostgreSQL，最長八小時。
- 所有案件及使用者 API 都由後端檢查登入、角色與帳號啟用狀態。
- 停用、角色異動或密碼重設會讓舊 session 無法再操作。
- 管理員不可停用或降級自己；使用者管理亦有版本檢查。
- 提交與登入有頻率限制，寫入需符合相同來源及 CSRF 驗證。
- 查詢採參數化 SQL；畫面以文字節點顯示使用者輸入。

管理員角色可審核、匯入及管理帳號。行政人員僅可查看已通過的案件並標記匯入。

## 資料備份

已安裝 Node.js 時，可執行：

```sh
npm run backup
```

會將 PostgreSQL 自訂格式備份放入 `backups/`；這個目錄不會提交 Git。備份不包含 `.env`，請另行妥善保存設定。

還原至自行準備的空白資料庫，可將備份複製到資料庫容器後使用 `pg_restore`。請先保留現有資料，避免直接覆蓋正在使用的資料庫。

## 測試

```sh
npm ci
npm test
```

整合測試使用獨立的測試容器及 volume，不會寫入本機正式資料庫：

```sh
docker compose -p corpo-knowledge-test -f compose.yaml -f tests/compose.test.yaml up -d --no-build --wait
npm run test:integration
npm run test:persistence
docker compose -p corpo-knowledge-test -f compose.yaml -f tests/compose.test.yaml down -v
```

先建立正式映像 `docker compose build`，再啟動測試容器。測試涵蓋帳密、CSRF、越權拒絕、公開提交、去重、審核、退回驗證、同時匯入防覆寫、稽核紀錄、帳號停用，以及移除／重建容器後的資料與 session 保存。

## 目錄

| 位置 | 用途 |
| --- | --- |
| `public/` | 填表及管理介面 |
| `server/` | API、登入、資料庫、輸入驗證 |
| `migrations/` | PostgreSQL 結構版本 |
| `compose.yaml`、`Dockerfile` | 本機部署 |
| `tests/` | 單元與容器整合測試 |
| `legacy/gas/` | 前一版 Apps Script 原始碼備存，不參與目前部署 |

目前流程不使用 Google Form、Google Sheet 或 Apps Script。先前 Google 雲端專案及既有回應沒有被刪除或匯入本機資料庫。

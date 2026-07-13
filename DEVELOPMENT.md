# 均衡日記 — 開發與部署說明

依 `README.md`（Claude Design handoff 規格）實作的正式版：

- `frontend/` — React 19 + TypeScript + Vite + zustand（像素還原原型視覺）
- `backend/` — Node.js + Express + TypeScript + better-sqlite3（JWT 帳號系統、照片上傳）
- 原型檔（`均衡日記-standalone.html`、`飲食紀錄.dc.html`、`support.js`）保留作為參考

## 本機開發

```bash
# 後端（port 3001）
cd backend && npm install && npm run dev

# 前端（port 5173，/api 與 /uploads 自動 proxy 到 3001）
cd frontend && npm install && npm run dev
```

瀏覽 http://localhost:5173 ，先「註冊新帳號」再登入。

- 資料庫：`backend/data/diet.db`（SQLite，首次啟動自動建立）
- 照片：`backend/uploads/`
- 環境變數（`backend/.env`）：`PORT`、`JWT_SECRET`、`DB_PATH`、`UPLOAD_DIR`，以及寄信相關（見下方「寄信與帳號審核」）

## Docker 部署

```bash
# 建議先設定 JWT 秘鑰
export JWT_SECRET=$(openssl rand -hex 32)

docker compose up -d --build
```

瀏覽 http://localhost:8080 。

- `frontend`：nginx 靜態服務 + 反向代理 `/api`、`/uploads` 至 backend
- `backend`：資料持久化於 `./docker-data/db`（SQLite）與 `./docker-data/uploads`（照片）
- 停止：`docker compose down`（資料保留在 docker-data/）

## 帳號、角色與開通

角色分三種：`member`（一般會員）、`dietitian`（營養師）、`admin`（管理者）。

- **註冊**：填 Email（即帳號）＋密碼＋確認密碼（未填齊前圖形驗證碼鎖定）→ 輸入圖形驗證碼並按「確認」（svg-captcha 產生、不分大小寫、5 分鐘有效、答錯作廢換新圖）→ 驗證成功才出現「Email 認證碼」欄位 → 按「寄送認證碼」收 6 位數認證碼（10 分鐘有效、60 秒可重寄、錯 5 次作廢）→ 送出註冊 → 帳號建立為 `pending`。既有帳號在升級時自動視為已開通。
- **開通**：由管理者在「管理者後台」按「開通」（不再寄開通連結信）；開通時若有設定 SMTP 會寄通知信給使用者。後台也可調整角色、停用或刪除會員（連同其所有紀錄與照片）。
- **初始管理員**：`ADMIN_EMAIL` 環境變數對應的帳號會在啟動／註冊／登入時自動升為管理者並開通。
- **會員中心**：右上角人像圖示可查看帳號並變更密碼。
- **營養師**：營養師（與管理者）可進入「營養師頁面」選會員＋選日期檢視每日紀錄，並替會員設定階段目標；營養師設定的目標會在會員端標示「營養師設定」且會員無法自行修改。也可替會員的每張餐點照片評分（綠燈＝均衡良好、黃燈＝尚可、紅燈＝需改善），燈號會顯示在會員端的照片角落。

防濫用：nginx 對 `/api/auth/` 做 per-IP 限流（5 req/s、burst 10，超過回 429），設定在 `frontend/nginx.conf`。

需要的環境變數（Docker 部署：`cp .env.example .env` 後填入實際值；`.env` 含密碼請勿提交進版本控制）：

| 變數 | 說明 |
|---|---|
| `SMTP_HOST` | SMTP 主機，預設 `smtp.gmail.com` |
| `SMTP_PORT` | 預設 `587`（`465` 會自動改用 TLS）|
| `SMTP_USER` | Gmail 帳號（寄件者）|
| `SMTP_PASS` | Gmail「應用程式密碼」（Google 帳戶 → 安全性 → 兩步驟驗證 → 應用程式密碼；不是登入密碼）|
| `SMTP_FROM` | 寄件者顯示信箱，預設同 `SMTP_USER` |
| `ADMIN_EMAIL` | 此信箱對應的帳號自動成為管理者（後台初始管理員）|
| `APP_URL` | 對外網址（開通完成通知信的連結），預設 `http://localhost:8080` |

未設定 `SMTP_USER`/`SMTP_PASS` 時無法寄認證碼，也就無法註冊新帳號（既有帳號登入不受影響）。

## API 摘要

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/auth/captcha` | → `{id, svg}` 圖形驗證碼 |
| POST | `/api/auth/verify-captcha` | `{captchaId, captchaAnswer}` → 確認圖形驗證碼 |
| POST | `/api/auth/send-code` | `{email, captchaId(已驗證)}` → 寄送註冊認證碼 |
| POST | `/api/auth/register` | `{username(email), password, confirmPassword, code}` → `{pending, message}`（待管理者開通）|
| POST | `/api/auth/login` | `{username, password, remember?}` → `{token, username, role}`（remember=true 效期 30 天、否則 1 天）；未開通回 403 |
| GET | `/api/auth/me` | 目前登入者 `{username, role, createdAt}` |
| POST | `/api/auth/change-password` | `{oldPassword, newPassword, confirmPassword}` 變更密碼 |
| GET / PATCH | `/api/days/:date` | 當日資料（water / ex / body / entries，含 waterTime / exTime / bodyTime 紀錄時間）|
| GET | `/api/days/marks?from&to` | 有紀錄的日期（週曆／月曆亮燈）|
| POST | `/api/days/:date/entries` | 建立餐次紀錄 `{meal, eatTime?}` |
| PATCH / DELETE | `/api/entries/:id` | 更新（desc / food / photos 子集合＝刪除照片 / eatTime / date＝移到別天）／刪除 |
| POST | `/api/entries/:id/photos` | multipart 上傳多張照片（每筆最多 10 張，前端已壓縮 640px JPEG）|
| GET / POST | `/api/comments?target=` | 留言（target：`entry:<id>`／`water:<date>`／`ex:<date>`）|
| DELETE | `/api/comments/:cid` | 刪除自己的留言 |
| GET / POST | `/api/goals` | 階段目標清單／新增（可多組，各自有日期區間）|
| PUT / DELETE | `/api/goals/:id` | 編輯／刪除單組目標（營養師設定的目標會員不可改）|
| GET | `/api/body-trend?field=weight&limit=30` | 身體數據趨勢 |
| GET | `/api/admin/users` | （admin）會員清單 |
| POST | `/api/admin/users/:id/approve` | （admin）開通帳號 |
| PATCH | `/api/admin/users/:id` | （admin）`{role?, status?}` 調整角色／停用 |
| DELETE | `/api/admin/users/:id` | （admin）刪除會員與其所有資料 |
| GET | `/api/pro/members` | （dietitian/admin）會員清單 |
| GET | `/api/pro/members/:id/days/:date` | （dietitian/admin）會員當日紀錄 |
| GET | `/api/pro/members/:id/marks?from&to` | （dietitian/admin）會員有紀錄的日期 |
| PUT | `/api/pro/members/:id/entries/:eid/photo-rating` | （dietitian/admin）`{photo, rating: green/yellow/red/null}` 替單張照片評分（null＝取消）|
| PUT | `/api/pro/members/:id/entries/:eid/food` | （dietitian/admin）`{food}` 調整該筆六大類份數（會員端標示「營養師調整份數」）|
| GET / POST | `/api/pro/members/:id/comments?target=` | （dietitian/admin）查看／新增對會員紀錄的留言 |
| DELETE | `/api/pro/members/:id/comments/:cid` | （dietitian/admin）刪除自己的留言 |
| GET / POST | `/api/pro/members/:id/goals` | （dietitian/admin）會員目標清單／替會員新增（標示營養師設定）|
| PUT / DELETE | `/api/pro/members/:id/goals/:gid` | （dietitian/admin）編輯／刪除會員目標 |

熱量計算與超標（>目標×1.2 轉紅）規則依 README domain rules，由前端 `src/lib/domain.ts` 以常數表計算；後端僅存份數。

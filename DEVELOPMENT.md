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

## 寄信與帳號審核

註冊流程：填 Email（即帳號）＋密碼＋確認密碼（未填齊前圖形驗證碼鎖定）→ 輸入圖形驗證碼並按「確認」（svg-captcha 產生、不分大小寫、5 分鐘有效、答錯作廢換新圖）→ 驗證成功才出現「Email 認證碼」欄位 → 按「寄送認證碼」收 6 位數認證碼（10 分鐘有效、60 秒可重寄、錯 5 次作廢）→ 送出註冊 → 帳號建立為 `pending`，系統寄信給管理員 → 管理員點信中連結開通 → 使用者收到開通通知信後即可登入。既有帳號在升級時自動視為已開通。

防濫用：nginx 對 `/api/auth/` 做 per-IP 限流（5 req/s、burst 10，超過回 429），設定在 `frontend/nginx.conf`。

需要的環境變數（Docker 部署：`cp .env.example .env` 後填入實際值；`.env` 含密碼請勿提交進版本控制）：

| 變數 | 說明 |
|---|---|
| `SMTP_HOST` | SMTP 主機，預設 `smtp.gmail.com` |
| `SMTP_PORT` | 預設 `587`（`465` 會自動改用 TLS）|
| `SMTP_USER` | Gmail 帳號（寄件者）|
| `SMTP_PASS` | Gmail「應用程式密碼」（Google 帳戶 → 安全性 → 兩步驟驗證 → 應用程式密碼；不是登入密碼）|
| `SMTP_FROM` | 寄件者顯示信箱，預設同 `SMTP_USER` |
| `ADMIN_EMAIL` | 收「新帳號待審核」通知信的管理員信箱 |
| `APP_URL` | 對外網址（開通連結的網域），預設 `http://localhost:8080` |

未設定 `SMTP_USER`/`SMTP_PASS` 時無法寄認證碼，也就無法註冊新帳號（既有帳號登入不受影響）。

## API 摘要

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/auth/captcha` | → `{id, svg}` 圖形驗證碼 |
| POST | `/api/auth/verify-captcha` | `{captchaId, captchaAnswer}` → 確認圖形驗證碼 |
| POST | `/api/auth/send-code` | `{email, captchaId(已驗證)}` → 寄送註冊認證碼 |
| POST | `/api/auth/register` | `{username(email), password, confirmPassword, code}` → `{pending, message}`（待審核）|
| GET | `/api/auth/approve/:token` | 管理員開通連結（信件內附）|
| POST | `/api/auth/login` | `{username, password, remember?}` → `{token}`（remember=true 效期 30 天、否則 1 天）；未開通回 403 |
| GET / PATCH | `/api/days/:date` | 當日資料（water / ex / body / entries）|
| GET | `/api/days/marks?from&to` | 有紀錄的日期（週曆／月曆圓點）|
| POST | `/api/days/:date/entries` | 建立餐次紀錄 `{meal}` |
| PATCH / DELETE | `/api/entries/:id` | 更新（desc/food/photo:''）／刪除 |
| POST | `/api/entries/:id/photo` | multipart 上傳照片（前端已壓縮 640px JPEG）|
| GET / PUT / DELETE | `/api/goals` | 階段目標 |
| GET | `/api/body-trend?field=weight&limit=30` | 身體數據趨勢 |

熱量計算與超標（>目標×1.2 轉紅）規則依 README domain rules，由前端 `src/lib/domain.ts` 以常數表計算；後端僅存份數。

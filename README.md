# 均衡日記（DietDiary）

以「每日一頁」記錄飲食的手機優先 Web App：依六大類份數記帳、自動累計熱量、追蹤喝水／運動／身體數據，設定階段性份數目標，並提供 AI 營養師評語與營養師專業回饋。

> 目前版本 **1.1.12**。前後端版號由 `scripts/bump-version.mjs` 保持一致，前端會輪詢 `GET /api/version` 對過舊的用戶端跳出強制更新。

---

## 功能總覽

- **每日飲食日記**：每筆餐次為獨立動態（早／午／晚／宵夜／點心），可填敘述、上傳多張照片（每筆最多 10 張）、記錄六大類份數與用餐時間；動態牆新→舊排序。
- **六大類與熱量**：11 個細分份數欄位（蛋豆魚肉低/中/高/超高脂、蔬菜、全穀雜糧、油脂堅果、水果、乳品脫脂/低脂/全脂）自動換算熱量，收斂成六大類顯示。
- **喝水／運動**：皆為逐筆記錄，一筆一則動態（含時間），可單筆刪除。
- **身體數據與趨勢圖**：體重、體脂率、腰圍、肌肉重、體脂重；任一欄位可看折線趨勢。
- **階段目標與超標紅字**：可設定多組日期區間目標（六大類份數＋喝水）；當日某類 > 目標 × 1.2（目標為 0 時只要 > 0）即轉紅。營養師設定的目標會員不可自改。
- **月曆與週曆跳日**、內建**食物份數指南**。
- **社群互動**：每則動態可留言；營養師可對照片評分（紅黃綠燈）、調整份數、留言、替會員設定目標；有通知中心。
- **AI 營養師**（需管理者逐一開放）：拍照估份數＋自動寫敘述、單篇餐點評語、今日總評、對 AI 輸出按讚／倒讚回饋，並有跨使用者的「共用菜色知識庫」。
- **帳號系統**：Email 註冊（圖形驗證碼＋Email 認證碼）→ 管理者審核開通；JWT 登入；四種角色（member／citizen／dietitian／admin）。

---

## 系統架構

```
                         ┌─────────────────────────────────────┐
  瀏覽器  ──:8080──▶     │  frontend 容器 (nginx)               │
                         │  ・靜態 React SPA (Vite build)       │
                         │  ・/api、/uploads 反向代理 → backend │
                         │  ・/api/auth 限流、/api/ai 放寬逾時   │
                         └───────────────┬─────────────────────┘
                                         │ backend:3001（僅內網）
                         ┌───────────────▼─────────────────────┐
                         │  backend 容器 (Node + Express)       │
                         │  ・better-sqlite3（單檔 SQLite）     │
                         │  ・JWT 認證、multer 照片上傳          │
                         │  ・呼叫 LLM Gateway / embedding 服務  │
                         └───────┬───────────────────┬─────────┘
                                 │                   │（選用）
                   ┌─────────────▼──────┐   ┌────────▼──────────────┐
                   │ eLAND LLM Gateway  │   │ embedder 容器 (選用)  │
                   │ (OpenAI 相容,gemma)│   │ FastAPI + ONNX 向量   │
                   └────────────────────┘   │ 文字/圖片 embedding   │
                                            └───────────────────────┘
  持久化：./docker-data/db（SQLite）、./docker-data/uploads（照片）
```

- **frontend** 是唯一對外服務（host `8080` → nginx `80`），既服務靜態頁，也把 `/api`、`/uploads` 代理到 `backend:3001`。
- **backend** 不對外開埠，只在 compose 網路內經 nginx 代理存取；資料存在單檔 SQLite 與本機 uploads 目錄（bind mount 到 `./docker-data/`）。
- **embedder**（Python/FastAPI）為選用，用 `profiles: ["embed"]` 隔離，平時不啟動、不佔記憶體；開啟共用知識庫時才需要。
- **LLM** 走外部 eLAND Intelligence Gateway（OpenAI 相容），未設定 `LLM_TOKEN` 時 AI 功能自動全部停用。

---

## 技術棧

| 層 | 技術 |
|---|---|
| 前端 | React 19、TypeScript、Vite 8（Rolldown）、Zustand、oxlint；純 inline style + `index.css`，無 UI 框架 |
| 後端 | Node.js 22、Express 4、TypeScript、better-sqlite3（WAL）、JWT、bcrypt、multer、sharp、nodemailer、svg-captcha、zod |
| Embedding 服務 | Python 3.11、FastAPI、fastembed（量化 ONNX + onnxruntime，無 PyTorch） |
| LLM | eLAND LLM Gateway（LiteLLM，OpenAI 相容）；`gemma-4-31b` 看圖、`gemma-4-12b` 文字、`gemma-4-e4b` 備援 |
| 佈署 | Docker Compose；前端 nginx、後端 Node、選用 embedder |

---

## 專案結構

```
dietdiary/
├── frontend/                 React 19 + Vite 前端（nginx 佈署）
│   ├── src/
│   │   ├── App.tsx           以 Zustand 狀態切換畫面（無 URL router）
│   │   ├── store.ts          全域狀態 + API 呼叫動作
│   │   ├── screens/          Login / Main（會員日記）/ Dietitian / Admin
│   │   ├── components/       卡片、動態牆、留言、圖表、modals/ 各彈窗
│   │   └── lib/              domain.ts（熱量/目標規則）、api.ts、guideData.ts、
│   │                         photo.ts（壓縮）、version.ts、changelog.ts
│   ├── public/changelog.json 版本紀錄（單一來源；nginx 永遠供最新版）
│   └── nginx.conf            靜態服務 + 反向代理 + 限流/逾時
├── backend/                  Node + Express + SQLite 後端
│   └── src/
│       ├── index.ts          進入點、路由掛載、/uploads 靜態
│       ├── db.ts             SQLite schema 與內建 migration
│       ├── routes/           auth / days / entries / goals / trend /
│       │                     comments / notifications / admin / pro / ai
│       ├── middleware/auth.ts JWT 驗證、requireRole
│       ├── llm.ts, kb.ts      LLM gateway 客戶端、共用菜色知識庫
│       ├── helpers.ts, validation.ts, mailer.ts, version.ts
├── embedding-service/        選用：文字＋圖片向量微服務（FastAPI）
├── scripts/bump-version.mjs  一次更新前後端版號
├── docker-compose.yml        backend / frontend / embedder(profile)
├── docker-data/              持久化資料（SQLite、上傳照片）— 不進版控
├── DEVELOPMENT.md            詳細開發／佈署／帳號／API 說明
├── LLM-API-使用教學.md        eLAND LLM Gateway 串接參考
└── 均衡日記-standalone.html   早期 HTML 設計原型（僅供參考，見文末）
    飲食紀錄.dc.html / support.js
```

---

## 快速開始

### 本機開發（不經 Docker）

```bash
# 後端（port 3001）
cd backend && npm install && npm run dev

# 另開一個終端機：前端（port 5173，/api 與 /uploads 自動 proxy 到 3001）
cd frontend && npm install && npm run dev
```

瀏覽 <http://localhost:5173>，先「註冊新帳號」再登入。
資料庫在 `backend/data/diet.db`（首次啟動自動建立），照片在 `backend/uploads/`。

> 註冊需寄 Email 認證碼，本機開發若未設定 SMTP 則無法註冊新帳號。可用 `ADMIN_EMAIL` 對應帳號（啟動時自動開通為管理者）來略過審核。

### Docker 佈署

```bash
cp .env.example .env          # 填入實際值（至少換掉 JWT_SECRET、設好 SMTP）
docker compose up -d --build
```

瀏覽 <http://localhost:8080>。停止：`docker compose down`（資料保留在 `docker-data/`）。

啟用共用菜色知識庫（額外約 1.2–1.5 GB 記憶體）：

```bash
docker compose --profile embed up -d --build
# 並在 .env 設 AI_KB_ENABLED=true、AI_EMBED_URL=http://embedder:8900
```

---

## 環境變數

Docker 佈署以根目錄 `.env` 為主（範本見 `.env.example`）；本機後端則用 `backend/.env`。**`.env` 含密碼，請勿提交版控。**

| 變數 | 預設 | 說明 |
|---|---|---|
| `JWT_SECRET` | `please-change-this-secret` | JWT 簽章秘鑰，**正式環境務必更換**（`openssl rand -hex 32`）|
| `ADMIN_EMAIL` | — | 此 Email 對應帳號在啟動／登入時自動升為管理者並開通 |
| `APP_URL` | `http://localhost:8080` | 對外網址（開通通知信連結）|
| `SMTP_HOST/PORT/USER/PASS/FROM` | Gmail 587 | 寄認證碼／通知信；`SMTP_PASS` 用 Gmail「應用程式密碼」。未設定則無法寄認證碼、無法註冊 |
| `LLM_TOKEN` | — | LLM Gateway Bearer token；**留空＝全站 AI 功能停用** |
| `LLM_BASE_URL` | `https://eigw.elandai.cloud` | Gateway 網址（OpenAI 相容）|
| `LLM_OCR_MODEL` | `gemma-4-31b` | 看圖判份數＋寫敘述 |
| `LLM_COMMENT_MODEL` | `gemma-4-12b` | 純文字評語／今日總評 |
| `LLM_COMMENT_FALLBACK_MODEL` | `gemma-4-e4b` | 主模型故障時的純文字備援 |
| `LLM_TIMEOUT_MS` | `45000` | 單次模型呼叫逾時；逾時後換備援再試一次 |
| `LLM_MAX_IMAGE_BYTES` | `68000` | 送給視覺模型的單張照片上限，超過自動縮圖 |
| `AI_KB_ENABLED` | `false` | 共用菜色知識庫總開關；記憶體吃緊可一鍵關閉，主功能不受影響 |
| `AI_EMBED_URL` | — | embedding 服務位址（如 `http://embedder:8900`）；未設定則知識庫停用 |

後端另有本機開發用的 `PORT`、`DB_PATH`、`UPLOAD_DIR`（皆有預設）。

---

## 核心領域規則

熱量與超標判斷都在前端 `frontend/src/lib/domain.ts` 以常數表計算，**後端只儲存份數**。

**每份熱量（kcal/份）**

| 類別 | 每份熱量 |
|---|---|
| 蛋豆魚肉 | 低脂 55、中脂 75、高脂 120、超高脂 135 |
| 乳品 | 脫脂 80、低脂 120、全脂 150 |
| 蔬菜 | 25 |
| 全穀雜糧 | 70 |
| 油脂堅果 | 45 |
| 水果 | 60 |

**份數輸入**：0–99，四捨五入到小數 1 位（`clampPortion`）。

**預設目標**：蛋豆魚肉 7、蔬菜 3、全穀雜糧 10、油脂堅果 3、水果 2、乳品 2 份，喝水 2000 ml。可設多組日期區間目標，重疊時取最新建立的一組。

**超標紅字**：某類當日總份數 > 目標 × 1.2 轉紅；**目標設為 0 時，吃任何份數（> 0）都算超標**。

> ⚠️ 「全穀雜糧」「油脂堅果」等只是食物代換表的分類代稱，不代表健康與否（炸雞皮、餅乾也算全穀雜糧）。AI 評語會依實際敘述判斷，而非分類名稱。

---

## AI 功能

AI 為**逐一開放**：管理者在後台替個別會員開啟後才可用；且需設定 `LLM_TOKEN`。四項能力：

1. **拍照判份數＋寫敘述**（`POST /api/ai/ocr`）：視覺模型估六大類份數並寫一句敘述；若共用知識庫命中相似菜色，會附上「社群參考份數」。敘述與份數可分別按讚／倒讚。
2. **單篇 AI 評語**（`POST /api/ai/comment`）：針對一則餐點動態，比對當日階段目標給溫和建議。
3. **AI 今日總評**（`POST /api/ai/daily`）：綜合整天餐點、六大類達成、喝水、運動、身體數據；目標比對由後端先算好再交給模型，避免算錯。
4. **回饋**（`POST /api/ai/feedback`）：對 AI 輸出按讚／倒讚，會影響往後生成風格。

**共用菜色知識庫**（選用）：`embedding-service` 用文字（菜名/敘述，384 維）與圖片（餐點照片，512 維）向量，找相似菜色的社群共識份數當估算參考。所有知識庫呼叫在服務未啟用或失效時都會靜默略過，OCR 照常運作。LLM Gateway 串接細節見 `LLM-API-使用教學.md`。

---

## 帳號、角色與版號

- **角色**：`member`（一般會員）、`citizen`（駒駒國民，權限同會員）、`dietitian`（營養師）、`admin`（管理者）。
- **註冊流程**：圖形驗證碼 → Email 6 位認證碼 → 帳號建立為 `pending` → 管理者於後台開通。`ADMIN_EMAIL` 對應帳號自動成為管理者。
- **營養師**可在專屬頁面檢視會員每日紀錄、替照片評分（綠/黃/紅燈）、調整份數、留言、設定目標。
- **強制更新**：版號嵌入前端 bundle，後端由 `GET /api/version` 回報；前端每 60 秒比對，**伺服器版號嚴格大於**用戶端時跳出不可關閉的更新視窗。改版用 `node scripts/bump-version.mjs X.Y.Z` 一次更新前後端版號，並在 `frontend/public/changelog.json` 最前面新增一筆（同時驅動底部「版本紀錄」與更新視窗內容）。專案內有 `release` skill 可一鍵完成 bump → changelog → build → commit → push → GitHub Release。

> 帳號流程、四種角色的細節、以及**完整 API 端點表**請見 **[DEVELOPMENT.md](./DEVELOPMENT.md)**。

---

## 相關文件

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** — 開發／佈署／帳號審核／完整 API 摘要（最權威的操作文件）。
- **[LLM-API-使用教學.md](./LLM-API-使用教學.md)** — eLAND LLM Gateway（OpenAI 相容）串接參考。
- **[embedding-service/README.md](./embedding-service/README.md)** — 共用知識庫向量服務的兩種佈署方式與記憶體概估。

## 早期設計原型（僅供參考）

`均衡日記-standalone.html`、`飲食紀錄.dc.html`、`support.js` 是本專案最初的 HTML 設計原型（資料存在 `localStorage`、登入為純視覺）。**正式版已改由上述 `frontend/` + `backend/` 實作，這些檔案僅保留作為視覺與領域規則的歷史參考，不參與建置或佈署。**

---
name: design-guardrails
description: 設計新功能、實作後端寫入路徑或前端編輯流程前必讀的防呆準則（蒸餾自 v1.4.5–v1.4.6 七輪 code review 修掉的所有問題類型）。在動手設計 API、資料寫入、跨裝置同步、檔案處理、React 編輯視窗，或自我 code review 時使用。
---

# 設計防呆準則（design-guardrails）

> **單一來源**：本檔（`.claude/skills/design-guardrails/SKILL.md`）是唯一正本；
> `.agents/skills/design-guardrails/SKILL.md` 只是指向這裡的指標檔，修改一律改這份。

這份清單來自 v1.4.5–v1.4.6 七輪 code review 實際修掉的問題。每一條附「當時犯的錯」當反例。

## 第零步：先判斷適用範圍（不要每次小改都走完整清單）

| 改動類型 | 需要對照的條目 |
|---|---|
| 純視覺／文案／樣式 | 不需走此清單（顧 build、lint、可及性即可） |
| 前端編輯流程（modal、草稿、逐筆提交） | 9–13＋14–15 |
| 後端 read-only 端點 | 1、7＋14–15 |
| 後端 mutation（寫入／刪除） | 完整 1–15 |
| 檔案處理／外部服務呼叫 | 額外加重 4、5、6（補償、冪等、timeout） |

## 後端

### 1. 授權一律 fail-closed，輸入先正規化
- 每個資源請求都必須**解析出擁有者**才放行；解析不出、查不到 → 404/403，絕不退到「已登入即可」。
- 授權判斷與實際資源定位必須用**同一個 canonical 表示法**：先確認 framework 給的是 raw 還是已解碼（Express 的 `req.path` 未解碼、`req.params` 已解碼），**最多解碼一次**（double-decode 會讓 `%252F` 變成 `/`）；malformed encoding 直接 fail-closed；解碼後重新檢查 `/`、`\`、`..`、NUL 與路徑邊界。
- 授權用的快取／對照表必須有**明確 invalidation**（資源刪除時同步清除），不能只靠 TTL 過期。
- 反例：photoAuth 對解析不出 entryId 的檔名放行給所有登入會員；raw path 未解碼使 percent-encoding 繞過擁有者檢查；legacy 對照表在照片刪除後殘留舊權限 10 分鐘。

### 2. check-then-act：跨 await 必須視為可能競態，同步也不代表安全
- 「同一 process、同一 connection、中間沒有 await 的同步 JS 區段」不會被**其他 handler** 插隊——但這**不代表資料庫沒有競態**：其他 process／container、另一條 SQLite connection、未包 transaction 的多條 SQL、未來的水平擴充都可能插隊。需要一致性的 check-then-act 一律用**條件式 mutation 或 transaction**，不要依賴 runtime 的同步特性。
- 一次性資源（認證碼、token）用**條件式 UPDATE/DELETE 原子消耗**（`WHERE email=? AND code=? AND expires_at>=?`，`changes!==1` 即拒絕），且放在**第一個 await 之前**。
- 消耗後的失敗補償：涵蓋整段後續（含 hash 本身），寫回用 `INSERT OR IGNORE`——期間使用者可能已取得新資料，絕不能覆蓋。
- 並發 INSERT 撞唯一鍵：只把 `SQLITE_CONSTRAINT_UNIQUE` 當業務衝突（409），其他錯誤誠實回 500，不偽裝。
- 反例：認證碼「讀→hash→刪」被並發重用；補償用 OR REPLACE 蓋掉新碼；bcrypt 失敗永久燒碼；註冊 broad catch 把磁碟滿偽裝成「已註冊過」。

### 3. 樂觀鎖必須涵蓋「所有」mutation 路徑
- 加了 revision 就要讓**每一條**寫入路徑遵守契約：主要 PATCH、DELETE、上傳、複製、第三方（營養師）編輯——漏掉任何一條側路，過時的 client 就能經由它「洗到」新 revision 再整筆覆蓋。
- 衝突（409）必須**零副作用**：DB 不動、已寫入的檔案收回、通知不發。
- `expectedRevision` 有提供但格式錯誤 → 400；**絕不靜默當成未提供**（鎖形同虛設）。未提供＝舊 client 相容。
- client 只在「請求的基準成功匹配」時才更新本地 revision 基準。
- 反例：照片上傳不驗 revision，過時視窗上傳一張照片就拿到新 revision，接著完成鍵覆蓋另一台裝置的修改。

### 4. 多步驟寫入要原子
- 跨多張表的寫入放**同一個 transaction**；注意 FK 方向決定刪除順序（先刪子表）。條件檢查（revision）在交易內先做，不符整筆回滾。
- 「先寫檔、後寫 DB」的流程：DB 未成功提交（409 或 throw）都要收回本次寫入的檔案；多檔逐一寫入用**累積清單**，第 N 個失敗時清掉前面成功的。
- 反例：DELETE 先刪 entries 爆 photo_ratings 的 FK；`files.map(writeFileSync)` 中途失敗留下孤兒檔。

### 5. 副作用要分級，不能一律吞掉也不能一律陪葬
- **非必要副作用**（通知、推薦學習、統計）：主寫入**提交之後**執行、絕不 throw（內部 try/catch＋結構化 log）。修在**源頭**（副作用函式本身），不要逐呼叫端包——會漏。
- **必要副作用**（稽核紀錄、計費、權限異動、必須交付的佇列）：屬於主要契約，**與主寫入同一 transaction**（或寫 outbox／job record 之後可靠重試），失敗不能只 log。
- **外部不可逆操作**（寄信、金流、第三方 API）：設計 idempotency key 與補償策略。
- 反例：通知表寫入失敗讓已提交的照片上傳回 500，client 不更新基準、重試撞 409。

### 6. 冪等與「回應遺失」：成功不等於 client 知道成功
- Server 已 commit 但 response 在網路上遺失時，client 會以為失敗而重試——**client 不得假設「沒收到 2xx＝server 沒寫入」**。
- 可重試的 create／copy 類端點考慮 idempotency key；批次操作優先提供 server-side batch transaction，而不是 client 逐筆迴圈。
- client 超時後應**重新查詢狀態**再決定，不要盲目重送。
- 反例：歷史照片逐張複製——部分成功已處理，但「已 commit、回應遺失」的重試仍會複製出重複照片（已知殘餘邊界，靠冪等鍵才能根治）。

### 7. 驗證：格式 ≠ 語意，還要有資源上限
- regex 對日期只驗字形；`2026-02-31` 要靠真實日曆日檢查擋。所有入口（路由參數、query、body 內欄位）共用同一個 schema。
- `new Date()` 對 Invalid Date 產生 NaN，`NaN < x` 全是 false——用它做範圍防護會被靜默穿過。
- 結構與資源限制一併檢查：Zod object 考慮 `.strict()`（未知欄位不默默放行）、陣列／字串長度、數值上下界、ID 為正的安全整數、query 範圍大小（別讓一次查詢掃極大區間）、body size 與 JSON 深度、上傳檔案驗 magic bytes 而非只信 MIME。

### 8. Migration 安全
- 每個欄位獨立 `if (!cols.includes(...))`，不要用第一欄當整組開關——中斷後重啟會漏掉其餘欄位。
- 整組 migration 盡量 transaction 化（SQLite 不支援的 DDL 例外要明確處理）；啟動中斷後必須可重跑。
- Table rebuild 需要關閉／恢復 FK 時遵守安全順序；考慮新舊程式短暫共存的相容性；重大 migration 前有備份與復原策略。

## 前端（React）

### 9. state updater 是純函式；取得最新值有分級策略
- 不要在 updater 裡產生 key、push 陣列、做任何外部可見的副作用——Concurrent Mode 會延後或重跑。先在外面產好**不可變清單**，再分別餵給多個 setter。
- render closure 的 state 在 await 之後**可能過時**。取最新值的優先順序：
  1. 能把最新值當**函式參數**傳入就傳參（最單純）。
  2. 多個相關 state 需要原子更新 → 併成**單一 reducer**，讓「改文字＋改標記」成為同一次 transition。
  3. event handler 需要最新 committed state → 用 effect 維護 ref（或 React 的 effect event）。
  4. 確知專案未使用 concurrent 特性時，才用 render-time ref mirror（`ref.current = state` 於 render 中賦值），並註明此限制——它可能暴露尚未 commit 的 render 值。
- 反例：在 setItemState 的 updater 裡 push key 給外部陣列；用 render closure 的 desc 做 await 後的預檢。

### 10. 逐筆提交的迴圈：每筆成功立即反映
- 對後端逐筆提交的迴圈（逐張複製等），**每筆成功就立即更新 UI state**，並回報「實際成功數」讓上游精準標記——部分失敗時絕不能存在「已提交但畫面看不到」的隱形資料，否則重試會重複提交、取消也清不掉。

### 11. 任何數量只能有一個來源
- 容量／計數若父層 props 已即時反映，子元件**不得再自己記一份**去扣——兩套計數必然漂移。改動計數邏輯時，搜尋所有讀這個數字的地方確認來源唯一。

### 12. 編輯視窗的錯誤策略
- **只有成功、或已妥善處理的衝突（409：提示＋重載）才關閉視窗**；一般錯誤（斷線、500）保留視窗與所有草稿、重設 in-flight 旗標、顯示可理解的錯誤讓使用者重試。`finally { closeModal() }` 是反模式——任何失敗都會丟光使用者輸入。

### 13. 自動刪改使用者文字要極度保守
- 程式要收回自己插入的文字時：**整行／整段比對**（不用 substring replace，會攔腰截斷手打句子）、**位置錨定**（附加在尾端的就只從尾端收回）、**只在確實有插入時才記錄可收回標記**、**只在確實收回時才清除標記**。
- 原則：寧可殘留一段讓使用者自己刪，也不冒險刪到使用者的內容。

## 通用

### 14. 每個契約配一支回歸測試
- 修 bug 先寫「抓得到這隻 bug」的案例再修；fixture 要涵蓋關聯資料（例：刪除測試要先塞有 FK 的評分資料，否則順序錯誤測不出來）。
- 測不到 route 邏輯時，把真實 HTTP 伺服器拉起來打（tmp DB＋env 注入＋fetch，見 `backend/scripts/entry-conflict.ts`）。新寫這類測試時：port 避免寫死（用環境變數、隨機挑選或 port 0）、等待就緒用**輪詢健康端點或 listening 事件**而非固定 sleep、`try/finally` 收拾 server／DB／tmp 目錄，別只靠 `process.exit()`。
- 負向案例（409 後資料不動、檔案已收回、無效值 400）與正向案例一樣重要。

### 15. 自我審查的固定問題
設計完成後自問：
1. 這條路徑在「另一台裝置剛改過資料」時會發生什麼？
2. 這段有沒有跨 await 的 check-then-act？其他 process／connection 插隊呢？
3. 失敗在第 N 步時，前 N−1 步留下了什麼？誰負責清？
4. 這個錯誤會不會把「已成功」偽裝成失敗（或反過來）？
5. 授權判斷有沒有任何「查不到就放行」的分支？
6. server 已提交但 client 沒收到 response 時，重試會發生什麼？

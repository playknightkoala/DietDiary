# Handoff: 均衡日記（飲食紀錄 App）

## Overview
「均衡日記」是一個手機優先、桌面亦適用的飲食紀錄應用。核心功能：以「每日一頁」的日記方式記錄六大類飲食份數（依每筆餐次紀錄）、自動累計熱量、喝水量、運動、身體數據（含趨勢圖）、階段性份數目標（超標 20% 標紅）、月曆跳日，以及內建「食物份數指南」。

## About the Design Files
本包內的檔案是 **HTML 設計參考（prototype）**，展示預期的外觀與行為，**不是可直接上線的生產程式碼**。你的任務是：

1. **前端**：在目標 codebase 的既有環境（React / Vue / Next.js 等，若尚無環境請自行選擇最合適的框架，建議 React + TypeScript）中**重新實作**這些畫面與互動。
2. **後端**：原型將所有資料存在 `localStorage`、登入為純視覺。請實作真正的後端：帳號系統（註冊/登入/JWT 或 session）、資料庫（每日紀錄、餐次紀錄、目標、照片上傳），並將前端改為呼叫 API。

檔案說明：
- `均衡日記-standalone.html` — **單檔可離線開啟**，直接用瀏覽器打開即可操作完整原型（最佳參考來源）。
- `飲食紀錄.dc.html` + `support.js` — 原始原型程式碼。`<x-dc>` 內為模板（inline style 即最終視覺規格），底部 `<script data-dc-script>` 內的 `class Component` 為全部業務邏輯（**熱量計算、目標判斷、資料結構都在這裡，可直接照抄邏輯**）。

## Fidelity
**High-fidelity**：顏色、字級、圓角、間距皆為最終定案，請以像素級還原（用 codebase 的元件庫/樣式系統重建即可，不必沿用 inline style 寫法）。

## Domain Rules（核心業務規則 — 必須正確）

### 六大類與每份熱量（kcal/份）
- 蛋豆魚肉：低脂 55、中脂 75、高脂 120、超高脂 135
- 蔬菜 25；全穀雜糧 70；油脂堅果 45；水果 60
- 乳品：脫脂 80、低脂 120、全脂 150

### 份數輸入
- 使用者直接輸入數字，範圍 0.1–99，步進 0.1，前端 clamp（<0→0、>99→99、四捨五入到小數 1 位）。

### 餐次紀錄（重要資料模型）
- 每筆飲食紀錄是**獨立的 entry**：`{ id, meal, desc, photo, food }`
  - `meal`: `breakfast | lunch | dinner | night | snack`（早餐/午餐/晚餐/宵夜/點心）
  - `desc`: 文字敘述；`photo`: 餐點照片（原型存壓縮後 dataURL，正式版請上傳到物件儲存並存 URL）
  - `food`: 11 個份數欄位 `{ meatLow, meatMed, meatHigh, meatXHigh, veg, grain, oil, fruit, milkSkim, milkLow, milkFull }`
- **同一天可有多筆同餐別**（例如兩次午餐）。
- 空白 entry（無敘述、無照片、份數全 0）在關閉編輯視窗時自動刪除。
- 每餐即時顯示該筆 kcal；當日總計 = 所有 entries 加總。

### 每日目標與紅字規則
- 預設目標：蛋豆魚肉 7、蔬菜 3、全穀雜糧 10、油脂堅果 3、水果 2、乳品 2（份），喝水 2000 ml。
- 使用者可設定**日期區間**的自訂目標（六類份數 + 喝水 ml）；區間內的日期用自訂值，區間外用預設值。
- **超標判斷：當日總份數 > 目標 × 1.2 時**，該類數字與進度條轉紅（`#C0564A`），進度條上限 100%。喝水同樣適用（文字轉紅）。

### 其他每日資料
- 喝水：每次輸入正整數 ml（1–9999）按「加入」累計；可歸零重記。
- 運動：時間（分鐘）＋文字描述（不估算消耗熱量）。
- 身體數據：體重 kg、體脂率 %、腰圍 cm、肌肉重 kg、體脂重 kg（皆選填，小數 1 位）。
- 趨勢圖：任一身體欄位，取最近 30 筆有值日期畫折線圖（需 ≥2 點）。

## Screens / Views

### 1. 登入
- 置中卡片（max-width 400px），漸層背景 `linear-gradient(160deg,#EDF2E6,#F4F1EA 55%,#E8EEE0)`。
- Logo：72px 圓角 22px 綠底盾形葉子 icon；標題「均衡日記」30px/800（Outfit）；副標「六大類飲食・運動・身體數據，一天一頁」。
- 帳號、密碼欄（48px 高、圓角 12px、邊框 `#DDD8CA`、底 `#FBFAF6`），主按鈕「登入」50px 綠底。
- 原型為視覺展示（點擊即進入）；正式版接真實驗證，含「忘記密碼」「註冊新帳號」流程。

### 2. 主畫面（日記總覽）
- max-width 1100px 置中；桌面雙欄 `repeat(auto-fit,minmax(340px,1fr))`，手機自動單欄；底部預留 110px 給 FAB。
- **頂欄**：logo + 名稱（左）；右側 4 個 38px 圓角 12px 白底 icon 按鈕：月曆、目標設定、份數指南、登出。
- **週曆列**：7 欄 grid，左右箭頭切上/下週（週一起始）。每格：星期字 11px、日期 17px Outfit 700、下方 5px 圓點（該日有紀錄時橘色 `#C77B4A`）。選中日：綠底白字＋陰影；今天（未選中）：綠字。下方顯示完整日期，非今天時出現「回到今天」pill 按鈕。
- **熱量卡**（綠底 `#4A7C59` 白字）：「今日攝取熱量」+ 34px Outfit 數字 + kcal。
- **喝水卡**（白底）：累計/目標 ml（超標 20% 紅字）、藍色 `#5B8DB8` 進度條。
- **六大類卡**：每類一列 — 32px 色塊字形圖示、名稱、該類 kcal、右側「X / Y 份」（超標紅字 900）、7px 進度條（超標轉紅）。底部「查看今日飲食」outline 綠按鈕 → 開啟今日飲食彈窗。
- **今日運動卡**：摘要文字「NN 分鐘・描述」或未記錄提示。
- **身體數據卡**：5 個數值小卡（值 19px Outfit）；右上「看趨勢」pill 切換折線圖（欄位 pill 選擇器 + SVG 折線，綠線、漸層填色、端點圓點、上下極值標籤）。
- **FAB**：右下固定 60px、圓角 20px、綠底白「＋」。

### 3. ＋選單（bottom sheet）
- 底部滑出、圓角 24px 上緣、2 欄 grid、8 個選項：**早餐、午餐、晚餐、宵夜、點心**（各自建立一筆新 entry 並直接進入編輯）、**喝水、運動、身體數據**。每項：44px 色塊 glyph + 名稱。右上 ✕ 關閉。

### 4. 記錄餐次（編輯單筆 entry）
- 置中彈窗 max-width 520px。標題「記錄{餐別}」（無餐次切換列）。
- 綠色淺底橫幅：「{餐別}熱量」＋即時 kcal（隨份數輸入即時更新）。
- 照片區（88px）：未上傳顯示虛線框「上傳照片」（file input, accept image/*，原型壓縮至長邊 640px JPEG 0.7）；已上傳顯示縮圖＋「移除照片」。
- 敘述 textarea（「這餐吃了什麼？」）。
- 六大類份數輸入：蛋豆魚肉 4 欄（低脂/中脂/高脂/超高脂）、乳品 3 欄（脫脂/低脂/全脂）、其餘各 1 欄；`type=number, min 0, max 99, step 0.1`，置中對齊。
- 底部：「完成」綠按鈕、「刪除這筆紀錄」紅字按鈕。

### 5. 今日飲食（彈窗）
- 只列出**當天實際有資料的 entries**（依餐別排序）；每列：照片縮圖或 glyph 色塊（52px）、餐別名、kcal（綠字 Outfit）、敘述單行截斷、右箭頭；點擊進入該筆編輯。無紀錄時顯示空狀態文字。

### 6. 月曆彈窗
- max-width 380px；‹ › 換月、✕ 關閉；週一起始 7 欄；每格 42px：選中日綠底白字、今天淺綠底綠字、有紀錄日下方橘點；點日期跳到該日並關閉。

### 7. 階段目標彈窗
- 開始/結束日期（date input）、六類份數 number input（step 0.5）＋喝水 ml（step 50）、「取消/儲存目標」、已有目標時顯示區間與「清除」。

### 8. 食物份數指南彈窗
- max-width 560px，頂部餐類 pill 分頁（6 類，各用類別色）；內容為「一份舉例」列表卡（左側粗體份量、右側食物與可食重量）與說明段落卡。**完整內容文字已在原型的 `guideData()` 內，請直接沿用。**

## Interactions & Behavior
- 所有彈窗**不可**點背景關閉，只能用 ✕ / 取消 / 完成。
- 彈窗動畫：`popIn .25s`（scale .96→1 + fade）；bottom sheet：`fadeUp .25s`。
- 進度條寬度變化 `transition: width .3s`。
- 週曆左右切換僅移動顯示範圍，不改變選中日。
- hover 狀態：白底按鈕 → `#EDF2E6` 或 `#F4F1EA`；綠按鈕 → `#3A6347`；藍按鈕 → `#4A7CA5`。

## State Management / Backend 建議
原型 state 形狀（可直接對應 DB schema）：
```
days: {
  "YYYY-MM-DD": {
    water: number(ml),
    ex: { min: string, desc: string },
    body: { weight, fat, waist, muscle, fatkg }, // string, 空字串=未填
    entries: [ { id, meal, desc, photo, food: {11 keys} } ]
  }
},
goals: { start: "YYYY-MM-DD", end: "YYYY-MM-DD", vals: {meat,veg,grain,oil,fruit,milk}, water } | null
```
後端 API 建議：
- `POST /auth/register`, `POST /auth/login`
- `GET /days/:date`（含 entries）、`PATCH /days/:date`（water/ex/body）
- `POST /days/:date/entries`、`PATCH /entries/:id`、`DELETE /entries/:id`
- `POST /entries/:id/photo`（multipart 上傳，存物件儲存）
- `GET /goals`、`PUT /goals`、`DELETE /goals`
- `GET /body-trend?field=weight&limit=30`
- 熱量與紅字可由前端以常數表計算（規則見上），後端僅存份數。

## Design Tokens
- 背景 `#F4F1EA`；卡片白 `#FFFFFF`、卡片邊框 `#E4DFD2` 1.5px、內部淺底 `#FBFAF6`、分隔線 `#F0EDE3`
- 主綠 `#4A7C59`（hover `#3A6347`）、淺綠底 `#EDF2E6`
- 文字：主 `#2D3B2D`、次 `#4A5A4A`、弱 `#6B7565`、最弱 `#8A9284`
- 警示紅 `#C0564A`；水藍 `#5B8DB8`（hover `#4A7CA5`）、水藍淺底 `#F0F5FA`
- 類別色：蛋豆魚肉 `#C0564A`/底 `#F5E3DB`；蔬菜 `#4A7C59`/`#E3EBD9`；全穀 `#A8842E`/`#F1E8D2`；油脂 `#C77B4A`/`#F3E7D8`；水果 `#B5537A`/`#F6E5E9`；乳品 `#5B8DB8`/`#E5EBF1`
- 字型：中文 `Noto Sans TC`（400/500/700/900）、數字與標題 `Outfit`（500/700/800），Google Fonts
- 圓角：卡片 20–22px、輸入框 11–12px、按鈕 13–14px、pill 99px
- 輸入框：高 42–48px、邊框 1.5px `#DDD8CA`、底 `#FBFAF6`
- 觸控目標 ≥34px（行動端主要按鈕 ≥44px）

## Assets
無外部圖片；所有 icon 為 inline SVG（stroke 風格，線寬 1.8–2.6）。餐點照片由使用者上傳。

## Files
- `均衡日記-standalone.html` — 可直接開啟的完整互動原型（單檔）
- `飲食紀錄.dc.html` — 原型原始碼（模板 + `class Component` 業務邏輯；`guideData()` 含指南全文、`KCAL`/`DEFAULT_GOALS` 常數）
- `support.js` — 原型執行環境（runtime，僅供原型運行，不需移植）

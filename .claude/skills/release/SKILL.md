---
name: release
description: 發布均衡日記的新版本 — 更新版號、更新版本紀錄 changelog（同時會驅動底部「版本紀錄」與強制更新推送視窗的「這次更新內容」）、commit、push，並建立 GitHub Release。當使用者說「release」「發版」「發布新版本」或給出版號（如「release 1.0.2」）時使用。
---

# 發布新版本（release）

一次完成：更新版號 → 更新 changelog → build → commit → push → tag → GitHub Release。

版號可由使用者以參數帶入（例如 `/release 1.0.2`）。若未帶入，先問使用者要發哪個版號，並提議「目前版號 +0.0.1」為預設。

## 重要觀念

- **版號放在兩個 `package.json`**（`frontend/`、`backend/`），必須一致 → 一律用 `scripts/bump-version.mjs` 一次改兩邊，避免不一致造成強制更新迴圈。
- **「版本紀錄」與「強制更新推送內容」是同一份來源**：都讀 `frontend/public/changelog.json`。所以「更新版本紀錄」與「更新強制更新推送的內容」是**同一個動作**——只要在 changelog.json 最前面新增一筆即可，不需要改兩個地方。
- **為什麼放在 `public/`（靜態檔）而不是 `.ts`**：強制更新視窗會**即時抓取 `/changelog.json`**（帶版號當快取破壞參數）。因為使用者手上是「舊 bundle」，舊 bundle 打包的 changelog 不可能有「新版」的條目；必須向伺服器要新版靜態檔，才看得到這次更新內容。底部「版本紀錄」則用打包進 bundle 的同一份檔。
- 強制更新的觸發條件是「伺服器版號**嚴格大於**使用者手上的 bundle 版號」，所以新版號一定要比目前線上版號大。

## 步驟

1. **決定版號 `X.Y.Z`**
   - 讀目前版號：`node -p "require('./frontend/package.json').version"`。
   - 使用者有給參數就用參數；否則詢問，預設提議 patch +1。
   - 確認 `X.Y.Z` 嚴格大於目前版號（否則強制更新不會觸發，且是版號倒退）。

2. **整理這一版的更新內容（notes）**
   - 參考自上一個 tag 以來的變更：`git log $(git describe --tags --abbrev=0)..HEAD --oneline`，以及尚未 commit 的工作區變更。
   - 寫成**使用者看得懂的**幾條繁體中文短句（動作導向，非技術細節），風格與 changelog.json 既有條目一致。

3. **Bump 版號**
   ```bash
   node scripts/bump-version.mjs X.Y.Z
   ```

4. **更新 changelog**（`frontend/public/changelog.json`）
   - 在 JSON 陣列**最前面**新增一筆：
     ```json
     {
       "version": "X.Y.Z",
       "date": "YYYY-MM-DD",
       "notes": ["…", "…"]
     },
     ```
   - `date` 用**今天日期**（YYYY-MM-DD）。
   - 這一筆同時會顯示在底部「版本紀錄」與強制更新視窗的「這次更新內容」。

5. **驗證 build**
   ```bash
   (cd backend && npm run build) && (cd frontend && npm run build)
   ```
   有錯先修好再繼續。

6. **（建議）部署到本機 Docker 並確認版號**
   ```bash
   docker compose up -d --build
   sleep 3 && curl -s localhost:8080/api/version   # 應回報 X.Y.Z
   ```

7. **Commit**
   ```bash
   git add -A
   git commit -m "vX.Y.Z：<一句話重點>

   - <更新條目1>
   - <更新條目2>

   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
   ```

8. **Tag 並 push（含 tag）**
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --follow-tags
   ```

9. **建立 GitHub Release（標記 Latest）**
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --latest --notes "$(cat <<'EOF'
   ## vX.Y.Z

   - <更新條目1>
   - <更新條目2>
   EOF
   )"
   ```

10. **回報**：附上 Release 網址（`gh release view vX.Y.Z --json url -q .url`）與這一版的重點；提醒使用者「目前開著舊版分頁的人，最多 60 秒內會被要求更新」。

## 收尾檢查

- `frontend/package.json` 與 `backend/package.json` 版號相同且為 `X.Y.Z`。
- `frontend/public/changelog.json` 最前面有 `X.Y.Z` 這一筆。
- `git push` 已含 `vX.Y.Z` tag；`gh release list` 看得到 `vX.Y.Z` 且標記 Latest。

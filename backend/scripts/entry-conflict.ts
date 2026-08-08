// entries 樂觀鎖（revision）與日期驗證回歸測試：起真實 HTTP 伺服器打 API。
// 覆蓋：PATCH／DELETE／照片上傳／照片複製的 expectedRevision 契約（不符 409 且不落任何變更、
// 檔案收回）、舊 client 不帶鎖的相容行為、無效 expectedRevision 回 400、非真實日期回 400、
// 有照片評分（FK）的紀錄仍可刪除。
// 用法：cd backend && npx tsx scripts/entry-conflict.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-rc-'));
process.env.DB_PATH = path.join(tmp, 'rc.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
// port 0＝讓 OS 配一個空的 port：固定或隨機挑 port 都可能撞到別的服務，
// 甚至把恰好有 /api/health 的別家服務誤認成自己的 backend
process.env.PORT = '0';

const { db } = await import('../src/db.js');
const { JWT_SECRET } = await import('../src/middleware/auth.js');
const { server } = await import('../src/index.js');

// 等 listening 事件（不用 sleep），再從 server.address() 取實際 port
await new Promise<void>((resolve, reject) => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
  server.once('error', reject);
});
const addr = server.address();
const BASE = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

try {
  const uid = Number(
    db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('rc@x.com', 'x', 'active', 'member')`).run().lastInsertRowid
  );
  const token = jwt.sign({ uid }, JWT_SECRET, { expiresIn: '1d' });
  const H = { Authorization: `Bearer ${token}` };
  const HJ = { ...H, 'Content-Type': 'application/json' };
  // 最小合法 JPEG（SOI＋EOI）：只需通過 mimetype 過濾與 EXIF strip
  const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

  // ---- 建立 entry ----
  const createdRes = await fetch(`${BASE}/api/days/2026-08-08/entries`, {
    method: 'POST', headers: HJ, body: JSON.stringify({ meal: 'lunch' }),
  });
  const entry = (await createdRes.json()) as { id: number; revision: number };
  check('建立 entry：revision 從 0 開始', createdRes.status === 201 && entry.revision === 0);

  // ---- PATCH 樂觀鎖 ----
  const p1 = await fetch(`${BASE}/api/entries/${entry.id}`, {
    method: 'PATCH', headers: HJ, body: JSON.stringify({ desc: '第一台裝置', expectedRevision: 0 }),
  });
  const p1json = (await p1.json()) as { revision: number };
  check('PATCH 帶正確 expectedRevision → 200 且 revision +1', p1.status === 200 && p1json.revision === 1);

  const p2 = await fetch(`${BASE}/api/entries/${entry.id}`, {
    method: 'PATCH', headers: HJ, body: JSON.stringify({ desc: '過時裝置的舊內容', expectedRevision: 0 }),
  });
  check('PATCH 帶過時 expectedRevision → 409', p2.status === 409);
  const descNow = (db.prepare('SELECT desc FROM entries WHERE id = ?').get(entry.id) as { desc: string }).desc;
  check('409 後內容未被覆蓋', descNow === '第一台裝置');

  const p3 = await fetch(`${BASE}/api/entries/${entry.id}`, {
    method: 'PATCH', headers: HJ, body: JSON.stringify({ desc: '舊 client 不帶鎖' }),
  });
  check('舊 client 不帶 expectedRevision → 相容放行', p3.status === 200);

  const p4 = await fetch(`${BASE}/api/entries/${entry.id}`, {
    method: 'PATCH', headers: HJ, body: JSON.stringify({ desc: 'x', expectedRevision: -1 }),
  });
  check('無效 expectedRevision（負數）→ 400', p4.status === 400);

  // ---- 照片上傳樂觀鎖 ----
  const staleForm = new FormData();
  staleForm.append('photos', JPEG, 'a.jpg');
  staleForm.append('expectedRevision', '0'); // 目前實際是 2
  const up1 = await fetch(`${BASE}/api/entries/${entry.id}/photos`, { method: 'POST', headers: H, body: staleForm });
  check('上傳照片帶過時 expectedRevision → 409', up1.status === 409);
  check('409 上傳未留下照片（DB）', (db.prepare('SELECT photos FROM entries WHERE id = ?').get(entry.id) as { photos: string }).photos === '[]');
  check('409 上傳未留下照片（檔案已收回）', fs.readdirSync(process.env.UPLOAD_DIR!).length === 0);

  const okForm = new FormData();
  okForm.append('photos', JPEG, 'a.jpg');
  okForm.append('expectedRevision', '2');
  const up2 = await fetch(`${BASE}/api/entries/${entry.id}/photos`, { method: 'POST', headers: H, body: okForm });
  const up2json = (await up2.json()) as { photos: string[]; revision: number };
  check('上傳照片帶正確 expectedRevision → 200 且 revision +1', up2.status === 200 && up2json.revision === 3 && up2json.photos.length === 1);

  const badForm = new FormData();
  badForm.append('photos', JPEG, 'a.jpg');
  badForm.append('expectedRevision', 'abc');
  const up3 = await fetch(`${BASE}/api/entries/${entry.id}/photos`, { method: 'POST', headers: H, body: badForm });
  check('上傳照片帶無效 expectedRevision → 400', up3.status === 400);

  // ---- 照片複製樂觀鎖 ----
  const cp1 = await fetch(`${BASE}/api/entries/${entry.id}/photos/copy`, {
    method: 'POST', headers: HJ, body: JSON.stringify({ photo: up2json.photos[0], expectedRevision: 0 }),
  });
  check('複製照片帶過時 expectedRevision → 409', cp1.status === 409);
  check('409 複製未留下新檔案', fs.readdirSync(process.env.UPLOAD_DIR!).length === 1);

  // ---- DELETE 樂觀鎖 ----
  // 先替照片加上營養師評分：photo_ratings.entry_id 有 FK 指向 entries，
  // 刪除順序錯誤（先刪本體）會爆 FK constraint——這個案例守住「有評分的紀錄仍可刪除」
  db.prepare(`INSERT INTO photo_ratings (entry_id, photo, rating) VALUES (?, ?, 'green')`).run(entry.id, up2json.photos[0]);

  const d1 = await fetch(`${BASE}/api/entries/${entry.id}`, {
    method: 'DELETE', headers: HJ, body: JSON.stringify({ expectedRevision: 0 }),
  });
  check('DELETE 帶過時 expectedRevision → 409', d1.status === 409);
  check('409 後 entry 仍存在', !!db.prepare('SELECT id FROM entries WHERE id = ?').get(entry.id));
  check('409 後評分仍存在', !!db.prepare('SELECT 1 FROM photo_ratings WHERE entry_id = ?').get(entry.id));

  const d2 = await fetch(`${BASE}/api/entries/${entry.id}`, {
    method: 'DELETE', headers: HJ, body: JSON.stringify({ expectedRevision: 3 }),
  });
  check('有照片評分的紀錄帶正確 expectedRevision → 204 並刪除', d2.status === 204 && !db.prepare('SELECT id FROM entries WHERE id = ?').get(entry.id));
  check('評分一併刪除', !db.prepare('SELECT 1 FROM photo_ratings WHERE entry_id = ?').get(entry.id));

  // ---- 非真實日期 ----
  const bad1 = await fetch(`${BASE}/api/days/2026-02-31`, { headers: H });
  check('GET /days/2026-02-31（非真實日期）→ 400', bad1.status === 400);
  const e2Res = await fetch(`${BASE}/api/days/2026-08-08/entries`, { method: 'POST', headers: HJ, body: JSON.stringify({ meal: 'dinner' }) });
  const e2 = (await e2Res.json()) as { id: number };
  const bad2 = await fetch(`${BASE}/api/entries/${e2.id}`, {
    method: 'PATCH', headers: HJ, body: JSON.stringify({ date: '2026-02-31' }),
  });
  check('PATCH 移動紀錄到非真實日期 → 400', bad2.status === 400);
  const bad3 = await fetch(`${BASE}/api/days/marks?from=2026-00-00&to=2026-99-99`, { headers: H });
  check('marks 非真實日期範圍 → 400', bad3.status === 400);
} finally {
  // 不論成敗都收拾乾淨：關 server、關 DB、刪 tmp（不靠 process.exit 硬切）
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp 清不掉不影響結果 */ }
}

if (failed) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log('\nentries 樂觀鎖與日期驗證回歸全部通過');

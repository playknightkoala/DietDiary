// 刪除會員回歸測試：有 AI 資料（daily_summaries／ai_feedback／kb_votes）的會員必須能整筆刪除，
// 所有關聯表清空、照片檔案在 DB 交易成功後才刪（交易失敗時照片不得先消失）。
// 用法：cd backend && npx tsx scripts/delete-user.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-del-'));
process.env.DB_PATH = path.join(tmp, 'del.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

const { db } = await import('../src/db.js');
const { deleteUserData } = await import('../src/helpers.js');

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const now = Date.now();
const uid = Number(
  db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('victim', 'x', 'active', 'member')`).run()
    .lastInsertRowid
);
// 另一位使用者：確認刪除只影響目標會員
const other = Number(
  db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('other', 'x', 'active', 'member')`).run()
    .lastInsertRowid
);

// 照片檔＋各關聯表都放一筆
const photoFile = path.join(process.env.UPLOAD_DIR!, 'e1-123-0.jpg');
fs.writeFileSync(photoFile, 'jpg');
db.prepare(`INSERT INTO entries (user_id, date, meal, desc, photos, food) VALUES (?, '2026-08-07', 'lunch', '午餐', '["/uploads/e1-123-0.jpg"]', '{}')`).run(uid);
db.prepare(`INSERT INTO days (user_id, date, water) VALUES (?, '2026-08-07', 500)`).run(uid);
db.prepare(`INSERT INTO daily_summaries (user_id, date, body, created_at) VALUES (?, '2026-08-07', 'AI 總評', ?)`).run(uid, now);
db.prepare(`INSERT INTO ai_feedback (user_id, kind, ref, vote, body, created_at) VALUES (?, 'daily', '2026-08-07', 1, '', ?)`).run(uid, now);
db.prepare(`INSERT INTO kb_votes (user_id, dish_id, vote, updated_at) VALUES (?, 99, 1, ?)`).run(uid, now);
db.prepare(`INSERT INTO daily_summaries (user_id, date, body, created_at) VALUES (?, '2026-08-07', '別人的總評', ?)`).run(other, now);

let threw = false;
try {
  deleteUserData(uid);
} catch (e) {
  threw = true;
  console.error(e);
}
check('有 AI 資料的會員可刪除（不觸發 FK constraint）', !threw);

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE user_id = ?`).get(uid) as { c: number }).c;
for (const t of ['users' /* WHERE id */, 'entries', 'days', 'daily_summaries', 'ai_feedback', 'kb_votes']) {
  const c =
    t === 'users'
      ? (db.prepare('SELECT COUNT(*) c FROM users WHERE id = ?').get(uid) as { c: number }).c
      : count(t);
  check(`${t} 已清空`, c === 0);
}
check('照片檔已刪除', !fs.existsSync(photoFile));
check('其他會員資料不受影響', (db.prepare('SELECT COUNT(*) c FROM daily_summaries WHERE user_id = ?').get(other) as { c: number }).c === 1);

if (failed) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log('\n刪除會員回歸全部通過');

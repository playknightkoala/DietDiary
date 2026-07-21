// getDayJson 回歸測試＋SQL 次數量測（效能評估報告 §9-§10）
// 用法：cd backend && npx tsx scripts/day-sql-count.ts
// 在暫存 DB 造「10 飲食（含照片/評分/留言）＋8 喝水＋3 運動＋AI 總評」測資，
// 斷言 SQL 次數與回傳內容；任何欄位被改壞（ratings/commentCount/feedback）都會 exit 1。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-bench-'));
process.env.DB_PATH = path.join(tmp, 'bench.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const { db } = await import('../src/db.js');
const { getDayJson, getMarkedDates } = await import('../src/helpers.js');

// 攔截所有 statement 的 run/get/all 以計數 SQL 次數
let sqlCount = 0;
const origPrepare = db.prepare.bind(db);
// @ts-expect-error 量測用途覆寫
db.prepare = (sql: string) => {
  const stmt = origPrepare(sql);
  return new Proxy(stmt, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      if ((prop === 'run' || prop === 'get' || prop === 'all') && typeof v === 'function') {
        return (...args: unknown[]) => {
          sqlCount++;
          return v.apply(target, args);
        };
      }
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
};

const DATE = '2026-07-21';
const EMPTY_DATE = '2026-07-22';
const BIG_DATE = '2026-07-23';
const NOW = 1784000000000;

function seed(): number {
  const uid = Number(
    db
      .prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('bench', 'x', 'active', 'member')`)
      .run().lastInsertRowid
  );
  db.prepare(
    `INSERT INTO days (user_id, date, water, water_time, ex_min, ex_desc, body_weight) VALUES (?, ?, 800, '12:00', '30', '快走', '60')`
  ).run(uid, DATE);

  const meals = ['breakfast', 'lunch', 'dinner', 'night', 'snack'];
  for (let i = 0; i < 10; i++) {
    const photos = i < 3 ? JSON.stringify([`/uploads/e${i}.jpg`]) : '[]';
    const entryId = Number(
      db
        .prepare(`INSERT INTO entries (user_id, date, meal, desc, photos, food) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(uid, DATE, meals[i % 5], `餐點 ${i}`, photos, JSON.stringify({ grain: 1, veg: 0.5 })).lastInsertRowid
    );
    if (i < 3) {
      db.prepare(`INSERT INTO photo_ratings (entry_id, photo, rating, rated_by) VALUES (?, ?, 'green', ?)`).run(
        entryId,
        `/uploads/e${i}.jpg`,
        uid
      );
    }
    if (i < 4) {
      db.prepare(
        `INSERT INTO entry_comments (user_id, target, author_id, body, created_at) VALUES (?, ?, ?, '加油', ?)`
      ).run(uid, `entry:${entryId}`, uid, NOW + i);
    }
  }

  for (let i = 0; i < 8; i++) {
    const logId = Number(
      db
        .prepare(`INSERT INTO water_logs (user_id, date, ml, time) VALUES (?, ?, 100, ?)`)
        .run(uid, DATE, `0${8 + i}:00`.slice(-5)).lastInsertRowid
    );
    if (i < 2) {
      db.prepare(
        `INSERT INTO entry_comments (user_id, target, author_id, body, created_at) VALUES (?, ?, ?, '多喝水', ?)`
      ).run(uid, `water:${logId}`, uid, NOW + 100 + i);
    }
  }

  for (let i = 0; i < 3; i++) {
    const logId = Number(
      db
        .prepare(`INSERT INTO ex_logs (user_id, date, min, desc, time) VALUES (?, ?, '10', '快走', ?)`)
        .run(uid, DATE, `${18 + i}:00`).lastInsertRowid
    );
    if (i < 1) {
      db.prepare(
        `INSERT INTO entry_comments (user_id, target, author_id, body, created_at) VALUES (?, ?, ?, '讚', ?)`
      ).run(uid, `ex:${logId}`, uid, NOW + 200 + i);
    }
  }

  db.prepare(`INSERT INTO daily_summaries (user_id, date, body, model, created_at) VALUES (?, ?, '總評內容', 'test', ?)`).run(
    uid,
    DATE,
    NOW
  );
  db.prepare(`INSERT INTO ai_feedback (user_id, kind, ref, vote, body, created_at) VALUES (?, 'daily', ?, 1, '總評內容', ?)`).run(
    uid,
    DATE,
    NOW
  );

  // 極端資料日：1200 筆喝水 log，驗證留言數查詢的 500 筆分批（bind 參數上限 32766 的保險）
  const insertBig = db.prepare(`INSERT INTO water_logs (user_id, date, ml, time) VALUES (?, ?, 10, '')`);
  for (let i = 0; i < 1200; i++) insertBig.run(uid, BIG_DATE);
  return uid;
}

const uid = seed();

// ---- 代表性一日：SQL 次數與內容 ----
sqlCount = 0;
const json = getDayJson(uid, DATE);
const dayCount = sqlCount;
assert.equal(dayCount, 7, `代表日 SQL 次數應為 7，實際 ${dayCount}`);
assert.equal(json.entries.length, 10);
assert.equal(json.entries[0].ratings['/uploads/e0.jpg'], 'green');
assert.equal(json.entries[0].commentCount, 1);
assert.equal(json.entries[9].commentCount, 0);
assert.deepEqual(json.entries[9].ratings, {});
assert.equal(json.waterLogs.length, 8);
assert.equal(json.waterLogs[0].commentCount, 1);
assert.equal(json.waterLogs[7].commentCount, 0);
assert.equal(json.exLogs.length, 3);
assert.equal(json.exLogs[0].commentCount, 1);
assert.equal(json.water, 800);
assert.equal(json.aiSummary?.body, '總評內容');
assert.equal(json.aiSummary?.feedback, 1);

// ---- 空白日：不可組出 IN ()，次數固定 5（day/entries/water/ex/summary）----
sqlCount = 0;
const empty = getDayJson(uid, EMPTY_DATE);
assert.equal(sqlCount, 5, `空白日 SQL 次數應為 5，實際 ${sqlCount}`);
assert.equal(empty.entries.length, 0);
assert.equal(empty.aiSummary, null);

// ---- 極端資料日：1200 個 target → 留言數分 3 批，總次數 8 ----
sqlCount = 0;
const big = getDayJson(uid, BIG_DATE);
assert.equal(sqlCount, 8, `1200 筆日 SQL 次數應為 8（含 3 批留言查詢），實際 ${sqlCount}`);
assert.equal(big.waterLogs.length, 1200);
assert.ok(big.waterLogs.every((w) => w.commentCount === 0));

// ---- 月曆 marks ----
sqlCount = 0;
const marked = getMarkedDates(uid, '2026-07-01', '2026-07-31');
const marksCount = sqlCount;
assert.ok(marked.includes(DATE));
assert.ok(!marked.includes(EMPTY_DATE));

console.log(`PASS  代表日（10 飲食/8 喝水/3 運動＋總評）SQL 次數：${dayCount}`);
console.log(`PASS  空白日 SQL 次數：5（無 IN () 錯誤）`);
console.log(`PASS  1200 筆極端日：分批查詢正常`);
console.log(`PASS  getMarkedDates（單月）SQL 次數：${marksCount}`);
console.log(`PASS  回傳內容斷言全數通過`);

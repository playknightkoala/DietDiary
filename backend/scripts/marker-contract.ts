// marker 契約回歸測試（效能評估報告 §5）：
// 月曆亮燈規則是前後端共同契約——每個案例同時問後端 getMarkedDates 與
// 前端 dayHasData（直接載入 frontend/src/lib/domain.ts 的真實實作），三方必須一致。
// 用法：cd backend && npx tsx scripts/marker-contract.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-marker-'));
process.env.DB_PATH = path.join(tmp, 'marker.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const { db } = await import('../src/db.js');
const { getDayJson, getMarkedDates, ensureDayRow, recomputeDayWater, recomputeDayEx } = await import('../src/helpers.js');
const { dayHasData } = await import('../../frontend/src/lib/domain.js');

const uid = Number(
  db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('marker', 'x', 'active', 'member')`).run()
    .lastInsertRowid
);

const insertEntry = (date: string, fields: { desc?: string; photos?: string; food?: string } = {}) =>
  Number(
    db
      .prepare(`INSERT INTO entries (user_id, date, meal, desc, photos, food) VALUES (?, ?, 'lunch', ?, ?, ?)`)
      .run(uid, date, fields.desc ?? '', fields.photos ?? '[]', fields.food ?? '{}').lastInsertRowid
  );

// [日期, 建置測資, 預期 marker, 案例名]
const cases: [string, () => void, boolean, string][] = [
  ['2026-07-01', () => insertEntry('2026-07-01'), false, '只有空白 entry'],
  ['2026-07-02', () => insertEntry('2026-07-02', { desc: '滷肉飯' }), true, 'entry 有敘述'],
  ['2026-07-03', () => insertEntry('2026-07-03', { photos: '["/uploads/x.jpg"]' }), true, 'entry 有照片'],
  ['2026-07-04', () => insertEntry('2026-07-04', { food: '{"veg":1}' }), true, 'entry 有份數'],
  [
    '2026-07-05',
    () => {
      const id = insertEntry('2026-07-05', { desc: '會被刪掉' });
      db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    },
    false,
    '刪除最後一筆有效 entry',
  ],
  [
    '2026-07-06',
    () => {
      db.prepare(`INSERT INTO water_logs (user_id, date, ml, time) VALUES (?, '2026-07-06', 300, '')`).run(uid);
      recomputeDayWater(uid, '2026-07-06');
    },
    true,
    '只有喝水',
  ],
  [
    '2026-07-07',
    () => {
      db.prepare(`INSERT INTO ex_logs (user_id, date, min, desc, time) VALUES (?, '2026-07-07', '', '散步', '')`).run(uid);
      recomputeDayEx(uid, '2026-07-07');
    },
    true,
    '只有運動敘述、沒有分鐘',
  ],
  [
    '2026-07-08',
    () => {
      ensureDayRow(uid, '2026-07-08');
      db.prepare(`UPDATE days SET body_weight = '60' WHERE user_id = ? AND date = '2026-07-08'`).run(uid);
    },
    true,
    '只有身體資料',
  ],
  [
    '2026-07-09',
    () => {
      db.prepare(`INSERT INTO daily_summaries (user_id, date, body, model, created_at) VALUES (?, '2026-07-09', '總評', 't', 1)`).run(uid);
    },
    false,
    '只有 AI summary',
  ],
];

for (const [, build] of cases) build();
const marked = new Set(getMarkedDates(uid, '2026-07-01', '2026-07-31'));

let failed = 0;
for (const [date, , expected, name] of cases) {
  const backend = marked.has(date);
  const frontend = dayHasData(getDayJson(uid, date));
  const ok = backend === expected && frontend === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}：預期 ${expected}｜後端 ${backend}｜前端 ${frontend}`);
}
console.log(failed ? `\n${failed} 個案例不一致` : '\n全部案例前後端一致');
process.exit(failed ? 1 : 0);

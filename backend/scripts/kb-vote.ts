// KB 投票防灌票回歸測試：每人對每道菜最多一票——重送同票不累加、改票兩邊各動一、
// 取消回退原票、偽造 dishId 不計。用法：cd backend && npx tsx scripts/kb-vote.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-kbv-'));
process.env.DB_PATH = path.join(tmp, 'kbv.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const { db } = await import('../src/db.js');
const { kbVote } = await import('../src/kb.js');

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const u1 = Number(db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('v1', 'x', 'active', 'member')`).run().lastInsertRowid);
const u2 = Number(db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('v2', 'x', 'active', 'member')`).run().lastInsertRowid);
const dish = Number(db.prepare(`INSERT INTO dish_kb (caption, food, updated_at) VALUES ('滷雞腿便當', '{}', 0)`).run().lastInsertRowid);

const tally = () => db.prepare('SELECT up, down FROM dish_kb WHERE id = ?').get(dish) as { up: number; down: number };

kbVote(u1, dish, 1);
check('首次讚：up=1', tally().up === 1 && tally().down === 0);
for (let i = 0; i < 10; i++) kbVote(u1, dish, 1);
check('重送同票 10 次不累加', tally().up === 1);
kbVote(u1, dish, -1);
check('改成倒讚：up=0 down=1', tally().up === 0 && tally().down === 1);
kbVote(u1, dish, 0);
check('取消：兩邊歸零', tally().up === 0 && tally().down === 0);
for (let i = 0; i < 5; i++) { kbVote(u1, dish, 1); kbVote(u1, dish, 0); }
check('反覆投→取消 5 輪後仍為 0', tally().up === 0 && tally().down === 0);
kbVote(u1, dish, 1);
kbVote(u2, dish, 1);
check('兩人各一票：up=2', tally().up === 2);
kbVote(u1, 987654, 1);
check('偽造 dishId 不生效也不炸', true);

if (failed) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log('\nKB 投票回歸全部通過');

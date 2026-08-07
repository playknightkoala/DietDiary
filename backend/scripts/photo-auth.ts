// 照片存取驗證（/uploads）回歸測試：需登入（dd_photo cookie），且每張照片都要驗出擁有者（fail-closed）——
// 本人或營養師／管理者可看、其他會員 403；legacy 檔名以 URL 反查 entries；
// DB 查不到擁有者（孤兒檔／紀錄已刪除）一律 404；percent-encode 檔名不可繞過 entryId 解析。
// 用法：cd backend && npx tsx scripts/photo-auth.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-pa-'));
process.env.DB_PATH = path.join(tmp, 'pa.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const { db } = await import('../src/db.js');
const { JWT_SECRET, photoAuth } = await import('../src/middleware/auth.js');
const { unlinkPhoto } = await import('../src/helpers.js');
import type { Request, Response, NextFunction } from 'express';

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

const mkUser = (name: string, role: string) =>
  Number(db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES (?, 'x', 'active', ?)`).run(name, role).lastInsertRowid);
const owner = mkUser('owner', 'member');
const stranger = mkUser('stranger', 'member');
const dietitian = mkUser('diet', 'dietitian');
const entryId = Number(
  db.prepare(`INSERT INTO entries (user_id, date, meal) VALUES (?, '2026-08-07', 'lunch')`).run(owner).lastInsertRowid
);
// legacy 檔名（無 e{id}- 前綴）的照片：URL 存在 owner 的 photos 陣列裡
db.prepare(`INSERT INTO entries (user_id, date, meal, photos) VALUES (?, '2026-08-07', 'dinner', ?)`).run(
  owner,
  JSON.stringify(['/uploads/legacy-owned.jpg'])
);

// 直接呼叫 middleware：偽造 req/res，回傳 'next' 或 HTTP status
function run(cookie: string | undefined, filePath: string): string {
  let result = '';
  const req = { headers: cookie ? { cookie } : {}, path: filePath } as unknown as Request;
  const res = {
    status: (code: number) => ({ end: () => { result = String(code); } }),
  } as unknown as Response;
  photoAuth(req, res, (() => { result = 'next'; }) as NextFunction);
  return result;
}
const cookieFor = (uid: number) => `dd_photo=${jwt.sign({ uid }, JWT_SECRET, { expiresIn: '1d' })}`;
const photo = `/e${entryId}-123-0.jpg`;

check('沒有 cookie → 401', run(undefined, photo) === '401');
check('無效 token → 401', run('dd_photo=garbage', photo) === '401');
check('本人 → 放行', run(cookieFor(owner), photo) === 'next');
check('其他會員 → 403', run(cookieFor(stranger), photo) === '403');
check('營養師 → 放行', run(cookieFor(dietitian), photo) === 'next');
check('percent-encode 檔名不可繞過擁有者檢查（其他會員 → 403）', run(cookieFor(stranger), `/%65${entryId}-123-0.jpg`) === '403');
check('legacy 檔名・URL 反查到擁有者 → 本人放行', run(cookieFor(owner), '/legacy-owned.jpg') === 'next');
check('legacy 檔名・URL 反查到擁有者 → 其他會員 403', run(cookieFor(stranger), '/legacy-owned.jpg') === '403');
check('legacy 檔名・URL 反查到擁有者 → 營養師放行', run(cookieFor(dietitian), '/legacy-owned.jpg') === 'next');
check('孤兒檔（DB 查無此 URL）→ 404', run(cookieFor(stranger), '/old-photo.jpg') === '404');
check('孤兒檔 → 本人身分也是 404', run(cookieFor(owner), '/old-photo.jpg') === '404');
check('紀錄已刪除 → 404', run(cookieFor(stranger), '/e999999-1-0.jpg') === '404');

// legacy 照片自 DB 移除後：即使實體檔案 unlink 失敗殘留，對照表立即失效 → 404（fail-closed）
db.prepare(`UPDATE entries SET photos = '[]' WHERE photos = ?`).run(JSON.stringify(['/uploads/legacy-owned.jpg']));
unlinkPhoto('/uploads/legacy-owned.jpg');
check('legacy 照片自 DB 移除後 → 本人也是 404（不等 TTL）', run(cookieFor(owner), '/legacy-owned.jpg') === '404');
check('legacy 照片自 DB 移除後 → 營養師也是 404', run(cookieFor(dietitian), '/legacy-owned.jpg') === '404');

if (failed) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log('\n照片存取驗證回歸全部通過');

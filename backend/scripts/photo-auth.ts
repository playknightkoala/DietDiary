// 照片存取驗證（/uploads）回歸測試：需登入（dd_photo cookie）；
// 檔名可解析出 entryId 時驗擁有者——本人或營養師／管理者可看、其他會員 403；
// legacy 檔名或紀錄已刪除則放行到「已登入」層級。
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
check('legacy 檔名（無 entryId）→ 已登入即放行', run(cookieFor(stranger), '/old-photo.jpg') === 'next');
check('紀錄已刪除 → 已登入即放行', run(cookieFor(stranger), '/e999999-1-0.jpg') === 'next');

if (failed) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log('\n照片存取驗證回歸全部通過');

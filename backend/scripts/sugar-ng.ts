// 糖統計／NG 關鍵字回歸測試：
// Part A（契約與規則）——後端 monthSugarNgStats 的每日糖量必須與前端 domain.dayMacros(entries).sugar
// 一致（逐筆累計原始值、當日總和才捨入一次）；關鍵字正規化（NFKC＋小寫）、同日去重、多命中全報、
// 月界不外漏、排除詞剔除；分類 CRUD（資料化、有關鍵字的分類不可刪）；門檻預設 25／UPSERT 冪等；
// 種子（v2）只播一次。
// Part B（HTTP）——month-stats 授權與 month 驗證；/api/admin/ng 全端點 admin-only（fail-closed）；
// 重複關鍵字／分類 409 且零副作用；非法門檻 400 且值不動；刪有關鍵字的分類 409。
// 用法：cd backend && npx tsx scripts/sugar-ng.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-sng-'));
process.env.DB_PATH = path.join(tmp, 'sng.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.PORT = '0';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `（${detail}）`}`);
  if (!ok) failed++;
}

let dbRef: { close: () => void } | undefined;
let server: Server | undefined;
try {
  const { db } = await import('../src/db.js');
  dbRef = db;
  const { getDayJson } = await import('../src/helpers.js');
  const ng = await import('../src/ng.js');
  const { ngCategorySchema, ngKeywordSchema } = await import('../src/validation.js');
  const { dayMacros } = await import('../../frontend/src/lib/domain.js');
  const { JWT_SECRET } = await import('../src/middleware/auth.js');
  ({ server } = await import('../src/index.js'));

  const srv = server;
  await new Promise<void>((resolve, reject) => {
    if (srv.listening) return resolve();
    srv.once('listening', resolve);
    srv.once('error', reject);
  });
  const addr = srv.address();
  const BASE = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const uid = Number(
    db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('ng@x.com', 'x', 'active', 'member')`).run().lastInsertRowid
  );
  const insertEntry = (date: string, f: { desc?: string; photoCustoms?: string; items?: string } = {}) =>
    db.prepare(`INSERT INTO entries (user_id, date, meal, desc, photo_customs, items) VALUES (?, ?, 'lunch', ?, ?, ?)`)
      .run(uid, date, f.desc ?? '', f.photoCustoms ?? '{}', f.items ?? '[]');

  const sugarPC = (amount: number) => `{"/uploads/x.jpg":[{"type":"sugar","name":"","amount":${amount},"kcal":${Math.round(amount * 4)}}]}`;
  const sugarItems = (amount: number) => `[{"food":{},"customItems":[{"type":"sugar","name":"","amount":${amount},"kcal":${Math.round(amount * 4)}}]}]`;

  // ---- 測資 ----
  insertEntry('2026-08-01', { photoCustoms: sugarPC(30) });                       // 只有 photo_customs 糖
  insertEntry('2026-08-02', { items: sugarItems(12.5) });                          // 只有 items 糖
  insertEntry('2026-08-03', { photoCustoms: sugarPC(0.1) });                       // 混合多筆：0.1 + 0.2
  insertEntry('2026-08-03', { items: sugarItems(0.2) });                           //（累計後才捨入→ 0.3，非 0.30000000000000004）
  insertEntry('2026-08-04', { photoCustoms: '{"/uploads/x.jpg":[{"type":"sugar","name":"","amount":null,"kcal":0}]}' }); // amount null
  insertEntry('2026-08-05', { items: '[{"food":{},"customItems":[{"type":"custom","name":"鹽酥雞","amount":null,"kcal":500},{"type":"protein","name":"","amount":20,"kcal":80}]}]' }); // custom/protein 不計糖；名稱命中
  insertEntry('2026-08-06', { desc: '晚餐喝了可樂跟奶茶' });                        // 一段文字命中多關鍵字
  insertEntry('2026-08-07', { desc: '午餐可樂' });                                  // 同日兩筆同關鍵字
  insertEntry('2026-08-07', { desc: '晚餐又喝可樂' });
  insertEntry('2026-08-08', { desc: 'ＣＯＬＡ好喝' });                              // 全形→NFKC 命中 cola
  insertEntry('2026-08-09');                                                       // 空白 entry
  insertEntry('2026-08-12', { desc: '吃了70%黑巧克力' });                           // 種子排除詞：不算 NG
  insertEntry('2026-08-13', { desc: '巧克力蛋糕真好吃' });                          // 排除詞不影響其他命中
  insertEntry('2026-07-31', { photoCustoms: sugarPC(50) });                        // 月界外
  insertEntry('2026-09-01', { photoCustoms: sugarPC(50) });

  // ---- Part A：種子（v2） ----
  check('種子旗標（v2）已寫入', !!db.prepare(`SELECT 1 FROM app_settings WHERE key = 'ng_seeded_v2'`).get());
  const cats = ng.listNgCategories();
  check('種子分類 27 個', cats.length === 27, `實際 ${cats.length}`);
  check('分類依等級排序（極高在前）', cats[0].level === 'extreme' && cats[cats.length - 1].level === 'medium');
  const kwCount = () => (db.prepare('SELECT COUNT(*) AS c FROM ng_keywords').get() as { c: number }).c;
  check('種子關鍵字 123 筆（含 1 個排除詞）', kwCount() === 123, `實際 ${kwCount()}`);
  check('黑巧克力排除詞已播種', ng.listNgKeywords().some((k) => k.keyword === '黑巧克力' && k.isExclusion && k.categoryId === null));

  // ---- Part A：分類 CRUD ----
  const testCat = ng.createNgCategory('測試分類', 'medium', '測試用');
  check('建立分類', testCat.id > 0 && testCat.level === 'medium');
  try {
    ng.createNgCategory('測試分類', 'high', '');
    check('重複分類名拋 UNIQUE', false);
  } catch (e) {
    check('重複分類名拋 UNIQUE', (e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE');
  }
  const updatedCat = ng.updateNgCategory(testCat.id, '測試分類', 'high', '改過');
  check('更新分類', updatedCat?.level === 'high' && updatedCat.note === '改過');
  check('update 不存在分類 → null', ng.updateNgCategory(99999, 'x', 'high', '') === null);
  check('schema 擋非法等級', !ngCategorySchema.safeParse({ name: '測試', level: 'ultra' }).success);

  const cola = ng.createNgKeyword('Cola', testCat.id, false);
  check('關鍵字儲存為正規化形（Cola→cola）', cola.keyword === 'cola' && cola.categoryId === testCat.id);
  try {
    ng.deleteNgCategory(testCat.id);
    check('刪除仍有關鍵字的分類 → FK 擋下', false);
  } catch (e) {
    check('刪除仍有關鍵字的分類 → FK 擋下', String((e as { code?: string }).code).startsWith('SQLITE_CONSTRAINT'));
  }
  const emptyCat = ng.createNgCategory('空分類', 'medium', '');
  check('刪除沒有關鍵字的分類 → 成功', ng.deleteNgCategory(emptyCat.id));

  // ---- Part A：關鍵字函式 ----
  try {
    ng.createNgKeyword(' 可樂 ', testCat.id, false);
    check('重複關鍵字（正規化後同形）拋 UNIQUE', false);
  } catch (e) {
    check('重複關鍵字（正規化後同形）拋 UNIQUE', (e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE');
  }
  check('update 不存在 id → null', ng.updateNgKeyword(99999, '測試', testCat.id, false) === null);
  check('delete 不存在 id → false', !ng.deleteNgKeyword(99999));
  check('schema 擋空字串', !ngKeywordSchema.safeParse({ keyword: '   ', categoryId: 1 }).success);
  check('schema 擋超長（31 字）', !ngKeywordSchema.safeParse({ keyword: 'x'.repeat(31), categoryId: 1 }).success);

  // ---- Part A：門檻 ----
  check('未設定門檻 → 預設 25', ng.getSugarLimit() === 25);
  ng.setSugarLimit(30);
  check('setSugarLimit(30) → 30', ng.getSugarLimit() === 30);
  ng.setSugarLimit(30);
  check('重複 set 冪等', ng.getSugarLimit() === 30);

  // ---- Part A：月統計 ----
  const stats = ng.monthSugarNgStats(uid, '2026-08');
  const byDate = new Map(stats.map((d) => [d.date, d]));

  // 糖量契約：統計內每一天都必須等於前端 dayMacros 的結果
  for (const d of stats) {
    const fe = dayMacros(getDayJson(uid, d.date).entries).sugar;
    check(`糖量契約 ${d.date}：後端 ${d.sugar} == 前端 ${fe}`, d.sugar === fe);
  }
  check('photo_customs 糖 30', byDate.get('2026-08-01')?.sugar === 30);
  check('items 糖 12.5', byDate.get('2026-08-02')?.sugar === 12.5);
  check('跨筆累計後才捨入（0.1+0.2 → 0.3）', byDate.get('2026-08-03')?.sugar === 0.3);
  check('amount null 的糖項不產生統計日', !byDate.has('2026-08-04'));
  const d05 = byDate.get('2026-08-05');
  check('custom/protein 不計入糖（sugar 0 但有命中仍出現）', d05?.sugar === 0 && d05.ngHits.some((h) => h.keyword === '鹽酥雞'));
  const d06 = byDate.get('2026-08-06');
  check('一段文字命中多關鍵字全報', !!d06 && ['可樂', '奶茶'].every((k) => d06.ngHits.some((h) => h.keyword === k)));
  const colaHit = d06?.ngHits.find((h) => h.keyword === '可樂');
  check('命中附分類名與等級', colaHit?.category === '含糖瓶裝飲料' && colaHit.level === 'extreme');
  const d07 = byDate.get('2026-08-07');
  check('同日兩筆同關鍵字只回報一次', d07?.ngHits.filter((h) => h.keyword === '可樂').length === 1);
  check('全形ＣＯＬＡ命中 cola（NFKC＋小寫）', byDate.get('2026-08-08')?.ngHits.some((h) => h.keyword === 'cola') === true);
  check('空白 entry 的日子不出現', !byDate.has('2026-08-09'));
  check('種子排除詞：「70%黑巧克力」不被「巧克力」誤判', !byDate.has('2026-08-12'));
  const d13 = byDate.get('2026-08-13');
  check('排除詞不影響其他命中：巧克力蛋糕 → 巧克力＋蛋糕', !!d13 && ['巧克力', '蛋糕'].every((k) => d13.ngHits.some((h) => h.keyword === k)));
  check('排除詞本身不出現在命中清單', !stats.some((d) => d.ngHits.some((h) => h.keyword === '黑巧克力')));
  check('前月末／次月初不落入本月', !byDate.has('2026-07-31') && !byDate.has('2026-09-01'));
  check('回應依日期升冪', stats.every((d, i) => i === 0 || stats[i - 1].date < d.date));

  // ---- Part B：HTTP ----
  const token = jwt.sign({ uid }, JWT_SECRET, { expiresIn: '1d' });
  const adminUid = Number(
    db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('ngadmin@x.com', 'x', 'active', 'admin')`).run().lastInsertRowid
  );
  const adminToken = jwt.sign({ uid: adminUid }, JWT_SECRET, { expiresIn: '1d' });
  const H = { Authorization: `Bearer ${token}` };
  const HJ = { ...H, 'Content-Type': 'application/json' };
  const AJ = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };

  const noAuth = await fetch(`${BASE}/api/days/month-stats?month=2026-08`);
  check('month-stats 無 token → 401', noAuth.status === 401);
  for (const bad of ['2026-13', '2026-1', 'abc']) {
    const r = await fetch(`${BASE}/api/days/month-stats?month=${bad}`, { headers: H });
    check(`month-stats month=${bad} → 400`, r.status === 400);
  }
  const ok = await fetch(`${BASE}/api/days/month-stats?month=2026-08`, { headers: H });
  const okJson = (await ok.json()) as { month: string; sugarLimit: number; days: unknown[] };
  check('month-stats 合法 → 200 且形狀正確', ok.status === 200 && okJson.month === '2026-08' && okJson.sugarLimit === 30 && Array.isArray(okJson.days) && okJson.days.length === stats.length);

  const memberCalls: [string, RequestInit][] = [
    ['/api/admin/ng', { headers: H }],
    ['/api/admin/ng/sugar-limit', { method: 'PUT', headers: HJ, body: '{"grams":10}' }],
    ['/api/admin/ng/keywords', { method: 'POST', headers: HJ, body: '{"keyword":"測試","categoryId":1}' }],
    ['/api/admin/ng/keywords/1', { method: 'DELETE', headers: H }],
    ['/api/admin/ng/categories', { method: 'POST', headers: HJ, body: '{"name":"測試","level":"high"}' }],
    ['/api/admin/ng/categories/1', { method: 'PUT', headers: HJ, body: '{"name":"測試","level":"high"}' }],
    ['/api/admin/ng/categories/1', { method: 'DELETE', headers: H }],
  ];
  for (const [url, init] of memberCalls) {
    const r = await fetch(`${BASE}${url}`, init);
    check(`member 打 ${init.method ?? 'GET'} ${url} → 403`, r.status === 403);
  }

  // 營養師檢視會員統計（pro 路由）：dietitian 可讀、member 403、形狀與會員端一致
  const dietUid = Number(
    db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES ('ngdiet@x.com', 'x', 'active', 'dietitian')`).run().lastInsertRowid
  );
  const dietToken = jwt.sign({ uid: dietUid }, JWT_SECRET, { expiresIn: '1d' });
  const proOk = await fetch(`${BASE}/api/pro/members/${uid}/month-stats?month=2026-08`, { headers: { Authorization: `Bearer ${dietToken}` } });
  const proJson = (await proOk.json()) as { month: string; sugarLimit: number; days: unknown[] };
  check('pro month-stats（dietitian）→ 200 且與會員端同形狀', proOk.status === 200 && proJson.month === '2026-08' && proJson.days.length === stats.length);
  const proMember = await fetch(`${BASE}/api/pro/members/${uid}/month-stats?month=2026-08`, { headers: H });
  check('pro month-stats（member token）→ 403', proMember.status === 403);
  const proBadMonth = await fetch(`${BASE}/api/pro/members/${uid}/month-stats?month=2026-13`, { headers: { Authorization: `Bearer ${dietToken}` } });
  check('pro month-stats month=2026-13 → 400', proBadMonth.status === 400);

  const adminGet = await fetch(`${BASE}/api/admin/ng`, { headers: AJ });
  const adminJson = (await adminGet.json()) as { sugarLimit: number; categories: { id: number; name: string }[]; keywords: { keyword: string }[] };
  check('admin GET /api/admin/ng → 200 含門檻／分類／清單', adminGet.status === 200 && adminJson.sugarLimit === 30 && adminJson.categories.length >= 27 && adminJson.keywords.length >= 120);

  const someCatId = adminJson.categories[0].id;
  const before = kwCount();
  const dup = await fetch(`${BASE}/api/admin/ng/keywords`, { method: 'POST', headers: AJ, body: JSON.stringify({ keyword: '可樂', categoryId: someCatId }) });
  check('POST 重複關鍵字 → 409 且筆數不變', dup.status === 409 && kwCount() === before);
  const noCat = await fetch(`${BASE}/api/admin/ng/keywords`, { method: 'POST', headers: AJ, body: '{"keyword":"新詞沒分類"}' });
  check('POST 非排除詞未帶 categoryId → 400', noCat.status === 400 && kwCount() === before);
  const badCat = await fetch(`${BASE}/api/admin/ng/keywords`, { method: 'POST', headers: AJ, body: '{"keyword":"新詞壞分類","categoryId":99999}' });
  check('POST 不存在的 categoryId → 400（FK）', badCat.status === 400 && kwCount() === before);
  const exOk = await fetch(`${BASE}/api/admin/ng/keywords`, { method: 'POST', headers: AJ, body: '{"keyword":"零卡可樂","isExclusion":true}' });
  const exJson = (await exOk.json()) as { isExclusion: boolean; categoryId: number | null };
  check('POST 排除詞不需分類 → 201', exOk.status === 201 && exJson.isExclusion && exJson.categoryId === null);

  const catCountRow = () => (db.prepare('SELECT COUNT(*) AS c FROM ng_categories').get() as { c: number }).c;
  const catsBefore = catCountRow();
  const delCat = await fetch(`${BASE}/api/admin/ng/categories/${someCatId}`, { method: 'DELETE', headers: { Authorization: AJ.Authorization } });
  check('DELETE 有關鍵字的分類 → 409 且分類不變', delCat.status === 409 && catCountRow() === catsBefore);
  const dupCat = await fetch(`${BASE}/api/admin/ng/categories`, { method: 'POST', headers: AJ, body: '{"name":"炸物","level":"high"}' });
  check('POST 重複分類 → 409 且分類不變', dupCat.status === 409 && catCountRow() === catsBefore);
  const newCat = await fetch(`${BASE}/api/admin/ng/categories`, { method: 'POST', headers: AJ, body: '{"name":"宵夜","level":"high","note":"測試"}' });
  const newCatJson = (await newCat.json()) as { id: number };
  check('admin POST 新分類 → 201', newCat.status === 201 && newCatJson.id > 0);
  const delEmpty = await fetch(`${BASE}/api/admin/ng/categories/${newCatJson.id}`, { method: 'DELETE', headers: { Authorization: AJ.Authorization } });
  check('DELETE 空分類 → 204', delEmpty.status === 204);

  for (const grams of [0, 201, 25.5]) {
    const r = await fetch(`${BASE}/api/admin/ng/sugar-limit`, { method: 'PUT', headers: AJ, body: JSON.stringify({ grams }) });
    check(`PUT sugar-limit grams=${grams} → 400 且值不動`, r.status === 400 && ng.getSugarLimit() === 30);
  }

  // 種子不復活：刪光關鍵字後旗標仍在，重啟不會重播（旗標即防復活契約）
  db.prepare('DELETE FROM ng_keywords').run();
  check('刪光關鍵字後種子旗標仍在（重啟不復活）', !!db.prepare(`SELECT 1 FROM app_settings WHERE key = 'ng_seeded_v2'`).get());
  check('關鍵字全刪後 month-stats 不噴錯', ng.monthSugarNgStats(uid, '2026-08').every((d) => d.ngHits.length === 0));
} finally {
  const srv = server;
  if (srv) await new Promise<void>((resolve) => srv.close(() => resolve()));
  try { dbRef?.close(); } catch { /* 已關或未開啟 */ }
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} 個案例失敗` : '\n全部案例通過');
process.exit(failed ? 1 : 0);

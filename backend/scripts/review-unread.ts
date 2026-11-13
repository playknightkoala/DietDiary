// 營養師回饋「逐餐必讀」視窗的未讀／已讀契約回歸測試：起真實 HTTP 伺服器打 API。
// 覆蓋：評分／留言／份量調整產生未讀並依餐分組；已讀只標「實際顯示過且內容未變」的項目
// （翻頁期間換燈號、新留言、再次調整都不會被誤標）；別人的 id 標不到（fail-closed）；
// 重送冪等；格式錯誤 400；升級前舊資料、喝水留言、會員自己的留言不進清單；
// 清除評分／刪留言／刪照片／刪整餐／會員自行改份數後未讀自然消失；
// pro 編輯撞 409 不留下未讀；已讀不動 revision；同餐鈴鐺通知連動標已讀。
// 用法：cd backend && npx tsx scripts/review-unread.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dietdiary-rv-'));
process.env.DB_PATH = path.join(tmp, 'rv.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.PORT = '0'; // 讓 OS 配空的 port（見 entry-conflict.ts）

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

interface ReviewItem {
  date: string;
  entry: { id: number; meal: string; photos: string[]; food: Record<string, number>; orig: unknown; revision: number };
  ratings: Record<string, string>;
  comments: { id: number; body: string; author: string }[];
  foodUnreadAt: number;
}

let dbRef: { close: () => void } | undefined;
let server: Server | undefined;
try {
  const { db } = await import('../src/db.js');
  dbRef = db;
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

  const mkUser = (username: string, role: string) => {
    const id = Number(
      db.prepare(`INSERT INTO users (username, password_hash, status, role) VALUES (?, 'x', 'active', ?)`).run(username, role).lastInsertRowid
    );
    const H = { Authorization: `Bearer ${jwt.sign({ uid: id }, JWT_SECRET, { expiresIn: '1d' })}` };
    return { id, H, HJ: { ...H, 'Content-Type': 'application/json' } };
  };
  const A = mkUser('rv-a@x.com', 'member'); // 被回饋的會員
  const B = mkUser('rv-b@x.com', 'member'); // 另一位會員（越權測試）
  const D = mkUser('rv-d@x.com', 'dietitian');

  const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const FOOD_KEYS = ['meatLow', 'meatMed', 'meatHigh', 'meatXHigh', 'veg', 'grain', 'oil', 'fruit', 'milkSkim', 'milkLow', 'milkFull'];
  const food = (over: Record<string, number> = {}) => ({ ...Object.fromEntries(FOOD_KEYS.map((k) => [k, 0])), ...over });
  const DATE = '2026-08-08';

  const post = (url: string, u: typeof A, body: unknown, method = 'POST') =>
    fetch(`${BASE}${url}`, { method, headers: u.HJ, body: JSON.stringify(body) });
  const unread = async (u: typeof A) =>
    ((await (await fetch(`${BASE}/api/reviews/unread`, { headers: u.H })).json()) as { items: ReviewItem[] }).items;
  const markRead = (u: typeof A, body: unknown) => post('/api/reviews/read', u, body);
  // 以清單快照組出已讀 payload（與前端 ackReviews 相同的組法）
  const ackOf = (items: ReviewItem[]) => ({
    ratings: items.flatMap((it) => Object.entries(it.ratings).map(([photo, rating]) => ({ entryId: it.entry.id, photo, rating }))),
    commentIds: items.flatMap((it) => it.comments.map((c) => c.id)),
    adjustments: items.filter((it) => it.foodUnreadAt > 0).map((it) => ({ entryId: it.entry.id, foodUnreadAt: it.foodUnreadAt })),
  });
  const newEntry = async (u: typeof A, meal: string) =>
    ((await (await post(`/api/days/${DATE}/entries`, u, { meal })).json()) as { id: number }).id;
  const rate = (entryId: number, photo: string, rating: string | null) =>
    post(`/api/pro/members/${A.id}/entries/${entryId}/photo-rating`, D, { photo, rating }, 'PUT');
  const comment = async (target: string, body: string) =>
    (await post(`/api/pro/members/${A.id}/comments`, D, { target, body })).status;
  const notifRead = (type: string, target: string) =>
    (db.prepare('SELECT read FROM notifications WHERE user_id = ? AND member_id = 0 AND type = ? AND target = ? ORDER BY id DESC').get(A.id, type, target) as
      | { read: number }
      | undefined)?.read;

  // ---- 升級前的舊資料：欄位預設 0（已讀），改版後不會一次全部跳出來 ----
  const oldId = await newEntry(A, 'snack');
  db.prepare(`UPDATE entries SET photos = '["/uploads/old.jpg"]' WHERE id = ?`).run(oldId);
  db.prepare(`INSERT INTO photo_ratings (entry_id, photo, rating, rated_by) VALUES (?, '/uploads/old.jpg', 'red', ?)`).run(oldId, D.id);
  db.prepare(`INSERT INTO entry_comments (user_id, target, author_id, body, created_at) VALUES (?, ?, ?, '舊留言', 1)`).run(A.id, `entry:${oldId}`, D.id);
  check('升級前既有的評分／留言不算未讀', (await unread(A)).length === 0);

  // ---- 建立午餐（兩張照片）與晚餐（無照片） ----
  const dinner = await newEntry(A, 'dinner'); // 先建晚餐：驗證排序依餐別而非 id
  const lunch = await newEntry(A, 'lunch');
  const form = new FormData();
  form.append('photos', JPEG, 'a.jpg');
  form.append('photos', JPEG, 'b.jpg');
  const up = (await (await fetch(`${BASE}/api/entries/${lunch}/photos`, { method: 'POST', headers: A.H, body: form })).json()) as { photos: string[] };
  const [p1, p2] = up.photos;
  check('午餐上傳兩張照片', up.photos.length === 2);

  // ---- 營養師評分＋留言 ----
  check('評分 p1 綠燈', (await rate(lunch, p1, 'green')).status === 200);
  await rate(lunch, p2, 'red');
  check('營養師在午餐留言 → 201', (await comment(`entry:${lunch}`, '午餐蛋白質不錯')) === 201);
  await comment(`entry:${dinner}`, '晚餐蔬菜可以多一點');
  // 不該進清單的：會員自己的留言、喝水紀錄的營養師留言
  await post('/api/comments', A, { target: `entry:${lunch}`, body: '謝謝營養師' });
  await post(`/api/days/${DATE}/water`, A, { ml: 300 });
  const waterId = (db.prepare('SELECT id FROM water_logs WHERE user_id = ?').get(A.id) as { id: number }).id;
  await comment(`water:${waterId}`, '水喝得不錯');

  const s1 = await unread(A);
  check('未讀清單依餐分組：午餐、晚餐兩頁', s1.length === 2);
  check('同一天依餐別排序（午餐在晚餐前）', s1[0]?.entry.id === lunch && s1[1]?.entry.id === dinner);
  check('午餐頁帶兩張照片的燈號', s1[0]?.ratings[p1] === 'green' && s1[0]?.ratings[p2] === 'red');
  check('午餐頁只有營養師的留言（會員自己的不算）', s1[0]?.comments.length === 1 && s1[0].comments[0].body === '午餐蛋白質不錯');
  check('留言帶作者名稱', s1[0]?.comments[0].author === 'rv-d@x.com');
  check('晚餐頁只有留言', s1[1]?.comments.length === 1 && Object.keys(s1[1].ratings).length === 0 && s1[1].foodUnreadAt === 0);
  check('喝水紀錄的留言不標未讀', (db.prepare('SELECT unread FROM entry_comments WHERE target = ?').get(`water:${waterId}`) as { unread: number }).unread === 0);
  check('另一位會員看不到', (await unread(B)).length === 0);
  check('未登入 → 401', (await fetch(`${BASE}/api/reviews/unread`)).status === 401);

  // ---- 越權：B 拿 A 的 id 標已讀 ----
  check('別人送 A 的項目 → 200（靜默略過）', (await markRead(B, ackOf(s1))).status === 200);
  check('A 的未讀不受影響', (await unread(A)).length === 2);

  // ---- 格式錯誤 ----
  check('缺欄位 → 400', (await markRead(A, { ratings: [] })).status === 400);
  check('未知欄位 → 400', (await markRead(A, { ...ackOf(s1), extra: 1 })).status === 400);
  check('entryId 非正整數 → 400', (await markRead(A, { ratings: [{ entryId: 0, photo: p1, rating: 'green' }], commentIds: [], adjustments: [] })).status === 400);
  check('燈號不在 enum → 400', (await markRead(A, { ratings: [{ entryId: lunch, photo: p1, rating: 'blue' }], commentIds: [], adjustments: [] })).status === 400);
  check('commentIds 含字串 → 400', (await markRead(A, { ratings: [], commentIds: ['1'], adjustments: [] })).status === 400);
  check('400 後未讀不變', (await unread(A)).length === 2);

  // ---- 翻頁期間營養師又動了：只標實際顯示過的 ----
  await rate(lunch, p2, 'yellow'); // 換燈號
  await comment(`entry:${lunch}`, '補充：飯量剛好'); // 新留言
  check('以舊快照標已讀 → 200', (await markRead(A, ackOf(s1))).status === 200);
  const s2 = await unread(A);
  check('晚餐已讀、午餐因期間有新內容仍在', s2.length === 1 && s2[0].entry.id === lunch);
  check('期間換的燈號仍未讀（p1 已讀）', s2[0]?.ratings[p2] === 'yellow' && s2[0]?.ratings[p1] === undefined);
  check('期間新增的留言仍未讀', s2[0]?.comments.length === 1 && s2[0].comments[0].body === '補充：飯量剛好');
  check('晚餐的留言通知連動標已讀', notifRead('comment', `entry:${dinner}`) === 1);
  check('午餐仍有未讀 → 通知不標已讀', notifRead('rating', `entry:${lunch}`) === 0 && notifRead('comment', `entry:${lunch}`) === 0);

  check('以新快照標已讀 → 200', (await markRead(A, ackOf(s2))).status === 200);
  check('全部已讀後清單為空', (await unread(A)).length === 0);
  check('午餐的評分／留言通知連動標已讀', notifRead('rating', `entry:${lunch}`) === 1 && notifRead('comment', `entry:${lunch}`) === 1);
  check('喝水留言的通知不受影響', notifRead('comment', `water:${waterId}`) === 0);
  check('重送同一份已讀 → 200（冪等）', (await markRead(A, ackOf(s2))).status === 200 && (await unread(A)).length === 0);

  // ---- 何時再跳一次 ----
  await rate(lunch, p1, 'green');
  check('重送同燈號不重跳', (await unread(A)).length === 0);
  await rate(lunch, p1, 'red');
  const s3 = await unread(A);
  check('換燈號重跳，且只有那張照片', s3.length === 1 && s3[0].ratings[p1] === 'red' && Object.keys(s3[0].ratings).length === 1);
  await rate(lunch, p1, null);
  check('清除評分後未讀消失', (await unread(A)).length === 0);

  await comment(`entry:${lunch}`, '待會刪掉');
  const cid = (await unread(A))[0]?.comments[0]?.id;
  await fetch(`${BASE}/api/pro/members/${A.id}/comments/${cid}`, { method: 'DELETE', headers: D.H });
  check('營養師刪掉留言後未讀消失', (await unread(A)).length === 0);

  await rate(lunch, p2, 'green'); // yellow→green：未讀
  check('換燈號產生未讀', (await unread(A)).length === 1);
  await post(`/api/entries/${lunch}`, A, { photos: [p1] }, 'PATCH'); // 會員刪掉 p2
  check('會員刪掉該照片後未讀消失', (await unread(A)).length === 0);

  await comment(`entry:${dinner}`, '晚餐第二則');
  check('晚餐新留言產生未讀', (await unread(A)).length === 1);
  check('會員刪除整餐 → 204', (await fetch(`${BASE}/api/entries/${dinner}`, { method: 'DELETE', headers: A.H })).status === 204);
  check('刪除整餐後未讀消失', (await unread(A)).length === 0);

  // ---- 份量調整 ----
  const bf = await newEntry(A, 'breakfast');
  await post(`/api/entries/${bf}`, A, { items: [{ food: food({ grain: 2 }), customItems: [] }] }, 'PATCH');
  const adjust = (grain: number, extra: Record<string, unknown> = {}) =>
    post(`/api/pro/members/${A.id}/entries/${bf}/food`, D, { items: [{ food: food({ grain }), customItems: [] }], ...extra }, 'PUT');
  const bfRow = () => db.prepare('SELECT revision, food_unread_at FROM entries WHERE id = ?').get(bf) as { revision: number; food_unread_at: number };

  check('原封不動儲存 → 200', (await adjust(2)).status === 200);
  check('份量沒變不產生未讀', (await unread(A)).length === 0);

  check('實際調整份量 → 200', (await adjust(3)).status === 200);
  const s4 = await unread(A);
  check('份量調整進未讀清單', s4.length === 1 && s4[0].entry.id === bf && s4[0].foodUnreadAt > 0);
  check('頁面帶調整後份數與調整前原始資料', s4[0]?.entry.food.grain === 3 && s4[0]?.entry.orig !== null);

  const before = bfRow();
  check('pro 編輯帶過時 expectedRevision → 409', (await adjust(9, { expectedRevision: 0 })).status === 409);
  check('409 不留下新的未讀標記', bfRow().food_unread_at === before.food_unread_at && bfRow().revision === before.revision);

  await adjust(4); // 翻頁期間又調整一次
  check('再次調整後未讀值改變', bfRow().food_unread_at > before.food_unread_at);
  await markRead(A, ackOf(s4)); // 帶舊的 foodUnreadAt
  check('以舊快照標已讀：期間又被調整 → 仍未讀', (await unread(A)).length === 1);
  check('仍未讀 → 份量通知不標已讀', notifRead('food', `entry:${bf}`) === 0);

  const s5 = await unread(A);
  const revBefore = bfRow().revision;
  await markRead(A, ackOf(s5));
  check('以新快照標已讀後清單為空', (await unread(A)).length === 0);
  check('已讀不改變 revision', bfRow().revision === revBefore && bfRow().food_unread_at === 0);
  check('份量通知連動標已讀', notifRead('food', `entry:${bf}`) === 1);

  await adjust(5);
  check('再調整一次又產生未讀', (await unread(A)).length === 1);
  await post(`/api/entries/${bf}`, A, { items: [{ food: food({ grain: 1 }), customItems: [] }] }, 'PATCH');
  check('會員自行改份數後未讀消失', (await unread(A)).length === 0 && bfRow().food_unread_at === 0);
} finally {
  if (server) {
    const srv = server;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  try { dbRef?.close(); } catch { /* 已關或未開啟 */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp 清不掉不影響結果 */ }
}

if (failed) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log('\n營養師回饋必讀視窗的未讀／已讀契約回歸全部通過');

import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { FOOD_KEYS } from './validation.js';

export type Food = Record<(typeof FOOD_KEYS)[number], number>;

export const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export interface EntryRow {
  id: number;
  meal: string;
  desc: string;
  photos: string;
  eat_time: string;
  food: string;
  photo_foods: string;
  food_edited_at: number;
}

export interface DayRow {
  water: number;
  water_time: string;
  ex_min: string;
  ex_desc: string;
  ex_time: string;
  body_weight: string;
  body_fat: string;
  body_waist: string;
  body_muscle: string;
  body_fatkg: string;
  body_time: string;
}

export function emptyFood(): Food {
  return Object.fromEntries(FOOD_KEYS.map((k) => [k, 0])) as Food;
}

export function parseFood(json: string): Food {
  try {
    return { ...emptyFood(), ...JSON.parse(json) };
  } catch {
    return emptyFood();
  }
}

// 逐張照片的份數（photo url → Food）
export function parsePhotoFoods(json: string): Record<string, Food> {
  try {
    const o = JSON.parse(json);
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const out: Record<string, Food> = {};
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') out[k] = { ...emptyFood(), ...(v as Partial<Food>) };
      }
      return out;
    }
  } catch { /* fallthrough */ }
  return {};
}

// 多張照片份數加總（一位小數，避免浮點誤差）
export function sumFoods(foods: Food[]): Food {
  const total = emptyFood();
  for (const f of foods) {
    for (const k of FOOD_KEYS) total[k] = Math.round((total[k] + (f[k] || 0)) * 10) / 10;
  }
  return total;
}

export function parsePhotos(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

// 移除 JPEG 的 APP1（EXIF）段：
// 1) LLM gateway 的圖片解析器遇到帶 EXIF 的 JPEG 會 500（實測同一張照片去 EXIF 即正常）
// 2) 部分手機瀏覽器壓縮後仍留 EXIF，可能夾帶 GPS 等隱私資訊，存檔前一併去除
export function stripJpegExif(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) break; // SOS：其後為壓縮影像資料，整段保留
    const len = buf.readUInt16BE(i + 2) + 2;
    if (i + len > buf.length) break; // 段長異常，放棄處理
    if (marker !== 0xe1) out.push(buf.subarray(i, i + len)); // 丟棄 APP1（EXIF）
    i += len;
  }
  out.push(buf.subarray(i));
  return Buffer.concat(out);
}

export function unlinkPhoto(photoUrl: string) {
  if (!photoUrl.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(photoUrl));
  fs.unlink(file, () => {});
}

export function entryToJson(e: EntryRow) {
  return {
    id: e.id,
    meal: e.meal,
    desc: e.desc,
    photos: parsePhotos(e.photos),
    eatTime: e.eat_time ?? '',
    food: parseFood(e.food), // 有照片時為各照片份數的總和
    photoFoods: parsePhotoFoods(e.photo_foods ?? '{}'),
    foodEditedAt: e.food_edited_at ?? 0, // >0＝營養師調整過份數
  };
}

// 最近記過份數的照片（新→舊），供「從歷史加入」快速帶入照片＋份數
export interface HistoryItem {
  photo: string;
  food: Food;
  desc: string;
  meal: string;
  date: string;
}

// 相同餐點只保留最新一張；只回傳有記份數的照片。
// 去重規則：有敘述者以「敘述＋份數」為指紋；無敘述者若份數已被某個「有敘述」的餐點涵蓋，
// 則視為同一餐點（避免同一份餐點因為一筆有敘述、一筆沒敘述而被列成兩筆）。
export function getEntryHistory(userId: number, limit: number, excludeId?: number): HistoryItem[] {
  const rows = db
    .prepare(
      `SELECT id, date, meal, desc, photos, food, photo_foods FROM entries
       WHERE user_id = ? AND photos != '[]' AND id != ? ORDER BY date DESC, id DESC LIMIT 300`
    )
    .all(userId, excludeId ?? -1) as (EntryRow & { date: string })[];

  // 先把所有照片攤平成候選（新→舊），並算出各自的份數指紋
  const cands: (HistoryItem & { foodSig: string })[] = [];
  const describedFoodSigs = new Set<string>();
  for (const row of rows) {
    const photos = parsePhotos(row.photos);
    if (!photos.length) continue;
    const pf = parsePhotoFoods(row.photo_foods);
    const entryFood = parseFood(row.food);
    const anyPerPhoto = photos.some((u) => FOOD_KEYS.some((k) => (pf[u]?.[k] ?? 0) > 0));
    for (const url of photos) {
      let food = pf[url];
      const hasOwn = food && FOOD_KEYS.some((k) => (food![k] || 0) > 0);
      if (!hasOwn) {
        // 舊資料（無逐張份數）：整筆份數視為記在第一張
        if (!anyPerPhoto && url === photos[0] && FOOD_KEYS.some((k) => (entryFood[k] || 0) > 0)) food = entryFood;
        else continue;
      }
      const norm = { ...emptyFood(), ...food } as Food;
      const foodSig = FOOD_KEYS.map((k) => norm[k] || 0).join(',');
      if (row.desc) describedFoodSigs.add(foodSig);
      cands.push({ photo: url, food: norm, desc: row.desc, meal: row.meal as HistoryItem['meal'], date: row.date, foodSig });
    }
  }

  const items: HistoryItem[] = [];
  const seenDescFood = new Set<string>(); // 有敘述：敘述＋份數
  const seenEmptyFood = new Set<string>(); // 無敘述：僅份數
  for (const c of cands) {
    if (c.desc) {
      const key = c.desc + '|' + c.foodSig;
      if (seenDescFood.has(key)) continue;
      seenDescFood.add(key);
    } else {
      // 無敘述：份數已被有敘述的餐點涵蓋，或已出現過相同份數的無敘述照片 → 視為重複
      if (describedFoodSigs.has(c.foodSig) || seenEmptyFood.has(c.foodSig)) continue;
      seenEmptyFood.add(c.foodSig);
    }
    items.push({ photo: c.photo, food: c.food, desc: c.desc, meal: c.meal, date: c.date });
    if (items.length >= limit) break;
  }
  return items;
}

export type PhotoRating = 'green' | 'yellow' | 'red';

export function getPhotoRatings(entryId: number): Record<string, PhotoRating> {
  const rows = db
    .prepare('SELECT photo, rating FROM photo_ratings WHERE entry_id = ?')
    .all(entryId) as { photo: string; rating: PhotoRating }[];
  return Object.fromEntries(rows.map((r) => [r.photo, r.rating]));
}

// 對外回傳的 entry 一律附上營養師的照片評分（無評分＝空物件）與留言數
export function entryToJsonWithRatings(e: EntryRow) {
  return { ...entryToJson(e), ratings: getPhotoRatings(e.id), commentCount: countComments(`entry:${e.id}`) };
}

// ---- 留言（target：entry:<id> / water:<date> / ex:<date>，owner 為紀錄擁有者）----

export interface CommentJson {
  id: number;
  body: string;
  createdAt: number;
  author: string;
  role: string;
  mine: boolean;
  ai: boolean; // true＝AI 產生的評語（顯示 AI 標籤、不可編輯）
  aiModel: string; // AI 評語實際使用的模型（非 AI 留言為空字串）
  feedback: number; // 擁有者對這則 AI 評語的評價（1／-1／0；非 AI 留言為 0）
}

// AI 評語在留言串內的顯示名稱
export const AI_AUTHOR_NAME = 'AI 助手';

// entry:<id> 全域唯一；water:/ex: 需連 owner 一起查
export function countComments(target: string, ownerId?: number): number {
  const row = target.startsWith('entry:')
    ? db.prepare('SELECT COUNT(*) AS c FROM entry_comments WHERE target = ?').get(target)
    : db.prepare('SELECT COUNT(*) AS c FROM entry_comments WHERE target = ? AND user_id = ?').get(target, ownerId ?? -1);
  return (row as { c: number }).c;
}

export function listComments(ownerId: number, target: string, viewerId: number): CommentJson[] {
  // 作者顯示名稱：檢視者（營養師）替作者取的私人暱稱＞作者自訂暱稱＞帳號
  const rows = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.author_id, c.is_ai, c.ai_model, u.role,
              COALESCE(NULLIF(a.alias, ''), NULLIF(u.nickname, ''), u.username) AS display_name
       FROM entry_comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN member_aliases a ON a.member_id = c.author_id AND a.dietitian_id = ?
       WHERE c.user_id = ? AND c.target = ? ORDER BY c.id`
    )
    .all(viewerId, ownerId, target) as { id: number; body: string; created_at: number; author_id: number; is_ai: number; ai_model: string; display_name: string; role: string }[];
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.created_at,
    author: r.is_ai ? AI_AUTHOR_NAME : r.display_name,
    role: r.role,
    // AI 評語不屬於任何人（不顯示編輯／刪除選單）
    mine: !r.is_ai && r.author_id === viewerId,
    ai: !!r.is_ai,
    aiModel: r.is_ai ? r.ai_model || '' : '',
    // 評價一律以紀錄擁有者的投票為準（本人在自己頁面投；營養師檢視時看得到但不投）
    feedback: r.is_ai ? getAiFeedback(ownerId, 'comment', String(r.id)) : 0,
  }));
}

export function createComment(ownerId: number, target: string, authorId: number, body: string, isAi = false, aiModel = '') {
  db.prepare(
    'INSERT INTO entry_comments (user_id, target, author_id, body, created_at, is_ai, ai_model) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(ownerId, target, authorId, body, Date.now(), isAi ? 1 : 0, aiModel);
}

// ---- 通知（營養師留言／照片評分／調整份數時通知會員）----

export type NotificationType = 'comment' | 'rating' | 'food' | 'post';

// 取得通知對象貼文所屬日期：entry 查資料表；water/ex 直接取 target 內的日期
export function notificationDate(target: string): string {
  if (target.startsWith('entry:')) {
    const row = db.prepare('SELECT date FROM entries WHERE id = ?').get(Number(target.slice(6))) as { date: string } | undefined;
    return row?.date ?? '';
  }
  return target.slice(target.indexOf(':') + 1);
}

// 同一貼文的同類型未讀通知只保留一則（例如一筆紀錄多張照片評分只算一則），重複事件僅更新時間
// memberId：接收者為營養師時，標記通知來自哪位會員的貼文（0＝自己的紀錄）
export function pushNotification(userId: number, type: NotificationType, target: string, memberId = 0) {
  const date = notificationDate(target);
  if (!date) return;
  const existing = db
    .prepare('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND target = ? AND member_id = ? AND read = 0')
    .get(userId, type, target, memberId) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE notifications SET created_at = ?, date = ? WHERE id = ?').run(Date.now(), date, existing.id);
  } else {
    db.prepare('INSERT INTO notifications (user_id, type, target, date, member_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId,
      type,
      target,
      date,
      memberId,
      Date.now()
    );
  }
}

// 追蹤的會員發布新貼文（飲食／喝水／運動）時，通知所有追蹤者（營養師）
export function notifyFollowers(memberId: number, target: string) {
  const followers = db
    .prepare('SELECT dietitian_id AS id FROM follows WHERE member_id = ?')
    .all(memberId) as { id: number }[];
  for (const f of followers) pushNotification(f.id, 'post', target, memberId);
}

// 會員在自己的貼文留言時，通知所有曾在該貼文留言的營養師／管理者（排除留言者本人）
export function notifyCommentWatchers(ownerId: number, target: string, authorId: number) {
  const watchers = db
    .prepare(
      `SELECT DISTINCT c.author_id AS id FROM entry_comments c JOIN users u ON u.id = c.author_id
       WHERE c.user_id = ? AND c.target = ? AND c.author_id != ? AND u.role IN ('dietitian','admin')`
    )
    .all(ownerId, target, authorId) as { id: number }[];
  for (const w of watchers) pushNotification(w.id, 'comment', target, ownerId);
}

// 確認留言對象屬於該會員：entry 需為其所有；water/ex 為其當日紀錄（日期格式已由 schema 驗證）
export function commentTargetOwned(ownerId: number, target: string): boolean {
  if (target.startsWith('entry:')) {
    const id = Number(target.slice(6));
    return !!db.prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?').get(id, ownerId);
  }
  return true;
}

export function deletePhotoRatings(entryId: number, photos?: string[]) {
  if (photos === undefined) {
    db.prepare('DELETE FROM photo_ratings WHERE entry_id = ?').run(entryId);
    return;
  }
  const del = db.prepare('DELETE FROM photo_ratings WHERE entry_id = ? AND photo = ?');
  for (const p of photos) del.run(entryId, p);
}

// ---- AI 評價（使用者對某則 AI 產出按讚/倒讚）----

export type AiFeedbackKind = 'comment' | 'daily';

// 取得使用者對某則 AI 產出的評價（1＝讚、-1＝倒讚、0＝未評價）
export function getAiFeedback(userId: number, kind: AiFeedbackKind, ref: string): number {
  const row = db
    .prepare('SELECT vote FROM ai_feedback WHERE user_id = ? AND kind = ? AND ref = ?')
    .get(userId, kind, ref) as { vote: number } | undefined;
  return row?.vote ?? 0;
}

// 設定評價：vote 為 0 時清除（等同再按一次同一鍵取消）。
// body＝被評價當下的 AI 內容快照（供日後當偏好範例；清除時不需要）。
export function setAiFeedback(userId: number, kind: AiFeedbackKind, ref: string, vote: number, body = '') {
  if (vote === 0) {
    db.prepare('DELETE FROM ai_feedback WHERE user_id = ? AND kind = ? AND ref = ?').run(userId, kind, ref);
    return;
  }
  db.prepare(
    `INSERT INTO ai_feedback (user_id, kind, ref, vote, body, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, kind, ref) DO UPDATE SET vote = excluded.vote, body = excluded.body, created_at = excluded.created_at`
  ).run(userId, kind, ref, vote, body, Date.now());
}

// 取得某則 AI 產出「目前」的內容（供投票時擷取快照）：comment 查留言、daily 查當日總評
export function currentAiBody(userId: number, kind: AiFeedbackKind, ref: string): string {
  if (kind === 'comment') {
    const row = db
      .prepare('SELECT body FROM entry_comments WHERE id = ? AND user_id = ? AND is_ai = 1')
      .get(ref, userId) as { body: string } | undefined;
    return row?.body ?? '';
  }
  const row = db
    .prepare('SELECT body FROM daily_summaries WHERE user_id = ? AND date = ?')
    .get(userId, ref) as { body: string } | undefined;
  return row?.body ?? '';
}

export interface PrefBucket { liked: string[]; disliked: string[] }

function bucketVotes(rows: { vote: number; body: string }[], perSide: number): PrefBucket {
  const liked: string[] = [];
  const disliked: string[] = [];
  for (const r of rows) {
    const bucket = r.vote === 1 ? liked : disliked;
    if (bucket.length < perSide) bucket.push(r.body);
  }
  return { liked, disliked };
}

// 偏好範例（混合）：這位使用者「自己」的讚/倒讚（優先）＋「其他所有使用者」的讚/倒讚（次要基準）。
// 讓評價既能個人化，也能靠全體回饋把整體品質帶起來。混用兩種 kind（評語與今日總評）。
export function getFeedbackExamples(userId: number): { personal: PrefBucket; global: PrefBucket } {
  const own = db
    .prepare("SELECT vote, body FROM ai_feedback WHERE user_id = ? AND body != '' ORDER BY created_at DESC")
    .all(userId) as { vote: number; body: string }[];
  const others = db
    .prepare("SELECT vote, body FROM ai_feedback WHERE user_id != ? AND body != '' ORDER BY created_at DESC LIMIT 200")
    .all(userId) as { vote: number; body: string }[];
  return { personal: bucketVotes(own, 3), global: bucketVotes(others, 2) };
}

// ---- AI 今日總評（每人每天一筆，重新產生覆蓋）----

export interface DailySummaryJson {
  body: string;
  model: string;
  createdAt: number;
  feedback: number; // 擁有者對這份總評的評價（1／-1／0）
}

export function getDailySummary(userId: number, date: string): DailySummaryJson | null {
  const row = db
    .prepare('SELECT body, model, created_at FROM daily_summaries WHERE user_id = ? AND date = ?')
    .get(userId, date) as { body: string; model: string; created_at: number } | undefined;
  return row
    ? { body: row.body, model: row.model, createdAt: row.created_at, feedback: getAiFeedback(userId, 'daily', date) }
    : null;
}

export function upsertDailySummary(userId: number, date: string, body: string, model: string) {
  db.prepare(
    `INSERT INTO daily_summaries (user_id, date, body, model, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET body = excluded.body, model = excluded.model, created_at = excluded.created_at`
  ).run(userId, date, body, model, Date.now());
}

export function getDayJson(userId: number, date: string) {
  const row = db
    .prepare('SELECT * FROM days WHERE user_id = ? AND date = ?')
    .get(userId, date) as DayRow | undefined;
  const entries = (
    db
      .prepare('SELECT id, meal, desc, photos, eat_time, food, photo_foods, food_edited_at FROM entries WHERE user_id = ? AND date = ? ORDER BY id')
      .all(userId, date) as EntryRow[]
  ).map(entryToJsonWithRatings);
  return {
    commentCounts: {
      water: countComments(`water:${date}`, userId),
      ex: countComments(`ex:${date}`, userId),
    },
    water: row?.water ?? 0,
    waterTime: row?.water_time ?? '',
    ex: { min: row?.ex_min ?? '', desc: row?.ex_desc ?? '' },
    exTime: row?.ex_time ?? '',
    body: {
      weight: row?.body_weight ?? '',
      fat: row?.body_fat ?? '',
      waist: row?.body_waist ?? '',
      muscle: row?.body_muscle ?? '',
      fatkg: row?.body_fatkg ?? '',
    },
    bodyTime: row?.body_time ?? '',
    entries,
    aiSummary: getDailySummary(userId, date),
  };
}

export function entryHasData(e: { desc: string; photos: string[]; food: Food }) {
  return !!(e.desc || e.photos.length || Object.values(e.food).some((v) => v > 0));
}

export function ensureDayRow(userId: number, date: string) {
  db.prepare('INSERT OR IGNORE INTO days (user_id, date) VALUES (?, ?)').run(userId, date);
}

// 有紀錄的日期集合（週曆／月曆亮燈），供本人與營養師檢視共用
export function getMarkedDates(userId: number, from: string, to: string): string[] {
  const dates = new Set<string>();
  const dayRows = db
    .prepare('SELECT * FROM days WHERE user_id = ? AND date >= ? AND date <= ?')
    .all(userId, from, to) as (DayRow & { date: string })[];
  for (const r of dayRows) {
    const hasBody = [r.body_weight, r.body_fat, r.body_waist, r.body_muscle, r.body_fatkg].some((v) => v !== '');
    const hasEx = (r.ex_min && +r.ex_min > 0) || !!r.ex_desc;
    if (r.water > 0 || hasEx || hasBody) dates.add(r.date);
  }
  const entryRows = db
    .prepare('SELECT date, desc, photos, food FROM entries WHERE user_id = ? AND date >= ? AND date <= ?')
    .all(userId, from, to) as (EntryRow & { date: string })[];
  for (const r of entryRows) {
    if (!dates.has(r.date) && entryHasData(entryToJson(r))) dates.add(r.date);
  }
  return [...dates].sort();
}

// 刪除會員時清掉其所有資料與照片檔
export function deleteUserData(userId: number) {
  const photoRows = db.prepare('SELECT photos FROM entries WHERE user_id = ?').all(userId) as { photos: string }[];
  for (const r of photoRows) parsePhotos(r.photos).forEach(unlinkPhoto);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM photo_ratings WHERE entry_id IN (SELECT id FROM entries WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM member_aliases WHERE member_id = ? OR dietitian_id = ?').run(userId, userId);
    db.prepare('DELETE FROM follows WHERE member_id = ? OR dietitian_id = ?').run(userId, userId);
    db.prepare('DELETE FROM entry_comments WHERE user_id = ? OR author_id = ?').run(userId, userId);
    db.prepare('DELETE FROM entries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM days WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM goal_periods WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { COMMENT_TARGET_RE, DATE_RE, aliasSchema, commentCreateSchema, commentEditSchema, followSchema, foodSchema, goalsSchema, photoFoodsSchema, photoRatingSchema } from '../validation.js';
import { commentTargetOwned, createComment, entryToJsonWithRatings, getDayJson, getMarkedDates, getPhotoRatings, listComments, parsePhotos, pushNotification, sumFoods, type EntryRow } from '../helpers.js';
import { createGoal, getGoal, goalToJson, listGoals, updateGoal } from './goals.js';

// 營養師（管理者亦可）檢視會員每日紀錄、替會員設定目標
export const proRouter = Router();
proRouter.use(requireAuth, requireRole('dietitian', 'admin'));

function getMember(id: string | number) {
  return db
    .prepare(`SELECT id, username FROM users WHERE id = ? AND role IN ('member','citizen') AND status = 'active'`)
    .get(id) as { id: number; username: string } | undefined;
}

// 會員清單：附上會員自訂暱稱、「這位營養師」替會員取的私人暱稱與追蹤狀態（皆僅本人可見）
proRouter.get('/members', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.nickname, a.alias,
              CASE WHEN f.member_id IS NULL THEN 0 ELSE 1 END AS followed
       FROM users u
       LEFT JOIN member_aliases a ON a.member_id = u.id AND a.dietitian_id = ?
       LEFT JOIN follows f ON f.member_id = u.id AND f.dietitian_id = ?
       WHERE u.role IN ('member','citizen') AND u.status = 'active' ORDER BY u.username`
    )
    .all(req.userId, req.userId) as { id: number; username: string; nickname: string; alias: string | null; followed: number }[];
  return res.json(rows.map((r) => ({ ...r, followed: !!r.followed })));
});

// 追蹤／取消追蹤會員：追蹤中的會員發布新貼文時會收到通知
proRouter.put('/members/:id/follow', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const parsed = followSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  if (parsed.data.follow) {
    db.prepare('INSERT OR IGNORE INTO follows (dietitian_id, member_id) VALUES (?, ?)').run(req.userId, member.id);
  } else {
    db.prepare('DELETE FROM follows WHERE dietitian_id = ? AND member_id = ?').run(req.userId, member.id);
  }
  return res.json({ ok: true, followed: parsed.data.follow });
});

// 營養師替會員取私人暱稱（僅該營養師自己看得到；alias 空字串＝清除）
proRouter.put('/members/:id/alias', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const parsed = aliasSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '暱稱最多 20 字' });
  const alias = parsed.data.alias;
  if (alias === '') {
    db.prepare('DELETE FROM member_aliases WHERE dietitian_id = ? AND member_id = ?').run(req.userId, member.id);
  } else {
    db.prepare(
      `INSERT INTO member_aliases (dietitian_id, member_id, alias) VALUES (?, ?, ?)
       ON CONFLICT(dietitian_id, member_id) DO UPDATE SET alias = excluded.alias`
    ).run(req.userId, member.id, alias);
  }
  return res.json({ ok: true, alias });
});

proRouter.get('/members/:id/days/:date', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  return res.json(getDayJson(member.id, date));
});

proRouter.get('/members/:id/marks', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'invalid range' });
  }
  const dayMs = new Date(to).getTime() - new Date(from).getTime();
  if (dayMs < 0 || dayMs > 62 * 86400000) return res.status(400).json({ error: 'range too large' });
  return res.json({ dates: getMarkedDates(member.id, from, to) });
});

// 替會員的單張照片評分（綠燈／黃燈／紅燈；rating: null 清除評分）
proRouter.put('/members/:id/entries/:eid/photo-rating', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const entry = db
    .prepare('SELECT id, photos FROM entries WHERE id = ? AND user_id = ?')
    .get(req.params.eid, member.id) as { id: number; photos: string } | undefined;
  if (!entry) return res.status(404).json({ error: 'not found' });
  const parsed = photoRatingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { photo, rating } = parsed.data;
  if (!parsePhotos(entry.photos).includes(photo)) {
    return res.status(404).json({ error: 'photo not found' });
  }
  if (rating === null) {
    db.prepare('DELETE FROM photo_ratings WHERE entry_id = ? AND photo = ?').run(entry.id, photo);
  } else {
    db.prepare(
      `INSERT INTO photo_ratings (entry_id, photo, rating, rated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(entry_id, photo) DO UPDATE SET rating = excluded.rating, rated_by = excluded.rated_by, rated_at = datetime('now')`
    ).run(entry.id, photo, rating, req.userId);
    // 同一筆紀錄不論評幾張照片，只產生一則未讀通知
    pushNotification(member.id, 'rating', `entry:${entry.id}`);
  }
  return res.json({ ratings: getPhotoRatings(entry.id) });
});

// 營養師調整會員某筆紀錄的六大類份數（會標記「營養師調整」，會員自行再改則移除標記）
// 有照片的紀錄以 photoFoods 逐張調整（food 欄位存總和）；無照片以 food 調整
proRouter.put('/members/:id/entries/:eid/food', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const entry = db
    .prepare('SELECT id, photos FROM entries WHERE id = ? AND user_id = ?')
    .get(req.params.eid, member.id) as { id: number; photos: string } | undefined;
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (req.body?.photoFoods !== undefined) {
    const parsed = photoFoodsSchema.safeParse(req.body.photoFoods);
    if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
    const existing = parsePhotos(entry.photos);
    const filtered = Object.fromEntries(Object.entries(parsed.data).filter(([url]) => existing.includes(url)));
    db.prepare('UPDATE entries SET photo_foods = ?, food = ?, food_edited_at = ? WHERE id = ?').run(
      JSON.stringify(filtered),
      JSON.stringify(sumFoods(Object.values(filtered))),
      Date.now(),
      entry.id
    );
  } else {
    const parsed = foodSchema.safeParse(req.body?.food);
    if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
    db.prepare('UPDATE entries SET food = ?, food_edited_at = ? WHERE id = ?').run(
      JSON.stringify(parsed.data),
      Date.now(),
      entry.id
    );
  }
  pushNotification(member.id, 'food', `entry:${entry.id}`);
  const row = db
    .prepare('SELECT id, meal, desc, photos, eat_time, food, photo_foods, food_edited_at FROM entries WHERE id = ?')
    .get(entry.id) as EntryRow;
  return res.json(entryToJsonWithRatings(row));
});

// 營養師對會員紀錄（飲食／喝水／運動）的留言
proRouter.get('/members/:id/comments', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const target = String(req.query.target || '');
  if (!COMMENT_TARGET_RE.test(target) || !commentTargetOwned(member.id, target)) {
    return res.status(400).json({ error: 'invalid target' });
  }
  return res.json(listComments(member.id, target, req.userId));
});

proRouter.post('/members/:id/comments', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const parsed = commentCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入留言內容（最多 1000 字）' });
  const { target, body } = parsed.data;
  if (!commentTargetOwned(member.id, target)) return res.status(400).json({ error: 'invalid target' });
  createComment(member.id, target, req.userId, body);
  pushNotification(member.id, 'comment', target);
  return res.status(201).json(listComments(member.id, target, req.userId));
});

// 營養師只能編輯自己寫的留言
proRouter.patch('/members/:id/comments/:cid', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const parsed = commentEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入留言內容（最多 1000 字）' });
  const row = db
    .prepare('SELECT target FROM entry_comments WHERE id = ? AND author_id = ? AND user_id = ?')
    .get(req.params.cid, req.userId, member.id) as { target: string } | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE entry_comments SET body = ? WHERE id = ? AND author_id = ? AND user_id = ?').run(
    parsed.data.body,
    req.params.cid,
    req.userId,
    member.id
  );
  return res.json(listComments(member.id, row.target, req.userId));
});

// 營養師只能刪自己寫的留言
proRouter.delete('/members/:id/comments/:cid', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const info = db
    .prepare('DELETE FROM entry_comments WHERE id = ? AND author_id = ? AND user_id = ?')
    .run(req.params.cid, req.userId, member.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  return res.status(204).end();
});

proRouter.get('/members/:id/goals', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  return res.json(listGoals(member.id));
});

proRouter.post('/members/:id/goals', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  return res.status(201).json(createGoal(member.id, parsed.data, 'dietitian'));
});

// 營養師編輯會員的任一目標；編輯後即視為營養師設定
proRouter.put('/members/:id/goals/:gid', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const goal = getGoal(member.id, req.params.gid);
  if (!goal) return res.status(404).json({ error: 'not found' });
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  updateGoal(goal.id, parsed.data, 'dietitian');
  return res.json(goalToJson(getGoal(member.id, goal.id)!));
});

proRouter.delete('/members/:id/goals/:gid', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const goal = getGoal(member.id, req.params.gid);
  if (!goal) return res.status(404).json({ error: 'not found' });
  db.prepare('DELETE FROM goal_periods WHERE id = ?').run(goal.id);
  return res.status(204).end();
});

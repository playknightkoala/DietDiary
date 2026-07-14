import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { COMMENT_TARGET_RE, DATE_RE, commentCreateSchema, foodSchema, goalsSchema, photoRatingSchema } from '../validation.js';
import { commentTargetOwned, createComment, entryToJsonWithRatings, getDayJson, getMarkedDates, getPhotoRatings, listComments, parsePhotos, pushNotification, type EntryRow } from '../helpers.js';
import { createGoal, getGoal, goalToJson, listGoals, updateGoal } from './goals.js';

// 營養師（管理者亦可）檢視會員每日紀錄、替會員設定目標
export const proRouter = Router();
proRouter.use(requireAuth, requireRole('dietitian', 'admin'));

function getMember(id: string | number) {
  return db
    .prepare(`SELECT id, username FROM users WHERE id = ? AND role IN ('member','citizen') AND status = 'active'`)
    .get(id) as { id: number; username: string } | undefined;
}

proRouter.get('/members', (_req, res) => {
  const rows = db
    .prepare(`SELECT id, username FROM users WHERE role IN ('member','citizen') AND status = 'active' ORDER BY username`)
    .all() as { id: number; username: string }[];
  return res.json(rows);
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
proRouter.put('/members/:id/entries/:eid/food', (req, res) => {
  const member = getMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'not found' });
  const entry = db
    .prepare('SELECT id FROM entries WHERE id = ? AND user_id = ?')
    .get(req.params.eid, member.id) as { id: number } | undefined;
  if (!entry) return res.status(404).json({ error: 'not found' });
  const parsed = foodSchema.safeParse(req.body?.food);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  db.prepare('UPDATE entries SET food = ?, food_edited_at = ? WHERE id = ?').run(
    JSON.stringify(parsed.data),
    Date.now(),
    entry.id
  );
  pushNotification(member.id, 'food', `entry:${entry.id}`);
  const row = db
    .prepare('SELECT id, meal, desc, photos, eat_time, food, food_edited_at FROM entries WHERE id = ?')
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

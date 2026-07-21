import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { DATE_RE, dayPatchSchema, entryCreateSchema, exLogCreateSchema, waterLogCreateSchema } from '../validation.js';
import { getDayJson, ensureDayRow, getMarkedDates, entryToJsonWithRatings, notifyFollowers, recomputeDayEx, recomputeDayWater, deleteExLog, deleteWaterLog, type EntryRow, type WaterLogRow } from '../helpers.js';

export const daysRouter = Router();
daysRouter.use(requireAuth);

// Dates in [from, to] that have any data (dot markers for week strip / calendar)
daysRouter.get('/marks', (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'invalid range' });
  }
  const dayMs = new Date(to).getTime() - new Date(from).getTime();
  if (dayMs < 0 || dayMs > 62 * 86400000) return res.status(400).json({ error: 'range too large' });

  return res.json({ dates: getMarkedDates(req.userId, from, to) });
});

daysRouter.get('/:date', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  return res.json(getDayJson(req.userId, date));
});

daysRouter.patch('/:date', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const parsed = dayPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { body, bodyTime } = parsed.data;

  ensureDayRow(req.userId, date);
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (body) {
    sets.push('body_weight = ?', 'body_fat = ?', 'body_waist = ?', 'body_muscle = ?', 'body_fatkg = ?');
    args.push(body.weight, body.fat, body.waist, body.muscle, body.fatkg);
  }
  if (bodyTime !== undefined) { sets.push('body_time = ?'); args.push(bodyTime); }
  if (sets.length) {
    db.prepare(`UPDATE days SET ${sets.join(', ')} WHERE user_id = ? AND date = ?`)
      .run(...args, req.userId, date);
  }
  return res.json(getDayJson(req.userId, date));
});

// 新增一筆運動紀錄（一筆＝動態牆一則貼文）
daysRouter.post('/:date/ex', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const parsed = exLogCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const info = db
    .prepare('INSERT INTO ex_logs (user_id, date, min, desc, time) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, date, parsed.data.min.trim(), parsed.data.desc.trim(), parsed.data.time ?? '');
  recomputeDayEx(req.userId, date);
  notifyFollowers(req.userId, `ex:${Number(info.lastInsertRowid)}`);
  return res.status(201).json(getDayJson(req.userId, date));
});

// 新增一筆喝水紀錄（一筆＝動態牆一則貼文）
daysRouter.post('/:date/water', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const parsed = waterLogCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const info = db
    .prepare('INSERT INTO water_logs (user_id, date, ml, time) VALUES (?, ?, ?, ?)')
    .run(req.userId, date, parsed.data.ml, parsed.data.time ?? '');
  recomputeDayWater(req.userId, date);
  notifyFollowers(req.userId, `water:${Number(info.lastInsertRowid)}`);
  return res.status(201).json(getDayJson(req.userId, date));
});

// 刪除單筆喝水紀錄（連同其留言與通知）
daysRouter.delete('/:date/water/:id', (req, res) => {
  const date = req.params.date;
  const id = Number(req.params.id);
  if (!DATE_RE.test(date) || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid params' });
  if (!deleteWaterLog(req.userId, date, id)) return res.status(404).json({ error: 'not found' });
  return res.json(getDayJson(req.userId, date));
});

// 刪除單筆運動紀錄（連同其留言與通知）
daysRouter.delete('/:date/ex/:id', (req, res) => {
  const date = req.params.date;
  const id = Number(req.params.id);
  if (!DATE_RE.test(date) || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid params' });
  if (!deleteExLog(req.userId, date, id)) return res.status(404).json({ error: 'not found' });
  return res.json(getDayJson(req.userId, date));
});

// 歸零重記：刪掉當天所有喝水紀錄
daysRouter.delete('/:date/water', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const logs = db
    .prepare('SELECT id, ml, time FROM water_logs WHERE user_id = ? AND date = ?')
    .all(req.userId, date) as WaterLogRow[];
  for (const w of logs) deleteWaterLog(req.userId, date, w.id);
  return res.json(getDayJson(req.userId, date));
});

daysRouter.post('/:date/entries', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const parsed = entryCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const info = db
    .prepare("INSERT INTO entries (user_id, date, meal, eat_time, food) VALUES (?, ?, ?, ?, '{}')")
    .run(req.userId, date, parsed.data.meal, parsed.data.eatTime ?? '');
  const row = db
    .prepare('SELECT id, meal, desc, photos, eat_time, food, photo_foods, food_edited_at FROM entries WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as EntryRow;
  return res.status(201).json(entryToJsonWithRatings(row, req.userId));
});

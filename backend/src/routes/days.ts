import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { DATE_RE, dayPatchSchema, entryCreateSchema } from '../validation.js';
import { getDayJson, ensureDayRow, getMarkedDates, entryToJsonWithRatings, notifyFollowers, type EntryRow } from '../helpers.js';

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
  const { water, waterTime, ex, exTime, body, bodyTime } = parsed.data;

  ensureDayRow(req.userId, date);
  const prev = db
    .prepare('SELECT water, ex_min, ex_desc FROM days WHERE user_id = ? AND date = ?')
    .get(req.userId, date) as { water: number; ex_min: string; ex_desc: string };
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (water !== undefined) { sets.push('water = ?'); args.push(water); }
  if (waterTime !== undefined) { sets.push('water_time = ?'); args.push(waterTime); }
  if (ex) { sets.push('ex_min = ?', 'ex_desc = ?'); args.push(ex.min, ex.desc); }
  if (exTime !== undefined) { sets.push('ex_time = ?'); args.push(exTime); }
  if (body) {
    sets.push('body_weight = ?', 'body_fat = ?', 'body_waist = ?', 'body_muscle = ?', 'body_fatkg = ?');
    args.push(body.weight, body.fat, body.waist, body.muscle, body.fatkg);
  }
  if (bodyTime !== undefined) { sets.push('body_time = ?'); args.push(bodyTime); }
  if (sets.length) {
    db.prepare(`UPDATE days SET ${sets.join(', ')} WHERE user_id = ? AND date = ?`)
      .run(...args, req.userId, date);
  }
  // 新貼文通知追蹤者：喝水量增加、或運動從無到有／內容變更（歸零與清空不通知）
  if (water !== undefined && water > prev.water) {
    notifyFollowers(req.userId, `water:${date}`);
  }
  if (ex && ((ex.min && +ex.min > 0) || ex.desc) && (ex.min !== prev.ex_min || ex.desc !== prev.ex_desc)) {
    notifyFollowers(req.userId, `ex:${date}`);
  }
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
    .prepare('SELECT id, meal, desc, photos, eat_time, food, food_edited_at FROM entries WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as EntryRow;
  return res.status(201).json(entryToJsonWithRatings(row));
});

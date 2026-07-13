import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { DATE_RE, dayPatchSchema, entryCreateSchema } from '../validation.js';
import { getDayJson, ensureDayRow, getMarkedDates, entryToJson, type EntryRow } from '../helpers.js';

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
  const { water, ex, body } = parsed.data;

  ensureDayRow(req.userId, date);
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (water !== undefined) { sets.push('water = ?'); args.push(water); }
  if (ex) { sets.push('ex_min = ?', 'ex_desc = ?'); args.push(ex.min, ex.desc); }
  if (body) {
    sets.push('body_weight = ?', 'body_fat = ?', 'body_waist = ?', 'body_muscle = ?', 'body_fatkg = ?');
    args.push(body.weight, body.fat, body.waist, body.muscle, body.fatkg);
  }
  if (sets.length) {
    db.prepare(`UPDATE days SET ${sets.join(', ')} WHERE user_id = ? AND date = ?`)
      .run(...args, req.userId, date);
  }
  return res.json(getDayJson(req.userId, date));
});

daysRouter.post('/:date/entries', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const parsed = entryCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const info = db
    .prepare("INSERT INTO entries (user_id, date, meal, food) VALUES (?, ?, ?, '{}')")
    .run(req.userId, date, parsed.data.meal);
  const row = db
    .prepare('SELECT id, meal, desc, photos, food FROM entries WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as EntryRow;
  return res.status(201).json(entryToJson(row));
});

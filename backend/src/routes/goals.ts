import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { goalsSchema } from '../validation.js';

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

interface GoalsRow {
  start: string;
  end: string;
  vals: string;
  water: number;
}

function getGoals(userId: number) {
  const row = db
    .prepare('SELECT start, end, vals, water FROM goals WHERE user_id = ?')
    .get(userId) as GoalsRow | undefined;
  if (!row) return null;
  return { start: row.start, end: row.end, vals: JSON.parse(row.vals), water: row.water };
}

goalsRouter.get('/', (req, res) => {
  return res.json(getGoals(req.userId));
});

goalsRouter.put('/', (req, res) => {
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { start, end, vals, water } = parsed.data;
  db.prepare(
    'INSERT OR REPLACE INTO goals (user_id, start, end, vals, water) VALUES (?, ?, ?, ?, ?)'
  ).run(req.userId, start, end, JSON.stringify(vals), water);
  return res.json(getGoals(req.userId));
});

goalsRouter.delete('/', (req, res) => {
  db.prepare('DELETE FROM goals WHERE user_id = ?').run(req.userId);
  return res.status(204).end();
});

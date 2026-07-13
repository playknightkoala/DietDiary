import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { goalsSchema } from '../validation.js';

export interface GoalRow {
  id: number;
  start: string;
  end: string;
  vals: string;
  water: number;
  set_by: 'self' | 'dietitian';
}

export function goalToJson(row: GoalRow) {
  return {
    id: row.id,
    start: row.start,
    end: row.end,
    vals: JSON.parse(row.vals),
    water: row.water,
    setBy: row.set_by,
  };
}

export function listGoals(userId: number) {
  const rows = db
    .prepare('SELECT id, start, end, vals, water, set_by FROM goal_periods WHERE user_id = ? ORDER BY start DESC, id DESC')
    .all(userId) as GoalRow[];
  return rows.map(goalToJson);
}

export function getGoal(userId: number, id: string | number) {
  return db
    .prepare('SELECT id, start, end, vals, water, set_by FROM goal_periods WHERE id = ? AND user_id = ?')
    .get(id, userId) as GoalRow | undefined;
}

export function createGoal(userId: number, data: { start: string; end: string; vals: object; water: number }, setBy: 'self' | 'dietitian') {
  const info = db
    .prepare('INSERT INTO goal_periods (user_id, start, end, vals, water, set_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, data.start, data.end, JSON.stringify(data.vals), data.water, setBy);
  return goalToJson(getGoal(userId, Number(info.lastInsertRowid))!);
}

export function updateGoal(goalId: number, data: { start: string; end: string; vals: object; water: number }, setBy: 'self' | 'dietitian') {
  db.prepare('UPDATE goal_periods SET start = ?, end = ?, vals = ?, water = ?, set_by = ? WHERE id = ?')
    .run(data.start, data.end, JSON.stringify(data.vals), data.water, setBy, goalId);
}

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

goalsRouter.get('/', (req, res) => {
  return res.json(listGoals(req.userId));
});

goalsRouter.post('/', (req, res) => {
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  return res.status(201).json(createGoal(req.userId, parsed.data, 'self'));
});

goalsRouter.put('/:id', (req, res) => {
  const goal = getGoal(req.userId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'not found' });
  if (goal.set_by === 'dietitian') {
    return res.status(403).json({ error: '此目標由營養師設定，無法自行修改' });
  }
  const parsed = goalsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  updateGoal(goal.id, parsed.data, 'self');
  return res.json(goalToJson(getGoal(req.userId, goal.id)!));
});

goalsRouter.delete('/:id', (req, res) => {
  const goal = getGoal(req.userId, req.params.id);
  if (!goal) return res.status(404).json({ error: 'not found' });
  if (goal.set_by === 'dietitian') {
    return res.status(403).json({ error: '此目標由營養師設定，無法自行刪除' });
  }
  db.prepare('DELETE FROM goal_periods WHERE id = ?').run(goal.id);
  return res.status(204).end();
});

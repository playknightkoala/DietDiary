import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { DATE_RE, goalsSchema } from '../validation.js';
import { getDayJson, getMarkedDates } from '../helpers.js';
import { createGoal, getGoal, goalToJson, listGoals, updateGoal } from './goals.js';

// 營養師（管理者亦可）檢視會員每日紀錄、替會員設定目標
export const proRouter = Router();
proRouter.use(requireAuth, requireRole('dietitian', 'admin'));

function getMember(id: string | number) {
  return db
    .prepare(`SELECT id, username FROM users WHERE id = ? AND role = 'member' AND status = 'active'`)
    .get(id) as { id: number; username: string } | undefined;
}

proRouter.get('/members', (_req, res) => {
  const rows = db
    .prepare(`SELECT id, username FROM users WHERE role = 'member' AND status = 'active' ORDER BY username`)
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

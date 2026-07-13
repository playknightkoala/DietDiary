import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BODY_FIELDS } from '../validation.js';

export const trendRouter = Router();
trendRouter.use(requireAuth);

trendRouter.get('/', (req, res) => {
  const field = String(req.query.field || 'weight');
  if (!(BODY_FIELDS as readonly string[]).includes(field)) {
    return res.status(400).json({ error: 'invalid field' });
  }
  const limit = Math.min(365, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
  const col = `body_${field}`;
  const rows = db
    .prepare(
      `SELECT date, ${col} AS value FROM days WHERE user_id = ? AND ${col} != '' ORDER BY date DESC LIMIT ?`
    )
    .all(req.userId, limit) as { date: string; value: string }[];
  const points = rows
    .reverse()
    .map((r) => ({ date: r.date, value: parseFloat(r.value) }))
    .filter((p) => !isNaN(p.value));
  return res.json({ points });
});

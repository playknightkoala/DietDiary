import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { BODY_FIELDS } from '../validation.js';

export const trendRouter = Router();
trendRouter.use(requireAuth);

interface BodyDayRow {
  date: string;
  body_weight: string;
  body_fat: string;
  body_waist: string;
  body_muscle: string;
  body_fatkg: string;
}

// limit 夾限（1–365，預設 30）：會員端與營養師端共用同一規則
export function clampTrendLimit(raw: unknown): number {
  return Math.min(365, Math.max(1, parseInt(String(raw || '30'), 10) || 30));
}

// 歷程紀錄（InBody 樣式）：一次回傳所有指標、以量測日對齊的資料列（舊→新）。
// 會員端 GET /api/body-trend?field=all 與營養師端 GET /api/pro/members/:id/body-trend 共用
export function bodyTrendRows(userId: number, limit: number) {
  const rows = db
    .prepare(
      `SELECT date, body_weight, body_fat, body_waist, body_muscle, body_fatkg FROM days
       WHERE user_id = ?
         AND (body_weight != '' OR body_fat != '' OR body_waist != '' OR body_muscle != '' OR body_fatkg != '')
       ORDER BY date DESC LIMIT ?`
    )
    .all(userId, limit) as BodyDayRow[];
  const num = (s: string) => {
    const v = parseFloat(s);
    return isNaN(v) ? null : v;
  };
  return rows.reverse().map((r) => ({
    date: r.date,
    weight: num(r.body_weight),
    fat: num(r.body_fat),
    waist: num(r.body_waist),
    muscle: num(r.body_muscle),
    fatkg: num(r.body_fatkg),
  }));
}

trendRouter.get('/', (req, res) => {
  const field = String(req.query.field || 'all');
  const limit = clampTrendLimit(req.query.limit);

  if (field === 'all') {
    return res.json({ rows: bodyTrendRows(req.userId, limit) });
  }

  // 單一指標（保留給尚未強制更新的舊前端）
  if (!(BODY_FIELDS as readonly string[]).includes(field)) {
    return res.status(400).json({ error: 'invalid field' });
  }
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

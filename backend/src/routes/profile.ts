import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { profileSchema, uiLayoutSchema } from '../validation.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

interface ProfileRow {
  profile_height: string;
  profile_birth_year: string;
  profile_gender: string;
  profile_activity: string;
  profile_goal: string;
  profile_goal_kcal: string;
}

// TDEE 基本資料＋計算用的最近一次體重紀錄（BMR/TDEE 公式與活動量係數在前端 domain.ts）
// pro 路由（營養師檢視會員）也共用
export function profileJson(userId: number) {
  const row = db
    .prepare('SELECT profile_height, profile_birth_year, profile_gender, profile_activity, profile_goal, profile_goal_kcal FROM users WHERE id = ?')
    .get(userId) as ProfileRow;
  const w = db
    .prepare(
      `SELECT date, body_weight FROM days WHERE user_id = ? AND body_weight != '' ORDER BY date DESC LIMIT 1`
    )
    .get(userId) as { date: string; body_weight: string } | undefined;
  const value = w ? parseFloat(w.body_weight) : NaN;
  return {
    height: row.profile_height,
    birthYear: row.profile_birth_year,
    gender: row.profile_gender as '' | 'male' | 'female',
    activity: row.profile_activity,
    goal: row.profile_goal as 'normal' | 'cut' | 'gain',
    goalKcal: row.profile_goal_kcal,
    weight: w && !isNaN(value) ? { date: w.date, value } : null,
  };
}

profileRouter.get('/', (req, res) => res.json(profileJson(req.userId)));

profileRouter.put('/', (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { height, birthYear, gender, activity, goal, goalKcal } = parsed.data;
  db.prepare(
    'UPDATE users SET profile_height = ?, profile_birth_year = ?, profile_gender = ?, profile_activity = ?, profile_goal = ?, profile_goal_kcal = ? WHERE id = ?'
  ).run(height, birthYear, gender, activity, goal, goalKcal, req.userId);
  return res.json(profileJson(req.userId));
});

// 介面自定義（主頁卡片順序與顯示）：跟帳號儲存，換裝置登入自動帶入；讀取走 /api/auth/me
profileRouter.put('/layout', (req, res) => {
  const parsed = uiLayoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  db.prepare('UPDATE users SET ui_layout = ? WHERE id = ?').run(JSON.stringify(parsed.data), req.userId);
  return res.json(parsed.data);
});

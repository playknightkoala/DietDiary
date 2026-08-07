// AI 路由共用：requireAI 守門與跨端點共用的小定義。
// 拆自原 routes/ai.ts（見 routes/ai.ts 的組裝順序）。
import type { Request, Response, NextFunction } from 'express';
import { db } from '../../db.js';
import { aiConfigured } from '../../llm.js';

// AI 功能需由管理者逐一開放（users.ai_enabled）
export function requireAI(req: Request, res: Response, next: NextFunction) {
  const row = db.prepare('SELECT status, ai_enabled FROM users WHERE id = ?').get(req.userId) as
    | { status: string; ai_enabled: number }
    | undefined;
  if (!row || row.status !== 'active' || !row.ai_enabled) {
    return res.status(403).json({ error: '尚未開放 AI 功能' });
  }
  if (!aiConfigured()) return res.status(503).json({ error: 'AI 服務尚未設定，請聯絡管理員' });
  next();
}

export const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', night: '宵夜', snack: '點心',
};

export interface EntryFull {
  id: number;
  date: string;
  meal: string;
  desc: string;
  photos: string;
  eat_time: string;
  food: string;
  photo_foods: string;
  photo_customs: string;
  items: string;
}

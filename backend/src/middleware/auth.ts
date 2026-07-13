import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dietdiary-dev-secret-change-me';

export type Role = 'member' | 'dietitian' | 'admin';

declare module 'express-serve-static-core' {
  interface Request {
    userId: number;
    userRole: Role;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { uid: number };
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// 角色以資料庫為準（管理者調整角色後即時生效），需掛在 requireAuth 之後
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const row = db.prepare('SELECT role, status FROM users WHERE id = ?').get(req.userId) as
      | { role: Role; status: string }
      | undefined;
    if (!row || row.status !== 'active' || !roles.includes(row.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    req.userRole = row.role;
    next();
  };
}

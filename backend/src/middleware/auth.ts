import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'dietdiary-dev-secret-change-me';

declare module 'express-serve-static-core' {
  interface Request {
    userId: number;
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

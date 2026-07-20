import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';

// JWT 簽章秘鑰：payload 僅含 uid，秘鑰一旦可預測即可偽造任意帳號（含管理者）的 token。
// 正式環境（NODE_ENV=production）若未設定、仍為已知預設值或長度不足 32，直接拒絕啟動，不再 fallback。
const KNOWN_INSECURE_SECRETS = new Set(['', 'please-change-this-secret', 'dietdiary-dev-secret-change-me']);
const rawSecret = process.env.JWT_SECRET || '';
if (process.env.NODE_ENV === 'production' && (KNOWN_INSECURE_SECRETS.has(rawSecret) || rawSecret.length < 32)) {
  throw new Error(
    'JWT_SECRET 未設定、仍為預設值或長度不足 32 字元；正式環境請以 `openssl rand -hex 32` 產生後填入 .env 再啟動。'
  );
}
export const JWT_SECRET = rawSecret || 'dietdiary-dev-insecure-secret-change-me';

// citizen（駒駒國民）：權限與 member 完全相同，僅名稱不同
export type Role = 'member' | 'citizen' | 'dietitian' | 'admin';

declare module 'express-serve-static-core' {
  interface Request {
    userId: number;
    userRole: Role;
  }
}

// 記錄會員最後使用時間；為避免每個請求都寫入 DB，同一人 60 秒內只寫一次（記憶體節流）
const lastSeenThrottle = new Map<number, number>();
const LAST_SEEN_THROTTLE_MS = 60 * 1000;
function touchLastSeen(uid: number) {
  const now = Date.now();
  const prev = lastSeenThrottle.get(uid) ?? 0;
  if (now - prev < LAST_SEEN_THROTTLE_MS) return;
  lastSeenThrottle.set(uid, now);
  try {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, uid);
  } catch {
    /* 不影響請求流程 */
  }
}

// 帳號狀態快取：避免每個請求都查 DB，但停用（或刪除）後最多 STATUS_TTL_MS 內即讓既有 token 失效。
// 這是撤銷既有 session 的關鍵——JWT 本身無狀態，光驗簽章無法反映帳號已被停用。
const statusCache = new Map<number, { active: boolean; at: number }>();
const STATUS_TTL_MS = 30 * 1000;
function isActiveUser(uid: number): boolean {
  const now = Date.now();
  const cached = statusCache.get(uid);
  if (cached && now - cached.at < STATUS_TTL_MS) return cached.active;
  const row = db.prepare('SELECT status FROM users WHERE id = ?').get(uid) as { status: string } | undefined;
  const active = row?.status === 'active';
  statusCache.set(uid, { active, at: now });
  return active;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { uid: number };
    // 帳號不存在或已被停用（改回 pending／刪除）：既有 token 一律拒絕
    if (!isActiveUser(payload.uid)) return res.status(401).json({ error: 'unauthorized' });
    req.userId = payload.uid;
    touchLastSeen(payload.uid);
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

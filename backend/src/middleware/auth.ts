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

// ---- 照片存取驗證（/uploads）----
// <img> 標籤無法帶 Authorization header，改用 httpOnly cookie（登入與 /api/auth/photo-cookie 時核發，
// 內容就是同一顆 JWT）。SameSite=Lax + Path=/uploads：只送往照片路徑，跨站子資源不會帶（順帶擋盜連）。
export const PHOTO_COOKIE = 'dd_photo';
export const PHOTO_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, path: '/uploads' };

// legacy 檔名 → 擁有者對照表：App 產生的檔名一律是 e{id}-…，legacy 命名的照片只會越來越少、
// 不會新增，所以開機（或每 10 分鐘）整表重建一次，請求期間純 Map 查找——
// 逐請求查詢的做法（即使有 LRU 快取）仍會被「持續換隨機檔名」刷出無上限的全表掃描
const MODERN_PHOTO_RE = /^\/uploads\/e\d+-/;
let legacyOwnerMap: Map<string, number> | null = null;
let legacyOwnerMapAt = 0;
const LEGACY_MAP_TTL_MS = 10 * 60 * 1000;
// 照片自 DB 移除時同步失效（helpers.unlinkPhoto 呼叫，涵蓋刪照片／刪紀錄／刪會員全部路徑）：
// 即使實體 unlink 失敗，DB 已不擁有的照片也不能再憑對照表放行（fail-closed 契約）
export function invalidateLegacyPhotoOwner(url: string) {
  legacyOwnerMap?.delete(url);
}

function legacyPhotoOwner(url: string): number | undefined {
  const now = Date.now();
  if (!legacyOwnerMap || now - legacyOwnerMapAt >= LEGACY_MAP_TTL_MS) {
    const map = new Map<string, number>();
    const rows = db
      .prepare(`SELECT user_id, photo, photos FROM entries WHERE photo != '' OR photos != '[]'`)
      .all() as { user_id: number; photo: string; photos: string }[];
    for (const r of rows) {
      if (r.photo && !MODERN_PHOTO_RE.test(r.photo)) map.set(r.photo, r.user_id);
      try {
        for (const p of JSON.parse(r.photos) as unknown[]) {
          if (typeof p === 'string' && p && !MODERN_PHOTO_RE.test(p)) map.set(p, r.user_id);
        }
      } catch { /* 壞資料跳過 */ }
    }
    legacyOwnerMap = map;
    legacyOwnerMapAt = now;
  }
  return legacyOwnerMap.get(url);
}

// 每張照片都必須驗出擁有者（fail-closed）：本人或營養師／管理者才可看。
// 檔名帶 entryId（e{id}-{ts}-{i}.jpg）直接查該筆；解析不出（legacy 檔名、紀錄已刪）
// 改以 URL 反查 entries 的 photos／legacy photo 欄位；DB 完全查不到（孤兒檔）一律 404，
// 不再以「已登入」代替授權。
export function photoAuth(req: Request, res: Response, next: NextFunction) {
  const m = /(?:^|;\s*)dd_photo=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return res.status(401).end();
  let uid: number;
  try {
    const payload = jwt.verify(decodeURIComponent(m[1]), JWT_SECRET) as { uid: number };
    if (!isActiveUser(payload.uid)) return res.status(401).end();
    uid = payload.uid;
  } catch {
    return res.status(401).end();
  }
  // req.path 未解碼（express.static 會自行解碼實際路徑）：不先解碼的話，
  // 把檔名 percent-encode 就能讓 entryId 解析失敗、繞過擁有者檢查
  let file = req.path.split('/').pop() || '';
  try {
    file = decodeURIComponent(file);
  } catch {
    return res.status(404).end();
  }
  // 找出擁有者：檔名的 entryId 優先（一次索引查詢）。本 App 產生的檔名一律是 e{id}-…，
  // 解析得出 entryId 但紀錄不存在＝已刪除，直接 404，不落入 legacy 反查（避免被拿來刷全表掃描）
  let ownerId: number | undefined;
  const em = /^e(\d+)-/.exec(file);
  if (em) {
    const row = db.prepare('SELECT user_id FROM entries WHERE id = ?').get(Number(em[1])) as
      | { user_id: number }
      | undefined;
    ownerId = row?.user_id;
  } else {
    // 真正的 legacy 檔名才以 URL 反查（photos JSON／legacy photo 欄位）。
    // 這是全表掃描：結果（含查無）進 TTL 快取，擋住以隨機檔名重複觸發掃描的濫用
    ownerId = legacyPhotoOwner(`/uploads/${file}`);
  }
  if (ownerId === undefined) return res.status(404).end(); // 孤兒檔／紀錄已刪：任何人都不給看
  if (ownerId !== uid) {
    const u = db.prepare('SELECT role, status FROM users WHERE id = ?').get(uid) as
      | { role: Role; status: string }
      | undefined;
    if (!u || u.status !== 'active' || (u.role !== 'dietitian' && u.role !== 'admin')) {
      return res.status(403).end();
    }
  }
  next();
}

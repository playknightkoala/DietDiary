import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { adminPatchUserSchema } from '../validation.js';
import { deleteUserData } from '../helpers.js';
import { mailerConfigured, sendAccountApproved } from '../mailer.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

interface AdminUserRow {
  id: number;
  username: string;
  status: 'pending' | 'active';
  role: 'member' | 'citizen' | 'dietitian' | 'admin';
  last_seen_at: number | null;
  created_at: string;
}

function userToJson(u: AdminUserRow) {
  return {
    id: u.id,
    username: u.username,
    status: u.status,
    role: u.role,
    lastSeenAt: u.last_seen_at ?? null,
    createdAt: u.created_at,
  };
}

adminRouter.get('/users', (_req, res) => {
  const rows = db
    .prepare(`SELECT id, username, status, role, last_seen_at, created_at FROM users ORDER BY status = 'pending' DESC, created_at DESC`)
    .all() as AdminUserRow[];
  return res.json(rows.map(userToJson));
});

// 開通帳號（取代原本的寄信開通連結）
adminRouter.post('/users/:id/approve', async (req, res) => {
  const user = db.prepare('SELECT id, username, status FROM users WHERE id = ?').get(req.params.id) as
    | { id: number; username: string; status: string }
    | undefined;
  if (!user) return res.status(404).json({ error: 'not found' });
  if (user.status !== 'active') {
    db.prepare(`UPDATE users SET status = 'active', approval_token = NULL WHERE id = ?`).run(user.id);
    if (mailerConfigured()) {
      try {
        await sendAccountApproved(user.username);
      } catch (e) {
        console.error('account approved mail failed:', e);
      }
    }
  }
  const row = db
    .prepare('SELECT id, username, status, role, last_seen_at, created_at FROM users WHERE id = ?')
    .get(user.id) as AdminUserRow;
  return res.json(userToJson(row));
});

// 變更角色 / 狀態（停用＝改回 pending）
adminRouter.patch('/users/:id', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as { id: number } | undefined;
  if (!user) return res.status(404).json({ error: 'not found' });
  const parsed = adminPatchUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { role, status } = parsed.data;
  // 避免管理者把自己降級／停用而失去後台存取權
  if (user.id === req.userId && ((role && role !== 'admin') || (status && status !== 'active'))) {
    return res.status(400).json({ error: '無法變更自己的角色或狀態' });
  }
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  if (status) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
  const row = db
    .prepare('SELECT id, username, status, role, last_seen_at, created_at FROM users WHERE id = ?')
    .get(user.id) as AdminUserRow;
  return res.json(userToJson(row));
});

// 刪除會員（連同其所有紀錄與照片）
adminRouter.delete('/users/:id', (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id) as { id: number } | undefined;
  if (!user) return res.status(404).json({ error: 'not found' });
  if (user.id === req.userId) return res.status(400).json({ error: '無法刪除自己的帳號' });
  deleteUserData(user.id);
  return res.status(204).end();
});

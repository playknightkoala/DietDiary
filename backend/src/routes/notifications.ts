import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

// 會員通知：營養師留言／照片評分／調整份數
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

interface NotificationRow {
  id: number;
  type: string;
  target: string;
  date: string;
  member_id: number;
  member_name: string | null;
  read: number;
  created_at: number;
  meal: string | null;
}

// 最新 30 則（entry 目標補上餐別供前端顯示；紀錄已刪除則 meal 為 null。
// member_id > 0 表示是會員回覆通知，接收者為營養師）
notificationsRouter.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.id, n.type, n.target, n.date, n.member_id, n.read, n.created_at, e.meal,
              COALESCE(NULLIF(a.alias, ''), NULLIF(mu.nickname, ''), mu.username) AS member_name
       FROM notifications n
       LEFT JOIN entries e ON n.target = 'entry:' || e.id
       LEFT JOIN users mu ON mu.id = n.member_id
       LEFT JOIN member_aliases a ON a.member_id = n.member_id AND a.dietitian_id = n.user_id
       WHERE n.user_id = ?
       ORDER BY n.id DESC LIMIT 30`
    )
    .all(req.userId) as NotificationRow[];
  const unread = (
    db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(req.userId) as { c: number }
  ).c;
  return res.json({
    unread,
    items: rows.map((r) => ({
      id: r.id,
      type: r.type,
      target: r.target,
      date: r.date,
      memberId: r.member_id,
      memberName: r.member_name,
      meal: r.meal,
      read: !!r.read,
      createdAt: r.created_at,
    })),
  });
});

// 標示已讀：帶 ids 標示指定通知，否則全部標示已讀
notificationsRouter.post('/read', (req, res) => {
  const ids = req.body?.ids;
  if (Array.isArray(ids)) {
    const mark = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
    for (const id of ids) {
      if (Number.isInteger(id)) mark.run(req.userId, id);
    }
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.userId);
  }
  return res.json({ ok: true });
});

import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { COMMENT_TARGET_RE, commentCreateSchema } from '../validation.js';
import { commentTargetOwned, createComment, listComments } from '../helpers.js';

// 會員對自己紀錄的留言（營養師留言走 /api/pro/members/:id/comments）
export const commentsRouter = Router();
commentsRouter.use(requireAuth);

commentsRouter.get('/', (req, res) => {
  const target = String(req.query.target || '');
  if (!COMMENT_TARGET_RE.test(target) || !commentTargetOwned(req.userId, target)) {
    return res.status(400).json({ error: 'invalid target' });
  }
  return res.json(listComments(req.userId, target, req.userId));
});

commentsRouter.post('/', (req, res) => {
  const parsed = commentCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入留言內容（最多 1000 字）' });
  const { target, body } = parsed.data;
  if (!commentTargetOwned(req.userId, target)) return res.status(400).json({ error: 'invalid target' });
  createComment(req.userId, target, req.userId, body);
  return res.status(201).json(listComments(req.userId, target, req.userId));
});

// 只能刪自己寫的留言
commentsRouter.delete('/:cid', (req, res) => {
  const info = db
    .prepare('DELETE FROM entry_comments WHERE id = ? AND author_id = ? AND user_id = ?')
    .run(req.params.cid, req.userId, req.userId);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  return res.status(204).end();
});

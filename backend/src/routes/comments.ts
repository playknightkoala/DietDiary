import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { COMMENT_TARGET_RE, commentCreateSchema, commentEditSchema } from '../validation.js';
import { commentTargetOwned, createComment, listComments, notifyCommentWatchers } from '../helpers.js';

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
  // 通知曾在這則貼文留言的營養師（會員回覆營養師）
  notifyCommentWatchers(req.userId, target, req.userId);
  return res.status(201).json(listComments(req.userId, target, req.userId));
});

// 只能編輯自己寫的留言
commentsRouter.patch('/:cid', (req, res) => {
  const parsed = commentEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入留言內容（最多 1000 字）' });
  const row = db
    .prepare('SELECT target FROM entry_comments WHERE id = ? AND author_id = ? AND user_id = ? AND is_ai = 0')
    .get(req.params.cid, req.userId, req.userId) as { target: string } | undefined;
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE entry_comments SET body = ? WHERE id = ? AND author_id = ? AND user_id = ?').run(
    parsed.data.body,
    req.params.cid,
    req.userId,
    req.userId
  );
  return res.json(listComments(req.userId, row.target, req.userId));
});

// 可刪除自己寫的留言，或自己貼文底下的 AI 評語
commentsRouter.delete('/:cid', (req, res) => {
  const info = db
    .prepare('DELETE FROM entry_comments WHERE id = ? AND user_id = ? AND (author_id = ? OR is_ai = 1)')
    .run(req.params.cid, req.userId, req.userId);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  return res.status(204).end();
});

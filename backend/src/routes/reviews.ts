import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { reviewsReadSchema } from '../validation.js';
import { listUnreadReviews, markReviewsRead } from '../helpers.js';

// 營養師回饋「逐餐必讀」視窗（會員端）：營養師評燈號／留言／調整份量後，
// 會員端跳出視窗一餐一頁顯示，翻到最後一頁才能關閉，看完後標已讀不再重複顯示。
// 一律以 req.userId 為擁有者：只看得到、也只標得到自己的回饋
export const reviewsRouter = Router();
reviewsRouter.use(requireAuth);

// 尚未看過的回饋，依餐分組（日期→餐別順序，舊→新）
reviewsRouter.get('/unread', (req, res) => {
  return res.json({ items: listUnreadReviews(req.userId) });
});

// 看完後標已讀：只標實際顯示過且內容未變的項目（細節見 helpers.markReviewsRead）
reviewsRouter.post('/read', (req, res) => {
  const parsed = reviewsReadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  markReviewsRead(req.userId, parsed.data);
  return res.json({ ok: true });
});

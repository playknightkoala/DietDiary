// AI 路由組裝：各端點實作拆在 routes/ai/ 子模組，這裡只負責掛載順序與授權層級。
//
// - feedback（/feedback、/kb/seed）與 research（/research）掛在 requireAI 之前：
//   投票只需登入（gateway 暫時故障也能投）、seed 是管理者專屬、research 以角色（營養師／管理者）授權，
//   三者都不需要逐人開 ai_enabled。
// - 其餘端點（/inbody、/ocr、/comment、/daily）都在 requireAI 之後：需管理者逐一開放的 AI 功能。
//
// 子模組分工：
//   ai/common.ts    requireAI 守門、MEAL_NAMES、EntryFull
//   ai/nutrition.ts 提示詞用的營養計算與資料摘要（KCAL/MACROS/BMR-TDEE 等前後端重複宣告都在這裡）
//   ai/feedback.ts  讚倒讚（含 KB 計票）與知識庫種庫
//   ai/research.ts  營養師網路查證助手
//   ai/inbody.ts    InBody 報告辨識
//   ai/ocr.ts       餐點照片估份數＋敘述（含品牌搜尋校正）
//   ai/comment.ts   單篇評語與今日總評（共用偏好提示、SEARCH 查證協定）
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAI } from './ai/common.js';
import { feedbackRouter } from './ai/feedback.js';
import { researchRouter } from './ai/research.js';
import { inbodyRouter } from './ai/inbody.js';
import { ocrRouter } from './ai/ocr.js';
import { commentRouter } from './ai/comment.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.use(feedbackRouter);
aiRouter.use(researchRouter);

aiRouter.use(requireAI);

aiRouter.use(inbodyRouter);
aiRouter.use(ocrRouter);
aiRouter.use(commentRouter);

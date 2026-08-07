// 營養師查詢輔助：問題 → 網路搜尋 → LLM 整理成含來源引用的繁中摘要。拆自原 routes/ai.ts。
// 以角色（營養師／管理者）授權即可，不需逐人開 ai_enabled，故掛在 requireAI 之前（見 routes/ai.ts）；
// 掛在 /api/ai/ 下以取得 nginx 的 150s 逾時（搜尋＋LLM 兩段可能較慢）。
import { Router } from 'express';
import { db } from '../../db.js';
import { aiResearchSchema } from '../../validation.js';
import { searchActive, webResultForPrompt, webSearch } from '../../search.js';
import { COMMENT_FALLBACK_MODEL, COMMENT_MODEL, aiConfigured, chat } from '../../llm.js';

export const researchRouter = Router();

researchRouter.post('/research', async (req, res) => {
  const u = db.prepare('SELECT role, status FROM users WHERE id = ?').get(req.userId) as
    | { role: string; status: string }
    | undefined;
  if (!u || u.status !== 'active' || (u.role !== 'dietitian' && u.role !== 'admin')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!aiConfigured()) return res.status(503).json({ error: 'AI 服務尚未設定，請聯絡管理員' });
  if (!searchActive()) return res.status(503).json({ error: '網路查詢功能尚未設定（TAVILY_API_KEY），請聯絡管理員' });
  const parsed = aiResearchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: '請輸入 2～200 字的問題' });
  const question = parsed.data.question;

  const web = await webSearch(question);
  if (!web) {
    return res.status(503).json({ error: '網路查詢暫時無法使用（可能本月查詢額度已用完），請稍後再試' });
  }

  const system =
    '你是營養學領域的研究助理，協助營養師快速掌握資訊。請根據提供的網路搜尋結果回答問題：' +
    '以繁體中文寫 2～5 句的重點摘要，只根據搜尋結果作答、不要憑自己的印象補充，' +
    '搜尋結果不足以回答時要直說「查到的資料有限」並說明實際查到了什麼。' +
    '引用時以（來源1）（來源2）標註對應的來源編號，不要輸出網址。直接寫內容，不要加標題或條列。';
  const context = `問題：${question}\n\n【網路搜尋結果】\n${webResultForPrompt(web)}`;

  const chain = [COMMENT_MODEL, COMMENT_FALLBACK_MODEL];
  let lastError: unknown = null;
  for (const model of chain) {
    try {
      const text = await chat({
        model,
        temperature: 0.3,
        maxTokens: 600,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: context },
        ],
      });
      return res.json({
        answer: text.replace(/\s+$/, '').slice(0, 2000),
        sources: web.results.map((r) => ({ title: r.title, url: r.url })),
        model,
      });
    } catch (e) {
      lastError = e;
      console.error(`ai research attempt failed (${model}), trying next:`, e instanceof Error ? e.message : e);
    }
  }
  console.error('ai research failed (all attempts):', lastError);
  return res.status(502).json({ error: 'AI 整理失敗，請稍後再試' });
});

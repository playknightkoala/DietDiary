import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { aiOcrSchema, aiCommentSchema, FOOD_KEYS } from '../validation.js';
import {
  createComment,
  emptyFood,
  listComments,
  parseFood,
  parsePhotos,
  type Food,
} from '../helpers.js';
import {
  COMMENT_FALLBACK_MODEL,
  COMMENT_MODEL,
  OCR_MODEL,
  aiConfigured,
  chat,
  extractJson,
  imagePart,
  photoDataUri,
  textPart,
} from '../llm.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

// AI 功能需由管理者逐一開放（users.ai_enabled）
function requireAI(req: Request, res: Response, next: NextFunction) {
  const row = db.prepare('SELECT status, ai_enabled FROM users WHERE id = ?').get(req.userId) as
    | { status: string; ai_enabled: number }
    | undefined;
  if (!row || row.status !== 'active' || !row.ai_enabled) {
    return res.status(403).json({ error: '尚未開放 AI 功能' });
  }
  if (!aiConfigured()) return res.status(503).json({ error: 'AI 服務尚未設定，請聯絡管理員' });
  next();
}
aiRouter.use(requireAI);

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', night: '宵夜', snack: '點心',
};

// 六大類的每份熱量（與前端 domain.KCAL 一致），供計算與提示詞使用
const KCAL: Record<string, number> = {
  meatLow: 55, meatMed: 75, meatHigh: 120, meatXHigh: 135,
  veg: 25, grain: 70, oil: 45, fruit: 60,
  milkSkim: 80, milkLow: 120, milkFull: 150,
};

// 把細分份數收斂成六大類總份數（蛋豆魚肉、乳品各自加總）
function sixCategories(food: Food) {
  return {
    protein: round1(food.meatLow + food.meatMed + food.meatHigh + food.meatXHigh),
    veg: round1(food.veg),
    grain: round1(food.grain),
    oil: round1(food.oil),
    fruit: round1(food.fruit),
    milk: round1(food.milkSkim + food.milkLow + food.milkFull),
  };
}

function round1(n: number): number {
  return Math.round((n || 0) * 10) / 10;
}
function clampPortion(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!isFinite(v) || v < 0) return 0;
  return round1(Math.min(v, 99));
}

function foodSummaryZh(food: Food): string {
  const c = sixCategories(food);
  const parts: string[] = [];
  if (c.protein) parts.push(`蛋豆魚肉 ${c.protein} 份`);
  if (c.veg) parts.push(`蔬菜 ${c.veg} 份`);
  if (c.grain) parts.push(`全穀雜糧 ${c.grain} 份`);
  if (c.oil) parts.push(`油脂堅果 ${c.oil} 份`);
  if (c.fruit) parts.push(`水果 ${c.fruit} 份`);
  if (c.milk) parts.push(`乳品 ${c.milk} 份`);
  return parts.join('、') || '尚未記錄份數';
}

function kcalOfFood(food: Food): number {
  return Math.round(FOOD_KEYS.reduce((a, k) => a + (food[k] || 0) * (KCAL[k] || 0), 0));
}

interface EntryFull {
  id: number;
  date: string;
  meal: string;
  desc: string;
  photos: string;
  eat_time: string;
  food: string;
  photo_foods: string;
}

// ---- 判斷單張照片的營養素份數 ----
aiRouter.post('/ocr', async (req, res) => {
  const parsed = aiOcrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { entryId, photo } = parsed.data;

  const entry = db
    .prepare('SELECT id, photos FROM entries WHERE id = ? AND user_id = ?')
    .get(entryId, req.userId) as { id: number; photos: string } | undefined;
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (!parsePhotos(entry.photos).includes(photo)) return res.status(404).json({ error: 'photo not found' });

  const dataUri = await photoDataUri(photo);
  if (!dataUri) return res.status(404).json({ error: 'photo file missing' });

  const prompt =
    '你是專業營養師，正在看一張台灣常見的餐點照片。請做兩件事：\n' +
    '1) 依「食物代換六大類」估計這張照片中食物的份數。\n' +
    '2) 用繁體中文寫一句 15～40 字的簡短敘述（caption），描述這張照片吃了什麼、大概份量，' +
    '像使用者自己隨手記錄的口吻（例：「滷雞腿便當，白飯約八分滿，配燙青菜」），不要列出份數數字、不要加標點以外的符號。\n' +
    '六大類與每份參考：蛋豆魚肉（一份約手掌大小的肉/一顆蛋）、蔬菜（一份約煮熟半碗）、全穀雜糧（一份約四分之一碗飯）、' +
    '油脂堅果（一份約一茶匙油）、水果（一份約一個拳頭）、乳品（一份約240ml牛奶）。\n' +
    '只輸出 JSON 物件，鍵為 protein、veg、grain、oil、fruit、milk（值為份數，可含一位小數，沒有就填 0）與 caption（字串），不要有其他文字。\n' +
    '範例：{"protein":2,"veg":1,"grain":2.5,"oil":1,"fruit":0,"milk":0,"caption":"滷雞腿便當，白飯約八分滿，配燙青菜"}';

  try {
    // 只用 31b 看圖（e4b 判斷品質不佳，不作視覺備援）；壞掉就直接回報稍後再試。
    // 官方範例圖片排在文字前，照做以維持辨識品質。
    const model = OCR_MODEL;
    const text = await chat({
      model,
      json: true,
      temperature: 0.2,
      maxTokens: 400,
      messages: [{ role: 'user', content: [imagePart(dataUri), textPart(prompt)] }],
    });
    const raw = extractJson<Record<string, unknown>>(text);
    // 六大類 → 應用內細分欄位：蛋豆魚肉預設中脂、乳品預設低脂（使用者可再自行微調）
    const food = emptyFood();
    food.meatMed = clampPortion(raw.protein);
    food.veg = clampPortion(raw.veg);
    food.grain = clampPortion(raw.grain);
    food.oil = clampPortion(raw.oil);
    food.fruit = clampPortion(raw.fruit);
    food.milkLow = clampPortion(raw.milk);
    // AI 幫忙寫的這張照片敘述；前端會把它組進整筆「這餐吃了什麼」
    const caption = typeof raw.caption === 'string' ? raw.caption.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
    return res.json({ food, caption, model });
  } catch (e) {
    console.error('ai ocr failed:', e);
    return res.status(502).json({ error: 'AI 判斷失敗（視覺模型暫時無法使用），請稍後再試' });
  }
});

// ---- AI 評語（純文字：依敘述＋份數＋餐期＋時間，對自己的飲食貼文產生一則 AI 留言）----
aiRouter.post('/comment', async (req, res) => {
  const parsed = aiCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { target } = parsed.data;
  const entryId = Number(target.slice('entry:'.length));

  const entry = db
    .prepare('SELECT id, date, meal, desc, photos, eat_time, food, photo_foods FROM entries WHERE id = ? AND user_id = ?')
    .get(entryId, req.userId) as EntryFull | undefined;
  if (!entry) return res.status(404).json({ error: 'not found' });

  const food = parseFood(entry.food);
  const mealName = MEAL_NAMES[entry.meal] || '這餐';

  // 純文字評語：只針對這一篇動態，用「敘述＋這餐份數＋餐期＋用餐時間」評估
  // （不帶照片、不帶當天累計與當日目標）。照片的資訊已在使用者記錄時經 AI 寫進敘述。
  const context =
    `這是使用者的「${mealName}」飲食紀錄（日期：${entry.date}${entry.eat_time ? `，用餐時間：${entry.eat_time}` : ''}）。\n` +
    `使用者的敘述：${entry.desc ? entry.desc : '（未填寫）'}\n` +
    `這餐已記錄的六大類份數：${foodSummaryZh(food)}（約 ${kcalOfFood(food)} 大卡）\n`;

  const system =
    '你是一位親切、專業的營養師，正在均衡飲食日記 App 中回覆使用者的餐點紀錄。' +
    '請只針對「這一餐」評估：這餐吃了什麼（依使用者的敘述與份數）、六大類份數是否均衡、是哪一餐與用餐時間點。' +
    '例如：這餐某類偏多可溫和提醒、缺了哪類可建議下次補上；宵夜或太晚的正餐可溫和提醒時間點。' +
    '不要臆測使用者一整天的累計或目標，只就眼前這餐給出評語。' +
    '若未提供用餐時間，就不要臆測或編造用餐時間點（例如不要說「傍晚」「太晚」等）。' +
    '請用繁體中文、溫暖鼓勵的口吻寫一段 2～4 句的評語：先肯定做得好的地方，再給 1～2 個具體、好執行的小建議。' +
    '請直接寫評語內容，不要加標題或條列，不要逐項重複數字，總長度約 60～180 字。';

  // 純文字降級：主模型（12b）整批故障時退到備援（e4b）也要給出評語
  const chain = [COMMENT_MODEL, COMMENT_FALLBACK_MODEL];

  let lastError: unknown = null;
  for (const model of chain) {
    try {
      const text = await chat({
        model,
        temperature: 0.6,
        maxTokens: 500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: context },
        ],
      });
      const body = text.replace(/\s+$/, '').slice(0, 1000);
      createComment(req.userId, target, req.userId, body, true, model);
      return res.status(201).json(listComments(req.userId, target, req.userId));
    } catch (e) {
      lastError = e;
      console.error(`ai comment attempt failed (${model}), trying next:`, e instanceof Error ? e.message : e);
    }
  }
  console.error('ai comment failed (all attempts):', lastError);
  return res.status(502).json({ error: 'AI 評語產生失敗，請稍後再試' });
});

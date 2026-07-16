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
  COMMENT_USE_PHOTO,
  MAX_IMAGES_TOTAL_BYTES,
  OCR_MODEL,
  aiConfigured,
  bufferDataUri,
  chat,
  extractJson,
  imagePart,
  photoBufferForLlm,
  photoDataUri,
  textPart,
  type ContentPart,
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

// 未設定目標時的預設每日份數（與前端 domain.DEFAULT_GOALS 一致）
const DEFAULT_GOAL_VALS = { meat: 7, veg: 3, grain: 10, oil: 3, fruit: 2, milk: 2 };

// 該日期適用的目標份數（多組重疊取最新一組；無涵蓋則用預設）
function goalValsFor(userId: number, date: string): Record<string, number> {
  const row = db
    .prepare('SELECT vals FROM goal_periods WHERE user_id = ? AND start <= ? AND end >= ? ORDER BY id DESC LIMIT 1')
    .get(userId, date, date) as { vals: string } | undefined;
  if (!row) return DEFAULT_GOAL_VALS;
  try {
    return { ...DEFAULT_GOAL_VALS, ...JSON.parse(row.vals) };
  } catch {
    return DEFAULT_GOAL_VALS;
  }
}

function goalSummaryZh(vals: Record<string, number>): string {
  return `蛋豆魚肉 ${vals.meat} 份、蔬菜 ${vals.veg} 份、全穀雜糧 ${vals.grain} 份、油脂堅果 ${vals.oil} 份、水果 ${vals.fruit} 份、乳品 ${vals.milk} 份`;
}

// 使用者某天所有飲食紀錄的六大類加總
function dayTotalFood(userId: number, date: string): Food {
  const rows = db
    .prepare('SELECT food FROM entries WHERE user_id = ? AND date = ?')
    .all(userId, date) as { food: string }[];
  const total = emptyFood();
  for (const r of rows) {
    const f = parseFood(r.food);
    for (const k of FOOD_KEYS) total[k] = round1(total[k] + (f[k] || 0));
  }
  return total;
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
    '你是專業營養師，正在看一張台灣常見的餐點照片。請依「食物代換六大類」估計這張照片中食物的份數。\n' +
    '六大類與每份參考：蛋豆魚肉（一份約手掌大小的肉/一顆蛋）、蔬菜（一份約煮熟半碗）、全穀雜糧（一份約四分之一碗飯）、' +
    '油脂堅果（一份約一茶匙油）、水果（一份約一個拳頭）、乳品（一份約240ml牛奶）。\n' +
    '只輸出 JSON 物件，鍵為 protein、veg、grain、oil、fruit、milk，值為份數（可含一位小數，沒有就填 0），不要有其他文字。\n' +
    '範例：{"protein":2,"veg":1,"grain":2.5,"oil":1,"fruit":0,"milk":0}';

  try {
    // 只用 31b 看圖（e4b 判斷品質不佳，不作視覺備援）；壞掉就直接回報稍後再試
    const model = OCR_MODEL;
    const text = await chat({
      model,
      json: true,
      temperature: 0.2,
      maxTokens: 300,
      messages: [{ role: 'user', content: [textPart(prompt), imagePart(dataUri)] }],
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
    return res.json({ food, model });
  } catch (e) {
    console.error('ai ocr failed:', e);
    return res.status(502).json({ error: 'AI 判斷失敗（視覺模型暫時無法使用），請稍後再試' });
  }
});

// ---- AI 評語（依使用者寫的內容與照片，對自己的飲食貼文產生一則 AI 留言）----
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
  const photos = parsePhotos(entry.photos);
  const mealName = MEAL_NAMES[entry.meal] || '這餐';

  // 是否附上照片由 LLM_COMMENT_USE_PHOTO 控制（預設開啟）。
  // gateway 對整個請求的圖片「總量」有上限：把預算分給每張照片縮圖，仍超出總量的照片捨去（會如實標示張數）。
  let allImages: ContentPart[] = [];
  let usedPhotoCount = 0;
  if (COMMENT_USE_PHOTO && photos.length) {
    const perPhotoBudget = Math.max(8_000, Math.floor(MAX_IMAGES_TOTAL_BYTES / photos.length));
    const bufs = (await Promise.all(photos.map((p) => photoBufferForLlm(p, perPhotoBudget)))).filter(
      (b): b is Buffer => !!b
    );
    let total = 0;
    const used: Buffer[] = [];
    for (const b of bufs) {
      if (total + b.length > MAX_IMAGES_TOTAL_BYTES) break;
      used.push(b);
      total += b.length;
    }
    usedPhotoCount = used.length;
    allImages = used.map((b) => imagePart(bufferDataUri(b)));
  }

  // 給模型的完整脈絡：哪一餐＋用餐時間＋敘述＋這餐總份數＋當天累計份數＋當日目標
  const dayFood = dayTotalFood(req.userId, entry.date);
  const goalVals = goalValsFor(req.userId, entry.date);
  const contextFor = (imageCount: number) =>
    `這是使用者的「${mealName}」飲食紀錄（日期：${entry.date}${entry.eat_time ? `，用餐時間：${entry.eat_time}` : ''}）。\n` +
    `使用者的敘述：${entry.desc ? entry.desc : '（未填寫）'}\n` +
    `這餐已記錄的六大類份數：${foodSummaryZh(food)}（約 ${kcalOfFood(food)} 大卡）\n` +
    `使用者今天目前累計（含這餐）：${foodSummaryZh(dayFood)}（約 ${kcalOfFood(dayFood)} 大卡）\n` +
    `使用者當日的目標份數：${goalSummaryZh(goalVals)}\n` +
    (imageCount ? `並附上這餐的 ${imageCount} 張照片，請一併參考照片中的實際食物內容。\n` : '');

  const system =
    '你是一位親切、專業的營養師，正在均衡飲食日記 App 中回覆使用者的餐點紀錄。' +
    '請綜合考量：這餐吃了什麼（照片與敘述）、是哪一餐與用餐時間點、今天目前累計的份數與當日目標的差距，' +
    '給出「此時此刻」最適合的評語。例如：某類已達標就提醒接下來收斂、還差很多就建議在今天剩下的餐次補足；' +
    '宵夜或太晚的正餐可溫和提醒時間點。' +
    '請用繁體中文、溫暖鼓勵的口吻寫一段 2～4 句的評語：先肯定做得好的地方，再給 1～2 個具體、好執行的小建議。' +
    '請直接寫評語內容，不要加標題或條列，不要逐項重複數字，總長度約 60～180 字。';

  // 階梯式降級：31b 偶爾整批 500（間歇性），退到純文字也要給出評語。
  // e4b 看圖品質不佳且僅能讀一張，不作視覺備援、只當純文字備援。
  // 含照片：31b(全部照片) → 12b(純文字) → e4b(純文字)
  // 純文字：12b → e4b
  const attempts: { model: string; images: ContentPart[] }[] = allImages.length
    ? [
        { model: OCR_MODEL, images: allImages },
        { model: COMMENT_MODEL, images: [] },
        { model: COMMENT_FALLBACK_MODEL, images: [] },
      ]
    : [
        { model: COMMENT_MODEL, images: [] },
        { model: COMMENT_FALLBACK_MODEL, images: [] },
      ];
  // 去掉重複的嘗試（例如只有一張照片時 e4b(全部) 與 e4b(第一張) 相同）
  const seen = new Set<string>();
  const chain = attempts.filter((a) => {
    const key = `${a.model}#${a.images.length}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let lastError: unknown = null;
  for (const attempt of chain) {
    try {
      const text = await chat({
        model: attempt.model,
        temperature: 0.6,
        maxTokens: 500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [textPart(contextFor(attempt.images.length)), ...attempt.images] },
        ],
      });
      const body = text.replace(/\s+$/, '').slice(0, 1000);
      // 模型標示：降級或部分參考時如實註明，讓使用者知道這則評語參考了什麼
      const label =
        photos.length && attempt.images.length === 0
          ? `${attempt.model}（未參考照片）`
          : attempt.images.length && usedPhotoCount < photos.length
            ? `${attempt.model}（參考 ${usedPhotoCount}/${photos.length} 張照片）`
            : attempt.model;
      createComment(req.userId, target, req.userId, body, true, label);
      return res.status(201).json(listComments(req.userId, target, req.userId));
    } catch (e) {
      lastError = e;
      console.error(`ai comment attempt failed (${attempt.model}, ${attempt.images.length} images), trying next:`, e instanceof Error ? e.message : e);
    }
  }
  console.error('ai comment failed (all attempts):', lastError);
  return res.status(502).json({ error: 'AI 評語產生失敗，請稍後再試' });
});

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { aiOcrSchema, aiCommentSchema, aiDailySchema, aiFeedbackSchema, FOOD_KEYS } from '../validation.js';
import {
  createComment,
  currentAiBody,
  emptyFood,
  getDayJson,
  getFeedbackExamples,
  listComments,
  parseFood,
  parsePhotos,
  setAiFeedback,
  upsertDailySummary,
  type Food,
} from '../helpers.js';
import { kbHint, kbLookupByImage, kbUpsert, kbVote } from '../kb.js';
import {
  COMMENT_FALLBACK_MODEL,
  COMMENT_MODEL,
  OCR_MODEL,
  aiConfigured,
  kbActive,
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

// ---- AI 評價（讚／倒讚）----
// 只需登入即可記錄（不經 requireAI，gateway 暫時故障也能投票）；投票以本人身分儲存。
aiRouter.post('/feedback', (req, res) => {
  const parsed = aiFeedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { kind, ref, vote, body: clientBody, dishId } = parsed.data;
  // comment/daily：後端擷取當下內容快照；ocr_*：OCR 結果未持久化，用前端帶來的快照
  const isOcr = kind === 'ocr_caption' || kind === 'ocr_food';
  const body = vote === 0 ? '' : isOcr ? (clientBody ?? '').slice(0, 500) : currentAiBody(req.userId, kind, ref);
  setAiFeedback(req.userId, kind, ref, vote, body);
  // 份數評價若對應到知識庫某道菜，累計該菜的全體讚/倒讚（取消時不動，避免難以回退）
  if (kind === 'ocr_food' && dishId && vote !== 0) kbVote(dishId, vote);
  return res.json({ vote });
});

// ---- 知識庫種庫（管理者）：把既有「已存檔且有敘述＋照片」的紀錄灌進共用知識庫 ----
aiRouter.post('/kb/seed', async (req, res) => {
  const u = db.prepare('SELECT role, status FROM users WHERE id = ?').get(req.userId) as { role: string; status: string } | undefined;
  if (!u || u.status !== 'active' || u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (!kbActive()) return res.status(400).json({ error: '知識庫未啟用（需設定 AI_KB_ENABLED 與 AI_EMBED_URL）' });
  const limit = Math.min(3000, Math.max(1, Number(req.body?.limit) || 500));
  const rows = db
    .prepare("SELECT desc, photos, food FROM entries WHERE desc != '' AND photos != '[]' ORDER BY id DESC LIMIT ?")
    .all(limit) as { desc: string; photos: string; food: string }[];
  let seeded = 0, skipped = 0;
  for (const r of rows) {
    const photos = parsePhotos(r.photos);
    if (!photos.length || !r.desc.trim()) { skipped++; continue; }
    try {
      await kbUpsert(r.desc, parseFood(r.food), photos[0]);
      seeded++;
    } catch {
      skipped++;
    }
  }
  return res.json({ seeded, skipped, scanned: rows.length });
});

aiRouter.use(requireAI);

const MEAL_NAMES: Record<string, string> = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', night: '宵夜', snack: '點心',
};

// 依讚／倒讚組出「偏好提示」注入 system（混合）：
// 這位使用者自己的評價優先，其他所有使用者的評價當次要基準。讚＝好範例、倒讚＝反例。
// 讓評價能累積、跨項地影響往後每一次生成，兼顧個人化與全體品質。
function preferenceHint(userId: number): string {
  const { personal, global } = getFeedbackExamples(userId);
  const has = (b: { liked: string[]; disliked: string[] }) => b.liked.length || b.disliked.length;
  if (!has(personal) && !has(global)) return '';
  const clip = (s: string) => s.replace(/\s+/g, ' ').slice(0, 160);
  const lines = (arr: string[]) => arr.map((b) => `・「${clip(b)}」`).join('\n');
  let out = '\n以下是使用者對 AI 回答的評價，請據此調整這次回答的風格、方向與具體程度（以「這位使用者自己」的偏好為優先）：\n';
  if (has(personal)) {
    out += '【這位使用者自己（優先參考）】\n';
    if (personal.liked.length) out += '喜歡這種回答：\n' + lines(personal.liked) + '\n';
    if (personal.disliked.length) out += '不喜歡這種回答（請避免類似寫法、角度或空泛程度）：\n' + lines(personal.disliked) + '\n';
  }
  if (has(global)) {
    out += '【其他使用者普遍（次要基準）】\n';
    if (global.liked.length) out += '普遍受歡迎：\n' + lines(global.liked) + '\n';
    if (global.disliked.length) out += '普遍不受歡迎：\n' + lines(global.disliked) + '\n';
  }
  return out;
}

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

// 六大類：sixCategories 的鍵、目標 vals 的鍵、中文名稱
const CAT_DEFS: [keyof ReturnType<typeof sixCategories>, string, string][] = [
  ['protein', 'meat', '蛋豆魚肉'], ['veg', 'veg', '蔬菜'], ['grain', 'grain', '全穀雜糧'],
  ['oil', 'oil', '油脂堅果'], ['fruit', 'fruit', '水果'], ['milk', 'milk', '乳品'],
];

// 六大類名稱只是「食物代換表」的分類代稱，不等於健康與否：例如炸雞皮、餅乾、蛋糕都可能被歸到「全穀雜糧」，
// 炸物的油、糕點的糖也會被歸到「油脂堅果」。健不健康要看使用者敘述裡「實際吃的東西」，不能因為落在某個
// 分類就當成健康食材；敘述沒寫清楚時就不要憑分類名稱腦補是健康版本。共用給評語與今日總評的提示詞。
const CATEGORY_LABEL_CAVEAT =
  '注意：六大類（全穀雜糧、油脂堅果等）只是「食物代換表」的分類代稱，不代表健康與否——' +
  '例如炸雞皮、餅乾、蛋糕也會被歸為全穀雜糧，糕點與炸物的油糖也會落在油脂堅果。' +
  '請依使用者敘述裡「實際吃的東西」判斷健不健康，不要因為某類份數多就當成吃得健康而稱讚；' +
  '敘述沒有寫清楚是什麼時，就不要憑分類名稱假設它是健康的版本。';
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

// ---- 今日總評用：目標與身體數據 ----

// 未設定目標時的預設每日份數與喝水量（與前端 domain 一致）
const DEFAULT_GOAL_VALS = { meat: 7, veg: 3, grain: 10, oil: 3, fruit: 2, milk: 2 };
const DEFAULT_WATER = 2000;

// 該日期適用的目標（六大類份數＋喝水；多組重疊取最新一組，無涵蓋用預設）
function goalForDate(userId: number, date: string): { vals: Record<string, number>; water: number } {
  const row = db
    .prepare('SELECT vals, water FROM goal_periods WHERE user_id = ? AND start <= ? AND end >= ? ORDER BY id DESC LIMIT 1')
    .get(userId, date, date) as { vals: string; water: number } | undefined;
  if (!row) return { vals: DEFAULT_GOAL_VALS, water: DEFAULT_WATER };
  let vals = DEFAULT_GOAL_VALS;
  try {
    vals = { ...DEFAULT_GOAL_VALS, ...JSON.parse(row.vals) };
  } catch { /* 用預設 */ }
  // 目標喝水 0＝這段期間不特別要求喝水，須保留 0；欄位 NOT NULL 有值時不該 fallback（?? 而非 ||）
  return { vals, water: row.water ?? DEFAULT_WATER };
}

function goalSummaryZh(vals: Record<string, number>): string {
  return `蛋豆魚肉 ${vals.meat} 份、蔬菜 ${vals.veg} 份、全穀雜糧 ${vals.grain} 份、油脂堅果 ${vals.oil} 份、水果 ${vals.fruit} 份、乳品 ${vals.milk} 份`;
}

// 今日總評用：整天六大類實際 vs 目標的比對（後端算好，避免小模型算錯或憑空說「低於目標」）。
// 逐類給明確狀態，特別處理「目標 0」：目標 0＝這段期間不應攝取，吃了才要提醒，沒吃就是達成，
// 絕不能說成「低於目標／不足」。回傳每一類一行文字。
function dayGoalBreakdown(dayTotal: Food, vals: Record<string, number>): string[] {
  const six = sixCategories(dayTotal);
  return CAT_DEFS.map(([sk, gk, name]) => {
    const eaten = six[sk];
    const g = vals[gk] ?? 0;
    let status: string;
    if (g === 0) {
      status = eaten > 0
        ? `目標 0 份（這段期間不應攝取），今天卻吃了 ${eaten} 份，請明確提醒`
        : `目標 0 份且今天沒有攝取，已達成（不要說成低於目標或不足）`;
    } else if (eaten > g * 1.2) {
      status = `今天 ${eaten} 份，明顯超過目標 ${g} 份，可提醒收斂（絕對不要建議再多吃這一類）`;
    } else if (eaten < g * 0.6) {
      status = `今天 ${eaten} 份，明顯低於目標 ${g} 份，可建議補足`;
    } else {
      status = `今天 ${eaten} 份，接近目標 ${g} 份，大致達標（已經夠了，不要建議再多吃這一類）`;
    }
    return `・${name}：${status}`;
  });
}

// 今日總評用：喝水實際 vs 目標的比對（同樣後端算好；目標 0 時不說「不足」）。
function waterGoalNote(water: number, goalWater: number): string {
  if (goalWater <= 0) {
    return water > 0 ? `目標 0 ml，今天喝了 ${water} ml` : `目標 0 ml，今天未記錄喝水`;
  }
  if (water >= goalWater) return `今天 ${water} / ${goalWater} ml，已達標`;
  if (water < goalWater * 0.6) return `今天 ${water} / ${goalWater} ml，明顯不足，可提醒多補水`;
  return `今天 ${water} / ${goalWater} ml，略低於目標`;
}

const BODY_LABELS: [key: string, name: string, unit: string][] = [
  ['weight', '體重', 'kg'], ['fat', '體脂率', '%'], ['waist', '腰圍', 'cm'],
  ['muscle', '肌肉重', 'kg'], ['fatkg', '體脂重', 'kg'],
];

function bodyStrFrom(b: Record<string, string>): string {
  return BODY_LABELS.filter(([k]) => (b[k] ?? '') !== '').map(([k, n, u]) => `${n} ${b[k]} ${u}`).join('、');
}

// 身體數據：優先用當天，否則找 date 當天或之前「最近一次」有量測的紀錄（都沒有回 '未記錄'）
function bodyLineFor(userId: number, date: string, dayBody: Record<string, string>, dayBodyTime: string): string {
  const today = bodyStrFrom(dayBody);
  if (today) return today + (dayBodyTime ? `（${dayBodyTime}）` : '');
  const row = db
    .prepare(
      `SELECT date, body_weight, body_fat, body_waist, body_muscle, body_fatkg FROM days
       WHERE user_id = ? AND date <= ?
         AND (body_weight != '' OR body_fat != '' OR body_waist != '' OR body_muscle != '' OR body_fatkg != '')
       ORDER BY date DESC LIMIT 1`
    )
    .get(userId, date) as
    | { date: string; body_weight: string; body_fat: string; body_waist: string; body_muscle: string; body_fatkg: string }
    | undefined;
  if (!row) return '未記錄';
  const s = bodyStrFrom({ weight: row.body_weight, fat: row.body_fat, waist: row.body_waist, muscle: row.body_muscle, fatkg: row.body_fatkg });
  return s ? `${s}（最近一次量測：${row.date}）` : '未記錄';
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
    '重要：只描述你「明確看得到」的食物，不確定或被其他食物遮住看不清楚的就不要編造（例如被蓋住的配菜、看不清的肉種都不要猜）；' +
    '寧可少寫，也不要寫出照片裡看不到的東西。\n' +
    '只輸出 JSON 物件，鍵為 protein、veg、grain、oil、fruit、milk（值為份數，可含一位小數，沒有就填 0）與 caption（字串），不要有其他文字。\n' +
    '範例：{"protein":2,"veg":1,"grain":2.5,"oil":1,"fruit":0,"milk":0,"caption":"滷雞腿便當，白飯約八分滿，配燙青菜"}';

  // 共用知識庫（開關開啟時）：先找相似菜色，把社群共識份數當估算參考注入提示。查詢失敗不影響 OCR。
  const kbMatch = await kbLookupByImage(photo).catch(() => null);
  const promptFull = kbMatch ? prompt + '\n' + kbHint(kbMatch) : prompt;

  try {
    // 只用 31b 看圖（e4b 判斷品質不佳，不作視覺備援）；壞掉就直接回報稍後再試。
    // 官方範例圖片排在文字前，照做以維持辨識品質。
    const model = OCR_MODEL;
    const text = await chat({
      model,
      json: true,
      temperature: 0.2,
      maxTokens: 400,
      messages: [{ role: 'user', content: [imagePart(dataUri), textPart(promptFull)] }],
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
    // 附上知識庫命中的參考（前端顯示「類似菜色社群份數」，並讓份數評價回饋到該道菜）
    const kb = kbMatch ? { dishId: kbMatch.id, caption: kbMatch.caption, food: kbMatch.food, up: kbMatch.up, down: kbMatch.down } : null;
    return res.json({ food, caption, model, kb });
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

  // 與當日目標比對（僅此餐 vs 一整天目標；比對由後端算好，避免小模型算錯）：
  // 目標為 0＝目標期間完全不能攝取，這餐出現就要提醒；單餐即超過一整天目標的 120% 也要提醒（無論該類一般認為健不健康）
  const goal = goalForDate(req.userId, entry.date);
  const six = sixCategories(food);
  const goalFlags: string[] = [];
  // 這餐相對當日目標「已足夠、不要再建議增加」的類別：單餐達全天目標的 1/3 即視為足夠（目標 0 者一律列入）。
  // 「已有相當份數就不要再叫使用者多加」的定性說法壓不住小模型反射性的「多吃蔬菜」，
  // 必須由後端算好清單、在提示詞裡點名禁止。
  const enoughCats: string[] = [];
  for (const [sk, gk, name] of CAT_DEFS) {
    const eaten = six[sk];
    const g = goal.vals[gk] ?? 0;
    if (g === 0 && eaten > 0) {
      goalFlags.push(`${name}：目標設為 0 份（代表目標期間完全不攝取），但這餐攝取了 ${eaten} 份，請務必明確提醒`);
    } else if (g > 0 && eaten > g * 1.2) {
      goalFlags.push(`${name}：這餐 ${eaten} 份，單獨這一餐就超過「一整天」目標 ${g} 份的 120%，請提醒（即使這類食物一般認為健康也要提）`);
    }
    if (g === 0) {
      enoughCats.push(`${name}（目標 0 份，這段期間不攝取）`);
    } else if (eaten >= g / 3) {
      enoughCats.push(`${name}（這餐 ${eaten} 份，全天目標 ${g} 份，這一餐已足夠）`);
    }
  }

  // 純文字評語：只針對這一篇動態，用「敘述＋這餐份數＋餐期＋時間＋當日目標比對」評估
  // （不帶照片、不帶當天累計）。照片的資訊已在使用者記錄時經 AI 寫進敘述。
  const context =
    `這是使用者的「${mealName}」飲食紀錄（日期：${entry.date}${entry.eat_time ? `，用餐時間：${entry.eat_time}` : ''}）。\n` +
    `使用者的敘述：${entry.desc ? entry.desc : '（未填寫）'}\n` +
    `這餐已記錄的六大類份數：${foodSummaryZh(food)}（約 ${kcalOfFood(food)} 大卡）\n` +
    `使用者的當日六大類目標（一整天的量）：${goalSummaryZh(goal.vals)}\n` +
    `（注意：上列目標是「一整天」的總量，這餐只是其中一餐；單餐份數低於全天目標是完全正常的，不代表不足，絕對不要因此說某類不夠或建議補充。）\n` +
    (goalFlags.length
      ? `【與目標比對（系統已算好，請納入評語）】\n${goalFlags.map((f) => `・${f}`).join('\n')}\n`
      : `【與目標比對（系統已算好）】這餐各類份數與當日目標相比皆在合理範圍，不需特別與目標比較。\n`) +
    (enoughCats.length
      ? `【這餐已足夠的類別（系統已算好，禁止建議再增加這些類別）】${enoughCats.join('、')}\n`
      : '');

  const system =
    '你是一位親切、專業的營養師，正在均衡飲食日記 App 中回覆使用者的餐點紀錄。' +
    '請只針對「這一餐」評估：這餐吃了什麼（依使用者的敘述與份數）、六大類份數是否均衡、是哪一餐與用餐時間點。' +
    '例如：這餐某類偏多可溫和提醒、這餐「完全沒吃到（0 份）」的類別可建議下次補上——單餐低於全天目標不算缺，只有 0 份才算缺；' +
    '宵夜或太晚的正餐可溫和提醒時間點。' +
    '只根據使用者實際寫出的食材與份數評論，敘述中沒提到的食材不要憑菜名或刻板印象推測' +
    '（例如使用者列出的關東煮食材都是原形食物時，不要假設裡面有加工火鍋料；不要假設某道菜「通常」怎麼煮）。' +
    CATEGORY_LABEL_CAVEAT +
    '若提供了「與目標比對」的提醒，請把它自然地寫進評語：目標為 0 的類別代表使用者這段期間完全不攝取，這餐出現了就要明確提醒，' +
    '且不要先稱讚該食物再提醒（避免前後矛盾），直接溫和說明這段期間不攝取並給替代選項；' +
    '單獨一餐就超過一整天目標 120% 的類別也要提醒，即使那類食物一般認為健康。' +
    '提醒偏多的類別時，請用「減少份量」或「下次把部分Ａ換成Ｂ」的取代說法，明確講出取代關係；' +
    '取代對象只能挑【這餐已足夠的類別】清單以外、這餐份數很少或沒有的類別。' +
    '清單內的類別這餐已經夠了，絕對不要建議「補充」「多加」「增加種類」，任何說法都不行' +
    '（例如蔬菜在清單內時，不要寫「多加深綠色葉菜」「多一些生菜或鮮蔬」「增加蔬菜種類」——' +
    '「多吃蔬菜」是營養師最常見的反射式建議，蔬菜夠了就是夠了，不需要更多）。' +
    '除了系統列出的比對結果外，不要自行臆測一整天的累計或其他目標數字。' +
    '若未提供用餐時間，就不要臆測或編造用餐時間點（例如不要說「傍晚」「太晚」等）。' +
    '遇到甜點、含糖飲料、炸物等高糖高油的食物時，請溫和但明確：不要淡化這類食物的性質，' +
    '也不要用「提供了某某營養」替它找理由；要清楚傳達「偶爾享受沒問題，不適合常吃或取代正餐」，並給出具體的替代或搭配建議。' +
    '請用繁體中文、溫暖鼓勵的口吻寫一段 2～4 句的評語：確實有值得肯定之處再肯定，不要為了鼓勵而硬找優點或美化；' +
    '批評對事不對人，不要讓使用者因為誠實記錄而覺得被責備。接著給 1～2 個具體、好執行的小建議。' +
    '請直接寫評語內容，不要加標題或條列，不要逐項重複數字，總長度約 60～180 字。';

  // 評價當作依據：注入使用者過去讚／倒讚的偏好，讓這次回答貼近他的喜好
  const systemFull = system + preferenceHint(req.userId);

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
          { role: 'system', content: systemFull },
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

// ---- AI 今日總評（純文字：擷取當天所有動態＋六大類總份數＋熱量喝水＋身體數據＋當日目標，
//      產生一則整天綜合評語，存為當天一則「AI 動態」，本人與營養師皆可見；使用者按鈕才觸發）----
aiRouter.post('/daily', async (req, res) => {
  const parsed = aiDailySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { date } = parsed.data;

  const day = getDayJson(req.userId, date);
  const entries = day.entries.filter(
    (e) => e.desc || e.photos.length || FOOD_KEYS.some((k) => (e.food[k] || 0) > 0)
  );
  const hasEx = day.exLogs.length > 0;
  const hasBodyToday = !!bodyStrFrom(day.body);
  if (!entries.length && !(day.water > 0) && !hasEx && !hasBodyToday) {
    return res.status(400).json({ error: '這天還沒有任何紀錄，先記錄後再產生今日總評' });
  }

  // 當天六大類總份數（各餐加總）
  const dayTotal = emptyFood();
  for (const e of entries) for (const k of FOOD_KEYS) dayTotal[k] = round1(dayTotal[k] + (e.food[k] || 0));
  const goal = goalForDate(req.userId, date);

  const mealLines = entries.length
    ? entries
        .map((e) => {
          const mn = MEAL_NAMES[e.meal] || '這餐';
          const t = e.eatTime ? ` ${e.eatTime}` : '';
          const d = e.desc ? e.desc : '（未填敘述）';
          return `・${mn}${t}：${d}（${foodSummaryZh(e.food)}，約 ${kcalOfFood(e.food)} 大卡）`;
        })
        .join('\n')
    : '（今天沒有飲食紀錄）';
  const exStr = hasEx
    ? day.exLogs
        .map((l) => {
          const m = l.min && Number(l.min) > 0 ? `${l.min} 分鐘` : '';
          return `${m}${m && l.desc ? '・' : ''}${l.desc}${l.time ? `（${l.time}）` : ''}`;
        })
        .join('；')
    : '未記錄';
  const bodyStr = bodyLineFor(req.userId, date, day.body, day.bodyTime);

  const context =
    `以下是使用者在 ${date} 這一天的完整飲食與健康紀錄，請據此給出「一整天」的綜合總評。\n\n` +
    `【當天各餐】\n${mealLines}\n\n` +
    `【當天六大類總份數】${foodSummaryZh(dayTotal)}（全天約 ${kcalOfFood(dayTotal)} 大卡）\n` +
    `【當日六大類目標】${goalSummaryZh(goal.vals)}\n` +
    `【與目標比對（系統已算好，請直接採用，不要自行加減或臆測其他數字）】\n${dayGoalBreakdown(dayTotal, goal.vals).join('\n')}\n` +
    `【喝水】${day.water} / ${goal.water} ml（${waterGoalNote(day.water, goal.water)}）${
      day.waterLogs.length
        ? `（分 ${day.waterLogs.length} 次：${day.waterLogs.map((w) => `${w.time || '未填時間'} ${w.ml} ml`).join('、')}）`
        : ''
    }\n` +
    `【運動】${exStr}\n` +
    `【身體數據】${bodyStr}\n`;

  const system =
    '你是一位親切、專業的營養師，正在均衡飲食日記 App 中替使用者做「一整天」的飲食與健康總評。' +
    '請綜合當天所有餐點、六大類總份數與當日目標的達成情形、喝水量、運動、以及身體數據，給出整體評估。' +
    '只根據使用者實際寫出的食材與份數評論，敘述中沒提到的食材不要憑菜名或刻板印象推測（例如不要假設關東煮一定有加工火鍋料）。' +
    CATEGORY_LABEL_CAVEAT +
    '確實有值得肯定之處再肯定（不要為了鼓勵而硬找優點或美化），再指出 1～3 個最值得調整的重點（例如某類明顯超標或不足、水分不夠、太晚進食等），並給具體、好執行的建議。' +
    '若當天出現甜點、含糖飲料、炸物等高糖高油的食物，不要淡化其性質、不要替它們找營養上的理由，' +
    '更不要把這類食物描述成「健康」或「較健康的選擇」（例如不要因為甜點含有堅果或穀物就稱讚它健康）；' +
    '請溫和但明確地提醒頻率與份量的拿捏。' +
    '與目標的比對一律以「與目標比對」區塊的系統結果為準，不要自己重算或臆測其他數字：' +
    '目標為 0 的類別代表這段期間不應攝取，沒吃就是達成，絕對不要說成「低於目標」或「不足」，' +
    '吃了才要明確提醒；其餘類別再依系統標示的超標／不足／達標給建議：' +
    '「建議多吃某類食物」只能針對系統標示「明顯低於目標」的類別，' +
    '標示超標或大致達標的類別絕對不要建議再增加，任何說法都不行' +
    '（例如蔬菜已達標或超標時，不要寫「多吃蔬菜」「多加深綠色葉菜」「多一些生菜或鮮蔬」「增加蔬菜種類」——' +
    '「多吃蔬菜」是營養師最常見的反射式建議，蔬菜夠了就是夠了）。' +
    '同一個餐別（例如晚餐）可能分成多筆紀錄（分次吃或補記），每一筆都要分開納入考量，不要漏掉或混為一談。' +
    '身體數據若只有較早日期的紀錄，當作參考背景即可，不要當成今天的數字。' +
    '批評對事不對人，不要讓使用者因為誠實記錄而覺得被責備。' +
    '請用繁體中文、溫暖鼓勵的口吻，寫成通順的 3～5 句短文（約 120～250 字），直接寫內容，不要用標題或條列、不要逐項複述所有數字。';

  // 評價當作依據：注入使用者過去讚／倒讚的偏好，讓這份總評貼近他的喜好
  const systemFull = system + preferenceHint(req.userId);

  const chain = [COMMENT_MODEL, COMMENT_FALLBACK_MODEL];
  let lastError: unknown = null;
  for (const model of chain) {
    try {
      const text = await chat({
        model,
        temperature: 0.6,
        maxTokens: 700,
        messages: [
          { role: 'system', content: systemFull },
          { role: 'user', content: context },
        ],
      });
      const body = text.replace(/\s+$/, '').slice(0, 2000);
      upsertDailySummary(req.userId, date, body, model);
      return res.status(201).json(getDayJson(req.userId, date));
    } catch (e) {
      lastError = e;
      console.error(`ai daily attempt failed (${model}), trying next:`, e instanceof Error ? e.message : e);
    }
  }
  console.error('ai daily failed (all attempts):', lastError);
  return res.status(502).json({ error: 'AI 今日總評產生失敗，請稍後再試' });
});

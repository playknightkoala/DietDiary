// AI 身體數據評語：依量測歷程趨勢＋近三個月飲食攝取（每日熱量、三大營養素、六大類份數）
// ＋BMR/TDEE 給整體分析與建議。唯讀端點，不寫入任何資料；所有數字由後端算好成文字，
// 模型只需判讀引用，避免算錯。主模型用 31b（視覺模型的文字能力較佳），故障退 12b。
import { Router } from 'express';
import { db } from '../../db.js';
import { customItemsKcal, parseFood, parseItems, parsePhotoCustoms, type CustomItem, type Food } from '../../helpers.js';
import { FOOD_KEYS, aiBodySchema } from '../../validation.js';
import { COMMENT_MODEL, OCR_MODEL, chat } from '../../llm.js';
import { preferenceHint } from './comment.js';
import { CATEGORY_LABEL_CAVEAT, goalForDate, goalSummaryZh, kcalOfFood, macrosOf, round1, sixCategories, tdeeInfoFor } from './nutrition.js';

export const bodyRouter = Router();

const METRICS: [col: 'body_weight' | 'body_fat' | 'body_waist' | 'body_muscle' | 'body_fatkg', name: string, unit: string][] = [
  ['body_weight', '體重', 'kg'],
  ['body_fat', '體脂率', '%'],
  ['body_waist', '腰圍', 'cm'],
  ['body_muscle', '肌肉重', 'kg'],
  ['body_fatkg', '體脂重', 'kg'],
];

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const md = (date: string) => date.slice(5).replace('-', '/');

bodyRouter.post('/body', async (req, res) => {
  // date＝client 的「今天」：日記日期是 client 本地日，伺服器（UTC）時間在台灣 00:00–07:59
  // 會差一天，不能用 server 時間推；所有查詢一律以它為上限，歷程、攝取與 TDEE 才會一致
  const parsed = aiBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const today = parsed.data.date;

  // ---- 1) 量測歷程（今天含以前、最近 8 次，整理成舊→新；完全沒有量測就不產生）----
  // 取 8 次與視窗內趨勢圖「最近 8 次量測」一致，AI 引用的「整段變化」才不會跟圖對不上
  const rows = (
    db
      .prepare(
        `SELECT date, body_weight, body_fat, body_waist, body_muscle, body_fatkg FROM days
         WHERE user_id = ? AND date <= ?
           AND (body_weight != '' OR body_fat != '' OR body_waist != '' OR body_muscle != '' OR body_fatkg != '')
         ORDER BY date DESC LIMIT 8`
      )
      .all(req.userId, today) as Record<string, string>[]
  ).reverse();
  if (!rows.length) {
    return res.status(400).json({ error: '還沒有任何身體數據紀錄，先記錄一筆再產生 AI 評語' });
  }

  // 逐指標整理序列與變化（整段與最近一次的差都算好給模型引用）
  const trendLines: string[] = [];
  for (const [col, name, unit] of METRICS) {
    const pts = rows
      .map((r) => ({ date: r.date, v: parseFloat(r[col]) }))
      .filter((p) => isFinite(p.v));
    if (!pts.length) continue;
    const series = pts.map((p) => `${p.v}（${md(p.date)}）`).join('、');
    if (pts.length === 1) {
      trendLines.push(`・${name}：${series} ${unit}（只有一筆量測，看不出趨勢，請勿臆測變化方向）`);
    } else {
      const whole = round1(pts[pts.length - 1].v - pts[0].v);
      const last = round1(pts[pts.length - 1].v - pts[pts.length - 2].v);
      trendLines.push(`・${name}：${series} ${unit}；整段變化 ${signed(whole)} ${unit}、最近一次變化 ${signed(last)} ${unit}`);
    }
  }

  // ---- 2) 近三個月（90 天）飲食攝取：彙總成每週平均，避免提示詞爆量 ----
  // 以 client 的 today 當錨點做純日期運算（UTC 正午起算避免時區位移）
  const anchor = Date.parse(`${today}T12:00:00Z`);
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const since = iso(anchor - 89 * 86400000);
  const entryRows = db
    .prepare(`SELECT date, food, photo_customs, items FROM entries WHERE user_id = ? AND date >= ? AND date <= ?`)
    .all(req.userId, since, today) as { date: string; food: string; photo_customs: string; items: string }[];

  // 先彙總到「日」，再收斂到 7 天一桶（從今天往回數）
  type DayAgg = { kcal: number; carb: number; protein: number; fat: number; sugar: number; six: Record<string, number> };
  const byDay = new Map<string, DayAgg>();
  for (const r of entryRows) {
    const food = parseFood(r.food) as Food;
    const customs: CustomItem[] = [
      ...Object.values(parsePhotoCustoms(r.photo_customs ?? '{}')).flat(),
      ...parseItems(r.items ?? '[]').flatMap((it) => it.customItems),
    ];
    if (!FOOD_KEYS.some((k) => (food[k] || 0) > 0) && !customs.length) continue; // 空白紀錄不計
    const m = macrosOf(food, customs);
    const six = sixCategories(food);
    const agg = byDay.get(r.date) ?? { kcal: 0, carb: 0, protein: 0, fat: 0, sugar: 0, six: { protein: 0, veg: 0, grain: 0, oil: 0, fruit: 0, milk: 0 } };
    agg.kcal += kcalOfFood(food) + customItemsKcal(customs);
    agg.carb += m.carb;
    agg.protein += m.protein;
    agg.fat += m.fat;
    agg.sugar += m.sugar;
    for (const k of Object.keys(agg.six)) agg.six[k] += six[k as keyof typeof six];
    byDay.set(r.date, agg);
  }

  const WEEKS = 13;
  const buckets: { from: string; to: string; days: string[] }[] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const to = anchor - w * 7 * 86400000;
    const from = to - 6 * 86400000;
    buckets.push({ from: iso(from), to: iso(to), days: [] });
  }
  for (const date of byDay.keys()) {
    const b = buckets.find((x) => date >= x.from && date <= x.to);
    if (b) b.days.push(date);
  }
  const intakeLines = buckets
    .filter((b) => b.days.length)
    .map((b) => {
      const n = b.days.length;
      const sum = b.days.reduce(
        (a, d) => {
          const g = byDay.get(d)!;
          a.kcal += g.kcal; a.carb += g.carb; a.protein += g.protein; a.fat += g.fat; a.sugar += g.sugar;
          for (const k of Object.keys(a.six)) a.six[k] += g.six[k];
          return a;
        },
        { kcal: 0, carb: 0, protein: 0, fat: 0, sugar: 0, six: { protein: 0, veg: 0, grain: 0, oil: 0, fruit: 0, milk: 0 } as Record<string, number> }
      );
      const avg = (v: number) => round1(v / n);
      return (
        `・${md(b.from)}–${md(b.to)}（記錄 ${n} 天）：平均每日約 ${Math.round(sum.kcal / n)} 大卡；` +
        `三大營養素 醣類 ${avg(sum.carb)} 克／蛋白質 ${avg(sum.protein)} 克／脂質 ${avg(sum.fat)} 克` +
        (sum.sugar > 0 ? `（其中精緻糖 ${avg(sum.sugar)} 克）` : '') +
        `；六大類平均 蛋豆魚肉 ${avg(sum.six.protein)}、蔬菜 ${avg(sum.six.veg)}、全穀雜糧 ${avg(sum.six.grain)}、油脂堅果 ${avg(sum.six.oil)}、水果 ${avg(sum.six.fruit)}、乳品 ${avg(sum.six.milk)} 份`
      );
    });

  // ---- 3) BMR/TDEE 與體重目標（體重取今天含以前最近一次；基本資料不齊時照常生成，只是少了基準）----
  const tdeeInfo = tdeeInfoFor(req.userId, today, {});
  // 體重目標獨立取出：tdeeInfoFor 只在基本資料齊全且有填 goalKcal 時才會在文字中帶到目標，
  // 但「趨勢好壞」的判斷方向永遠需要它（選了減重／增重卻沒填 kcal 或資料不齊時也要讓模型知道）
  const goalRow = db
    .prepare('SELECT profile_goal, profile_goal_kcal FROM users WHERE id = ?')
    .get(req.userId) as { profile_goal: string; profile_goal_kcal: string } | undefined;
  const goalKcalNum = parseInt(goalRow?.profile_goal_kcal ?? '', 10);
  const goalLine =
    goalRow?.profile_goal === 'cut'
      ? `減重${isFinite(goalKcalNum) && goalKcalNum > 0 ? `（每日目標減少 ${goalKcalNum} 大卡）` : '（未設定每日減少量）'}`
      : goalRow?.profile_goal === 'gain'
        ? `增重${isFinite(goalKcalNum) && goalKcalNum > 0 ? `（每日目標增加 ${goalKcalNum} 大卡）` : '（未設定每日增加量）'}`
        : '一般（未特別設定減重或增重）';
  // 目前適用的六大類目標（營養師可能設了特殊目標，如某類 0 份）：給模型當建議基準，避免與目標衝突
  const goal = goalForDate(req.userId, today);

  const context =
    `以下是這位使用者的身體數據量測歷程（最近 ${rows.length} 次，舊 → 新）與近三個月的飲食攝取摘要，` +
    `請據此分析目前的身體狀況趨勢並給建議。\n\n` +
    `【身體數據歷程（數值與變化都已由系統算好，請直接引用、不要自行重算）】\n${trendLines.join('\n')}\n\n` +
    `【近三個月飲食攝取（每週平均；只統計有記錄的天數）】\n${intakeLines.length ? intakeLines.join('\n') : '（近三個月沒有飲食紀錄）'}\n\n` +
    `【體重目標】${goalLine}\n` +
    `【目前的六大類每日目標】${goalSummaryZh(goal.vals)}（目標為 0 的類別代表這段期間不攝取；請以此為建議基準，不要給與目標衝突的建議）\n` +
    `【每日消耗量】${tdeeInfo ? tdeeInfo.line : '使用者尚未設定 BMR/TDEE 基本資料，無法估算每日消耗，請勿臆測具體數字'}\n`;

  const system =
    '你是一位親切、專業的營養師，正在均衡飲食日記 App 中替使用者分析「身體數據的歷程趨勢」。' +
    '請綜合：各項身體指標的變化方向、近三個月的平均攝取熱量與三大營養素／六大類份數、以及 BMR/TDEE，' +
    '判讀目前趨勢並說明可能的飲食關聯（例如平均攝取相對目標攝取的落差）。' +
    '所有數字系統都已算好，請直接引用，不要自行加減或推算新數字；沒有提供的數據不要編造，' +
    '只有一筆量測的指標不要臆測趨勢。' +
    '趨勢方向的好壞要看使用者的體重目標：減重目標時體重／體脂下降是進步，增重目標時上升才是進步；' +
    '未設定目標則以體脂率下降、肌肉重上升視為正向。' +
    '若趨勢是好的：先明確肯定使用者的成果，再給 1～2 個更精進的具體建議（不要潑冷水）；' +
    '若趨勢停滯或往反方向：溫和指出最可能的原因與 1～2 個具體、好執行的調整，不要責備。' +
    CATEGORY_LABEL_CAVEAT +
    '請用繁體中文、溫暖鼓勵的口吻，寫成通順的 3～6 句短文（約 150～300 字），直接寫內容，不要標題或條列。';

  // 與單餐評語／今日總評相同：注入使用者過去讚／倒讚的風格偏好
  const systemFull = system + preferenceHint(req.userId);

  // 主模型 31b（使用者指定；文字判讀較佳）、故障退 12b；回傳實際使用的模型供前端標示
  const chain = [OCR_MODEL, COMMENT_MODEL];
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
      return res.json({ comment: text.replace(/\s+$/, '').slice(0, 2000), model });
    } catch (e) {
      lastError = e;
      console.error(`ai body comment attempt failed (${model}), trying next:`, e instanceof Error ? e.message : e);
    }
  }
  console.error('ai body comment failed (all attempts):', lastError);
  return res.status(502).json({ error: 'AI 評語產生失敗，請稍後再試' });
});

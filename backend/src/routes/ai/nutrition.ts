// AI 提示詞用的營養計算與資料摘要：六大類份數／熱量／三大營養素、當日目標比對、
// 身體數據行、BMR/TDEE。全部由後端算好成文字讓模型引用，避免小模型算錯數字。
// 拆自原 routes/ai.ts。
import { db } from '../../db.js';
import { FOOD_KEYS } from '../../validation.js';
import type { CustomItem, Food } from '../../helpers.js';

// 六大類的每份熱量（與前端 domain.KCAL 一致），供計算與提示詞使用
const KCAL: Record<string, number> = {
  meatLow: 55, meatMed: 75, meatHigh: 120, meatXHigh: 135,
  veg: 25, grain: 70, oil: 45, fruit: 60,
  milkSkim: 80, milkLow: 120, milkFull: 150,
};

// 每份三大營養素公克數 [醣類, 蛋白質, 脂肪]（與前端 domain.MACROS 一致——改任一邊要同步改另一邊）
const MACROS: Record<string, [number, number, number]> = {
  meatLow: [0, 7, 3], meatMed: [0, 7, 5], meatHigh: [0, 7, 10], meatXHigh: [0, 7, 10],
  veg: [5, 1, 0], grain: [15, 2, 0], oil: [0, 0, 5], fruit: [15, 0, 0],
  milkSkim: [12, 8, 0], milkLow: [12, 8, 4], milkFull: [12, 8, 8],
};

// 三大營養素（公克）：六大類份數×每份營養素＋自定義項目（糖→醣類且另計精緻糖、蛋白質→蛋白質；
// 酒精與自訂項目無法歸類，只計熱量）
export function macrosOf(food: Food, customs: CustomItem[]) {
  let carb = 0;
  let protein = 0;
  let fat = 0;
  let sugar = 0;
  for (const k of FOOD_KEYS) {
    const n = food[k] || 0;
    const m = MACROS[k] ?? [0, 0, 0];
    carb += n * m[0];
    protein += n * m[1];
    fat += n * m[2];
  }
  for (const it of customs) {
    if (it.type === 'sugar') sugar += it.amount ?? 0;
    else if (it.type === 'protein') protein += it.amount ?? 0;
  }
  return { carb: round1(carb + sugar), protein: round1(protein), fat: round1(fat), sugar: round1(sugar) };
}

export function macrosZh(m: ReturnType<typeof macrosOf>): string {
  return `醣類 ${m.carb} 克、蛋白質 ${m.protein} 克、脂質 ${m.fat} 克${m.sugar > 0 ? `（其中精緻糖 ${m.sugar} 克）` : ''}`;
}

// 把細分份數收斂成六大類總份數（蛋豆魚肉、乳品各自加總）
export function sixCategories(food: Food) {
  return {
    protein: round1(food.meatLow + food.meatMed + food.meatHigh + food.meatXHigh),
    veg: round1(food.veg),
    grain: round1(food.grain),
    oil: round1(food.oil),
    fruit: round1(food.fruit),
    milk: round1(food.milkSkim + food.milkLow + food.milkFull),
  };
}

export function round1(n: number): number {
  return Math.round((n || 0) * 10) / 10;
}

// 六大類：sixCategories 的鍵、目標 vals 的鍵、中文名稱
export const CAT_DEFS: [keyof ReturnType<typeof sixCategories>, string, string][] = [
  ['protein', 'meat', '蛋豆魚肉'], ['veg', 'veg', '蔬菜'], ['grain', 'grain', '全穀雜糧'],
  ['oil', 'oil', '油脂堅果'], ['fruit', 'fruit', '水果'], ['milk', 'milk', '乳品'],
];

// 六大類名稱只是「食物代換表」的分類代稱，不等於健康與否：例如炸雞皮、餅乾、蛋糕都可能被歸到「全穀雜糧」，
// 炸物的油、糕點的糖也會被歸到「油脂堅果」。健不健康要看使用者敘述裡「實際吃的東西」，不能因為落在某個
// 分類就當成健康食材；敘述沒寫清楚時就不要憑分類名稱腦補是健康版本。共用給評語與今日總評的提示詞。
export const CATEGORY_LABEL_CAVEAT =
  '注意：六大類（全穀雜糧、油脂堅果等）只是「食物代換表」的分類代稱，不代表健康與否——' +
  '例如炸雞皮、餅乾、蛋糕也會被歸為全穀雜糧，糕點與炸物的油糖也會落在油脂堅果。' +
  '請依使用者敘述裡「實際吃的東西」判斷健不健康，不要因為某類份數多就當成吃得健康而稱讚；' +
  '敘述沒有寫清楚是什麼時，就不要憑分類名稱假設它是健康的版本。';

export function clampPortion(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!isFinite(v) || v < 0) return 0;
  return round1(Math.min(v, 99));
}

export function foodSummaryZh(food: Food): string {
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

export function kcalOfFood(food: Food): number {
  return Math.round(FOOD_KEYS.reduce((a, k) => a + (food[k] || 0) * (KCAL[k] || 0), 0));
}

// 自定義熱量項目的中文摘要，供提示詞使用：糖 10 公克（40 大卡）、珍珠奶茶（250 大卡）
const CUSTOM_ITEM_LABEL: Record<string, [string, string]> = {
  sugar: ['糖', '公克'], alcohol: ['酒精', '毫升'], protein: ['蛋白質', '公克'],
};
export function customItemsZh(items: CustomItem[]): string {
  // 極端多項時截斷，避免提示詞爆量（每張照片與每個項目頁都可掛自定義清單）
  const MAX_ZH = 30;
  const shown = items.slice(0, MAX_ZH);
  const text = shown
    .map((it) => {
      const def = CUSTOM_ITEM_LABEL[it.type];
      if (def) return `${def[0]} ${it.amount ?? 0} ${def[1]}（${it.kcal} 大卡）`;
      return `${it.name || '自定義項目'}（${it.kcal} 大卡）`;
    })
    .join('、');
  return items.length > MAX_ZH ? `${text}…等 ${items.length} 項` : text;
}

// ---- 今日總評用：目標與身體數據 ----

// 未設定目標時的預設每日份數與喝水量（與前端 domain 一致）
const DEFAULT_GOAL_VALS = { meat: 7, veg: 3, grain: 10, oil: 3, fruit: 2, milk: 2 };
const DEFAULT_WATER = 2000;

// 該日期適用的目標（六大類份數＋喝水；多組重疊取最新一組，無涵蓋用預設）
export function goalForDate(userId: number, date: string): { vals: Record<string, number>; water: number } {
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

export function goalSummaryZh(vals: Record<string, number>): string {
  return `蛋豆魚肉 ${vals.meat} 份、蔬菜 ${vals.veg} 份、全穀雜糧 ${vals.grain} 份、油脂堅果 ${vals.oil} 份、水果 ${vals.fruit} 份、乳品 ${vals.milk} 份`;
}

// 今日總評用：整天六大類實際 vs 目標的比對（後端算好，避免小模型算錯或憑空說「低於目標」）。
// 逐類給明確狀態，特別處理「目標 0」：目標 0＝這段期間不應攝取，吃了才要提醒，沒吃就是達成，
// 絕不能說成「低於目標／不足」。回傳每一類一行文字。
export function dayGoalBreakdown(dayTotal: Food, vals: Record<string, number>): string[] {
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
export function waterGoalNote(water: number, goalWater: number): string {
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

export function bodyStrFrom(b: Record<string, string>): string {
  return BODY_LABELS.filter(([k]) => (b[k] ?? '') !== '').map(([k, n, u]) => `${n} ${b[k]} ${u}`).join('、');
}

// ---- 每日消耗量（BMR/TDEE）----
// 活動量係數與 BMR 公式（Mifflin-St Jeor）與前端 domain.ts 的 ACTIVITY_DEFS / bmrOf 一致——改任一邊要同步改另一邊
const ACTIVITY_FACTORS: Record<string, [factor: number, name: string]> = {
  sedentary: [1.2, '無活動（久坐）'], light: [1.375, '輕量活動'], moderate: [1.55, '中度活動'],
  high: [1.725, '高度活動'], veryhigh: [1.9, '非常高度活動'],
};

// 使用者的每日消耗量資訊：today 總評用。基本資料不齊或完全沒有體重紀錄時回 null。
// 體重取 date 當天，否則取 date 之前最近一次（與身體數據行的邏輯一致）。
// 比較一律由後端算好成文字，模型只需引用，避免小模型算錯數字。
export function tdeeInfoFor(
  userId: number,
  date: string,
  dayBody: Record<string, string>
): { line: string; target: number } | null {
  const u = db
    .prepare(
      'SELECT profile_height, profile_birth_year, profile_gender, profile_activity, profile_goal, profile_goal_kcal FROM users WHERE id = ?'
    )
    .get(userId) as
    | { profile_height: string; profile_birth_year: string; profile_gender: string; profile_activity: string; profile_goal: string; profile_goal_kcal: string }
    | undefined;
  if (!u) return null;
  const act = ACTIVITY_FACTORS[u.profile_activity];
  const height = parseFloat(u.profile_height);
  const birthYear = parseInt(u.profile_birth_year, 10);
  if (!act || !isFinite(height) || !isFinite(birthYear) || (u.profile_gender !== 'male' && u.profile_gender !== 'female')) {
    return null;
  }
  let weight = parseFloat(dayBody.weight);
  if (!isFinite(weight)) {
    const row = db
      .prepare(`SELECT body_weight FROM days WHERE user_id = ? AND date <= ? AND body_weight != '' ORDER BY date DESC LIMIT 1`)
      .get(userId, date) as { body_weight: string } | undefined;
    weight = row ? parseFloat(row.body_weight) : NaN;
  }
  if (!isFinite(weight)) return null;

  const age = Number(date.slice(0, 4)) - birthYear;
  const bmr = Math.round(9.99 * weight + 6.25 * height - 4.92 * age + (166 * (u.profile_gender === 'male' ? 1 : 0) - 161));
  const base = Math.round(bmr * act[0]);
  const goalKcal = parseInt(u.profile_goal_kcal, 10);
  const adj = (u.profile_goal === 'cut' || u.profile_goal === 'gain') && isFinite(goalKcal) && goalKcal > 0
    ? (u.profile_goal === 'cut' ? -goalKcal : goalKcal)
    : 0;
  const target = base + adj;
  let line = `基礎代謝（BMR）約 ${bmr} 大卡、每日總消耗（TDEE，活動量：${act[1]}）約 ${base} 大卡`;
  if (adj !== 0) {
    line += `；使用者的體重目標為${adj < 0 ? '減重' : '增重'}（每日${adj < 0 ? '減少' : '增加'} ${Math.abs(adj)} 大卡），因此目標攝取約 ${target} 大卡`;
  } else {
    line += `；目標攝取約 ${target} 大卡`;
  }
  return { line, target };
}

// 當日總攝取 vs 目標攝取的比較（後端算好；±10% 內視為接近）
export function kcalVsTargetZh(eaten: number, target: number): string {
  const diff = eaten - target;
  if (Math.abs(diff) <= target * 0.1) return `今天總攝取約 ${eaten} 大卡，與目標攝取相近，大致合適`;
  if (diff > 0) return `今天總攝取約 ${eaten} 大卡，超過目標攝取約 ${diff} 大卡`;
  return `今天總攝取約 ${eaten} 大卡，低於目標攝取約 ${-diff} 大卡`;
}

// 身體數據：優先用當天，否則找 date 當天或之前「最近一次」有量測的紀錄（都沒有回 '未記錄'）
export function bodyLineFor(userId: number, date: string, dayBody: Record<string, string>, dayBodyTime: string): string {
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

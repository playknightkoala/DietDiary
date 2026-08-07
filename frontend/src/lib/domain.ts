import type { ActivityKey, BodyKey, CustomItem, CustomItemType, DayData, Entry, EntryFoodItem, EntryOrig, Food, FoodKey, Goal, GoalKey, MealKey, Profile } from '../types';

// 每份熱量（kcal/份）— 與原型 Component.KCAL 一致
export const KCAL: Record<FoodKey, number> = {
  meatLow: 55, meatMed: 75, meatHigh: 120, meatXHigh: 135,
  veg: 25, grain: 70, oil: 45, fruit: 60,
  milkSkim: 80, milkLow: 120, milkFull: 150,
};

// 自定義熱量項目的換算係數（大卡/公克或毫升）。
// 與後端 validation.CUSTOM_KCAL_FACTOR 重複宣告，改任一邊要同步改另一邊（同 KCAL 的 gotcha）
export const CUSTOM_KCAL_FACTOR: Partial<Record<CustomItemType, number>> = {
  sugar: 4, alcohol: 7, protein: 4,
};

// 自定義項目類型的顯示定義：custom 自填名稱＋大卡；其餘輸入重量、大卡由係數換算
export const CUSTOM_ITEM_DEFS: { k: CustomItemType; label: string; unit: string; hint: string }[] = [
  { k: 'custom', label: '自定義', unit: '', hint: '' },
  { k: 'sugar', label: '糖', unit: '公克', hint: '1公克糖=4大卡=0.2顆方糖' },
  { k: 'alcohol', label: '酒精', unit: '毫升', hint: '1毫升酒精=7大卡' },
  { k: 'protein', label: '蛋白質', unit: '公克', hint: '1公克蛋白質=4大卡' },
];

export const DEFAULT_GOALS: Record<GoalKey, number> = {
  meat: 7, veg: 3, grain: 10, oil: 3, fruit: 2, milk: 2,
};

// 每份三大營養素（公克）— 衛福部食物代換表，與 KCAL 同源；「微量」「-」以 0 計，
// 超高脂的脂肪以 10 克計（同 KCAL 以 135 大卡計的口徑）
export const MACROS: Record<FoodKey, { carb: number; protein: number; fat: number }> = {
  meatLow: { carb: 0, protein: 7, fat: 3 },
  meatMed: { carb: 0, protein: 7, fat: 5 },
  meatHigh: { carb: 0, protein: 7, fat: 10 },
  meatXHigh: { carb: 0, protein: 7, fat: 10 },
  veg: { carb: 5, protein: 1, fat: 0 },
  grain: { carb: 15, protein: 2, fat: 0 },
  oil: { carb: 0, protein: 0, fat: 5 },
  fruit: { carb: 15, protein: 0, fat: 0 },
  milkSkim: { carb: 12, protein: 8, fat: 0 },
  milkLow: { carb: 12, protein: 8, fat: 4 },
  milkFull: { carb: 12, protein: 8, fat: 8 },
};

export const DEFAULT_WATER = 2000;

export interface MealDef {
  k: MealKey;
  name: string;
  glyph: string;
  tint: string;
  color: string;
}

export const MEALS: MealDef[] = [
  { k: 'breakfast', name: '早餐', glyph: '早', tint: '#F1E8D2', color: '#A8842E' },
  { k: 'lunch', name: '午餐', glyph: '午', tint: '#E3EBD9', color: '#4A7C59' },
  { k: 'dinner', name: '晚餐', glyph: '晚', tint: '#E5EBF1', color: '#5B8DB8' },
  { k: 'night', name: '宵夜', glyph: '宵', tint: '#F5E3DB', color: '#C0564A' },
  { k: 'snack', name: '點心', glyph: '點', tint: '#F6E5E9', color: '#B5537A' },
];

export const BODY_DEFS: { k: BodyKey; name: string; unit: string }[] = [
  { k: 'weight', name: '體重', unit: 'kg' },
  { k: 'fat', name: '體脂率', unit: '%' },
  { k: 'waist', name: '腰圍', unit: 'cm' },
  { k: 'muscle', name: '肌肉重', unit: 'kg' },
  { k: 'fatkg', name: '體脂重', unit: 'kg' },
];

// TDEE 活動量：TDEE＝BMR×係數
export const ACTIVITY_DEFS: { k: ActivityKey; name: string; desc: string; factor: number }[] = [
  { k: 'sedentary', name: '無活動', desc: '久坐', factor: 1.2 },
  { k: 'light', name: '輕量活動', desc: '每週輕鬆運動 1～3 天', factor: 1.375 },
  { k: 'moderate', name: '中度活動', desc: '站走稍多、每週中強度運動 3～5 天', factor: 1.55 },
  { k: 'high', name: '高度活動', desc: '站走為主、每週高強度運動 6～7 天', factor: 1.725 },
  { k: 'veryhigh', name: '非常高度活動', desc: '幾乎整天高強度運動或勞力型工作', factor: 1.9 },
];

// BMR（Mifflin-St Jeor）：9.99×體重＋6.25×身高－4.92×年齡＋（166×性別－161），性別男＝1、女＝0
export function bmrOf(gender: 'male' | 'female', weightKg: number, heightCm: number, age: number): number {
  return 9.99 * weightKg + 6.25 * heightCm - 4.92 * age + (166 * (gender === 'male' ? 1 : 0) - 161);
}

// BMR／TDEE：以 TDEE 基本資料＋最近一次體重計算，資料不齊回傳 null；
// TDEE 含體重目標調整（減重－goalKcal、增重＋goalKcal、一般不調整）。
// 身體數據卡與今日攝取熱量卡共用。
export function bmrTdeeOf(profile: Profile | null): { bmr: number | null; tdee: number | null } {
  const act = profile ? ACTIVITY_DEFS.find((a) => a.k === profile.activity) : undefined;
  const age = profile && profile.birthYear !== '' ? new Date().getFullYear() - Number(profile.birthYear) : null;
  if (!profile || profile.height === '' || age === null || profile.gender === '' || !act || !profile.weight)
    return { bmr: null, tdee: null };
  const bmr = Math.round(bmrOf(profile.gender, profile.weight.value, Number(profile.height), age));
  const goalAdj =
    profile.goal !== 'normal' && profile.goalKcal !== '' && isFinite(Number(profile.goalKcal))
      ? (profile.goal === 'cut' ? -1 : 1) * Number(profile.goalKcal)
      : 0;
  const tdee = Math.round(bmr * act.factor) + goalAdj;
  // 減重目標設得比 TDEE 還大時會算出 0 或負值：不是有意義的目標，各卡片一律顯示未設定
  return { bmr, tdee: tdee > 0 ? tdee : null };
}

export const FOOD_KEYS = Object.keys(KCAL) as FoodKey[];

export function emptyFood(): Food {
  return {
    meatLow: 0, meatMed: 0, meatHigh: 0, meatXHigh: 0,
    veg: 0, grain: 0, oil: 0, fruit: 0,
    milkSkim: 0, milkLow: 0, milkFull: 0,
  };
}

export function emptyDay(): DayData {
  return {
    water: 0,
    waterTime: '',
    waterLogs: [],
    exLogs: [],
    body: { weight: '', fat: '', waist: '', muscle: '', fatkg: '' },
    bodyTime: '',
    entries: [],
    aiSummary: null,
  };
}

// 目前時刻 HH:MM（新增飲食紀錄的預設用餐時間）
export function nowHM(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// 留言時間顯示：M/D HH:MM
export function fmtCommentTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 動態牆排序：新→舊（有時間的在前、依時間倒序；沒填時間的墊後、依建立順序倒序）
export function sortEntriesNewestFirst(entries: Entry[]): Entry[] {
  return entries.slice().sort((a, b) => {
    if (a.eatTime && b.eatTime) return b.eatTime.localeCompare(a.eatTime) || b.id - a.id;
    if (a.eatTime !== b.eatTime) return a.eatTime ? -1 : 1;
    return b.id - a.id;
  });
}

// 整筆的自定義項目彙總（照片綁定＋無照片項目），供顯示、熱量與 marker 判斷
export function entryAllCustoms(e: {
  photoCustoms: Partial<Record<string, CustomItem[]>>;
  items: EntryFoodItem[];
}): CustomItem[] {
  return [
    ...Object.values(e.photoCustoms).flatMap((list) => list ?? []),
    ...e.items.flatMap((it) => it.customItems),
  ];
}

export function entryHasData(e: {
  desc: string;
  photos: string[];
  food: Food;
  photoCustoms: Partial<Record<string, CustomItem[]>>;
  items: EntryFoodItem[];
}): boolean {
  return !!(e.desc || e.photos.length || Object.values(e.food).some((v) => v > 0) || entryAllCustoms(e).length);
}

// 月曆亮燈判斷，規則必須與後端 getMarkedDates 一致：
// 喝水>0、任一筆運動有分鐘或敘述、任一身體欄位非空、任一 entry 有內容；
// 空白 entry（剛新增未填）與 AI 總評不亮燈。
export function dayHasData(day: DayData): boolean {
  const hasBody = Object.values(day.body).some((v) => v !== '');
  const hasEx = day.exLogs.some((l) => (Number(l.min) || 0) > 0 || l.desc !== '');
  return day.water > 0 || hasEx || hasBody || day.entries.some(entryHasData);
}

export function dayFoodTotals(entries: Entry[]): Food {
  const tot = emptyFood();
  entries.forEach((e) => {
    FOOD_KEYS.forEach((k) => (tot[k] += e.food[k] || 0));
  });
  return tot;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 份數 clamp：<0→0、>99→99、四捨五入到小數 1 位
export function clampPortion(v: string | number | null): number {
  if (v === '' || v === null) return 0;
  let n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n) || n < 0) n = 0;
  if (n > 99) n = 99;
  return round1(n);
}

export function kcalOfFood(f: Food): number {
  return Math.round(FOOD_KEYS.reduce((a, k) => a + (f[k] || 0) * KCAL[k], 0));
}

// 大卡 clamp：0–9999 整數（自定義項目直接輸入大卡用）
export function clampKcal(v: string | number | null): number {
  if (v === '' || v === null) return 0;
  let n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n) || n < 0) n = 0;
  if (n > 9999) n = 9999;
  return Math.round(n);
}

// 重量 clamp：0–9999、一位小數（糖/酒精/蛋白質的公克或毫升）
export function clampAmount(v: string | number | null): number {
  if (v === '' || v === null) return 0;
  let n = typeof v === 'number' ? v : parseFloat(v);
  if (isNaN(n) || n < 0) n = 0;
  if (n > 9999) n = 9999;
  return round1(n);
}

export function customItemsKcal(items: CustomItem[]): number {
  return Math.round(items.reduce((a, it) => a + (it.kcal || 0), 0));
}

// 一筆紀錄的總熱量＝六大類份數熱量（food 已含照片＋items 的總和）＋所有自定義項目熱量
export function entryKcal(e: Pick<Entry, 'food' | 'photoCustoms' | 'items'>): number {
  return kcalOfFood(e.food) + customItemsKcal(entryAllCustoms(e));
}

// 原始資料快照的彙總（顯示「調整前」用）：份數以快照的 food 總和為準（含 legacy 整筆份數）、
// 自定義＝照片綁定＋無照片項目，熱量口徑與 entryKcal 相同
export function origTotals(o: EntryOrig): { food: Food; customs: CustomItem[]; kcal: number } {
  const customs = entryAllCustoms(o);
  return { food: o.food, customs, kcal: kcalOfFood(o.food) + customItemsKcal(customs) };
}

// 當日自定義熱量總和（今日攝取熱量卡用）
export function dayCustomKcal(entries: Entry[]): number {
  return entries.reduce((a, e) => a + customItemsKcal(entryAllCustoms(e)), 0);
}

export interface Macros {
  carb: number;
  protein: number;
  fat: number;
  sugar: number; // 精緻糖（自定義「糖」項目），已含在 carb 內
}

// 三大營養素（公克，未四捨五入）：六大類份數 × 每份營養素，
// 再加自定義項目（糖→醣類且另計精緻糖、蛋白質→蛋白質；酒精與自訂項目無法歸類，只計熱量不計營養素）
function macrosRaw(food: Food, customs: CustomItem[]): Macros {
  let carb = 0;
  let protein = 0;
  let fat = 0;
  for (const k of FOOD_KEYS) {
    const n = food[k] || 0;
    carb += n * MACROS[k].carb;
    protein += n * MACROS[k].protein;
    fat += n * MACROS[k].fat;
  }
  let sugar = 0;
  for (const it of customs) {
    if (it.type === 'sugar') sugar += it.amount ?? 0;
    else if (it.type === 'protein') protein += it.amount ?? 0;
  }
  return { carb: carb + sugar, protein, fat, sugar };
}

// 一筆紀錄的三大營養素（貼文顯示用）
export function entryMacros(e: Pick<Entry, 'food' | 'photoCustoms' | 'items'>): Macros {
  const m = macrosRaw(e.food, entryAllCustoms(e));
  return { carb: round1(m.carb), protein: round1(m.protein), fat: round1(m.fat), sugar: round1(m.sugar) };
}

// 當日三大營養素攝取（主頁卡片用；逐筆累計後才四捨五入，避免逐筆進位誤差）
export function dayMacros(entries: Entry[]): Macros {
  const tot = entries.reduce(
    (a, e) => {
      const m = macrosRaw(e.food, entryAllCustoms(e));
      return { carb: a.carb + m.carb, protein: a.protein + m.protein, fat: a.fat + m.fat, sugar: a.sugar + m.sugar };
    },
    { carb: 0, protein: 0, fat: 0, sugar: 0 }
  );
  return { carb: round1(tot.carb), protein: round1(tot.protein), fat: round1(tot.fat), sugar: round1(tot.sugar) };
}

// 自定義項目的顯示標籤：預設類型用類型名稱，custom 用使用者輸入的名稱
export function customItemLabel(it: CustomItem): string {
  if (it.type === 'custom') return it.name || '自定義項目';
  const def = CUSTOM_ITEM_DEFS.find((d) => d.k === it.type);
  return def ? `${def.label} ${it.amount ?? 0}${def.unit === '毫升' ? 'ml' : 'g'}` : it.name;
}

// ---- 自定義項目的輸入草稿（記錄視窗與營養師編輯共用；字串輸入，儲存時才轉 CustomItem）----

export interface CustomDraft {
  type: CustomItemType;
  name: string;
  amountStr: string;
  kcalStr: string;
}

export const MAX_CUSTOM_ITEMS = 20;

// 一列草稿的即時熱量：預設類型由重量×係數換算；custom 直接取輸入的大卡
export function customDraftKcal(d: CustomDraft): number {
  const factor = CUSTOM_KCAL_FACTOR[d.type];
  return factor ? Math.round(clampAmount(d.amountStr) * factor) : clampKcal(d.kcalStr);
}

export function customDraftsKcal(drafts: CustomDraft[]): number {
  return drafts.reduce((a, d) => a + customDraftKcal(d), 0);
}

export function customItemsToDrafts(items: CustomItem[]): CustomDraft[] {
  return items.map((it) => ({
    type: it.type,
    name: it.name,
    amountStr: it.amount ? String(it.amount) : '',
    kcalStr: it.kcal ? String(it.kcal) : '',
  }));
}

// 草稿 → CustomItem：夾限並去除全空白的列（後端也會再正規化一次）
export function customDraftsToItems(drafts: CustomDraft[]): CustomItem[] {
  return drafts
    .map((d) => {
      const factor = CUSTOM_KCAL_FACTOR[d.type];
      return {
        type: d.type,
        name: d.type === 'custom' ? d.name.trim().slice(0, 50) : '',
        amount: factor ? clampAmount(d.amountStr) : null,
        kcal: customDraftKcal(d),
      };
    })
    .filter((it) => it.name || it.kcal > 0 || (it.amount ?? 0) > 0);
}

// 多張照片份數加總（一位小數，避免浮點誤差；與後端邏輯一致）
export function sumFoods(foods: Food[]): Food {
  const total = emptyFood();
  for (const f of foods) {
    for (const k of FOOD_KEYS) total[k] = Math.round((total[k] + (f[k] || 0)) * 10) / 10;
  }
  return total;
}

// 各份數欄位的顯示名稱（照片份數摘要用）
export const FOOD_KEY_NAMES: Record<FoodKey, string> = {
  meatLow: '蛋豆魚肉（低脂）', meatMed: '蛋豆魚肉（中脂）', meatHigh: '蛋豆魚肉（高脂）', meatXHigh: '蛋豆魚肉（超高脂）',
  veg: '蔬菜', grain: '全穀雜糧', oil: '油脂堅果', fruit: '水果',
  milkSkim: '乳品（脫脂）', milkLow: '乳品（低脂）', milkFull: '乳品（全脂）',
};

// 一張照片份數的文字摘要：「蔬菜 1、全穀雜糧 2」；全為 0 回傳空字串
export function foodSummary(f: Food): string {
  return FOOD_KEYS.filter((k) => (f[k] || 0) > 0)
    .map((k) => `${FOOD_KEY_NAMES[k]} ${f[k]}`)
    .join('、');
}

// 一張照片實際歸屬的份數：優先用逐張份數；
// 舊資料（僅整筆 food、無任何逐張份數、也沒有 items）視為記在第一張——與記錄視窗的相容邏輯一致。
// items 非空時整筆 food 含 items 的份數，不可再掛到照片上（會把 items 的份數誤顯示成照片的）
export function photoFoodOf(
  entry: Pick<Entry, 'photos' | 'photoFoods' | 'food' | 'items'>,
  url: string
): Food | null {
  const own = entry.photoFoods[url];
  if (own && FOOD_KEYS.some((k) => (own[k] || 0) > 0)) return own;
  const anyPerPhoto = entry.photos.some((u) => FOOD_KEYS.some((k) => (entry.photoFoods[u]?.[k] ?? 0) > 0));
  if (!anyPerPhoto && !entry.items.length && entry.photos[0] === url && FOOD_KEYS.some((k) => (entry.food[k] || 0) > 0)) {
    return entry.food;
  }
  return null;
}

// 日期 key 落在某組目標區間內用該組值（多組重疊時取最新建立的一組），否則用預設
export function goalsFor(
  key: string,
  goals: Goal[] | null
): { vals: Record<GoalKey, number>; water: number; custom: boolean; setBy: 'self' | 'dietitian' | null } {
  const hit = (goals ?? [])
    .filter((g) => g.start && g.end && key >= g.start && key <= g.end)
    .sort((a, b) => b.id - a.id)[0];
  if (hit) {
    // 目標喝水 0 須保留（?? 而非 ||，否則 0 會被塌回預設 2000）
    return { vals: hit.vals, water: hit.water ?? DEFAULT_WATER, custom: true, setBy: hit.setBy };
  }
  return { vals: DEFAULT_GOALS, water: DEFAULT_WATER, custom: false, setBy: null };
}

export function dstr(d: Date): string {
  return (
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  );
}

export function dparse(s: string): Date {
  const p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

export function addDays(s: string, n: number): string {
  const d = dparse(s);
  d.setDate(d.getDate() + n);
  return dstr(d);
}

// 週一為一週起始，回傳該週 7 天的 key
export function weekOf(anchor: string): string[] {
  const a = dparse(anchor);
  const monday = new Date(a);
  monday.setDate(a.getDate() - ((a.getDay() + 6) % 7));
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    days.push(dstr(dd));
  }
  return days;
}

export const WD_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

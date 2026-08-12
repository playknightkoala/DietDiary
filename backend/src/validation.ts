import { z } from 'zod';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 用餐時間 HH:MM（24 小時制），空字串＝未填
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const FOOD_KEYS = [
  'meatLow', 'meatMed', 'meatHigh', 'meatXHigh',
  'veg', 'grain', 'oil', 'fruit',
  'milkSkim', 'milkLow', 'milkFull',
] as const;

export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'night', 'snack'] as const;

const portion = z.number().min(0).max(99);

export const foodSchema = z.object(
  Object.fromEntries(FOOD_KEYS.map((k) => [k, portion])) as Record<
    (typeof FOOD_KEYS)[number],
    typeof portion
  >
);

export const authSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(6).max(200),
  remember: z.boolean().optional(), // 自動登入：token 30 天，否則 1 天
});

export const emailSchema = z.string().trim().toLowerCase().email().max(100);

export const verifyCaptchaSchema = z.object({
  captchaId: z.string().uuid(),
  captchaAnswer: z.string().trim().min(1).max(10),
});

export const sendCodeSchema = z.object({
  email: emailSchema,
  captchaId: z.string().uuid(),
});

export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/),
});

export const registerSchema = z
  .object({
    username: emailSchema,
    password: z.string().min(6).max(200),
    confirmPassword: z.string().min(6).max(200),
    code: z.string().trim().regex(/^\d{6}$/),
  })
  .refine((d) => d.password === d.confirmPassword, { message: '兩次輸入的密碼不一致' });

// 忘記密碼：以 Email 認證碼重設（send-code 部分沿用 sendCodeSchema）
export const forgotResetSchema = z
  .object({
    email: emailSchema,
    code: z.string().trim().regex(/^\d{6}$/),
    newPassword: z.string().min(6).max(200),
    confirmPassword: z.string().min(6).max(200),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: '兩次輸入的密碼不一致' });

// 管理者替會員重置密碼
export const adminResetPasswordSchema = z.object({
  password: z.string().min(6).max(200),
});

// 日期需為真實存在的日曆日（2026-99-99 這種只符合字形的值擋下）
export const dateSchema = z.string().regex(DATE_RE).refine((s) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
});

// 路由參數（:date、from/to）用：所有日期入口都要擋非真實日期，不能只靠 DATE_RE 字形檢查
export const isRealDate = (s: unknown): s is string => dateSchema.safeParse(s).success;

// 月份參數（month-stats 的 ?month=）：regex 已保證真實月份（01–12）
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isRealMonth = (s: unknown): s is string => typeof s === 'string' && MONTH_RE.test(s);

// body/ex 數值以字串儲存（'' = 未填）：需為非負數字，上限 99999（體重/體脂/腰圍/分鐘都遠低於此）
const numText = z.string().max(20).refine((s) => {
  if (s === '') return true;
  const n = Number(s);
  return isFinite(n) && n >= 0 && n <= 99999;
});

const hmOrEmpty = z.string().regex(TIME_RE).or(z.literal(''));

export const dayPatchSchema = z.object({
  body: z
    .object({
      weight: numText,
      fat: numText,
      waist: numText,
      muscle: numText,
      fatkg: numText,
    })
    .optional(),
  bodyTime: hmOrEmpty.optional(),
});

export const entryCreateSchema = z.object({
  meal: z.enum(MEAL_KEYS),
  eatTime: z.string().regex(TIME_RE).or(z.literal('')).optional(),
});

// 逐筆喝水紀錄（一筆＝動態牆一則貼文）
export const waterLogCreateSchema = z.object({
  ml: z.number().int().min(1).max(9999),
  time: hmOrEmpty.optional(),
});

// 逐筆運動紀錄（一筆＝動態牆一則貼文）：分鐘或描述至少要有一項
export const exLogCreateSchema = z
  .object({
    min: numText,
    desc: z.string().max(500),
    time: hmOrEmpty.optional(),
  })
  .refine((d) => (d.min !== '' && Number(d.min) > 0) || d.desc.trim() !== '');

export const MAX_PHOTOS = 10;

const eatTimeSchema = z.string().regex(TIME_RE).or(z.literal(''));

// 逐張照片的份數（photo url → food）
export const photoFoodsSchema = z
  .record(z.string().max(300), foodSchema)
  .refine((o) => Object.keys(o).length <= MAX_PHOTOS);

// 自定義熱量項目：六大類份數無法表達的食物（含糖飲料、酒精等）直接記大卡。
// custom＝自填名稱＋大卡；sugar/protein＝輸入公克、alcohol＝輸入毫升，大卡由係數換算。
export const CUSTOM_ITEM_TYPES = ['custom', 'sugar', 'alcohol', 'protein'] as const;
// 換算係數（大卡/公克或毫升）。與前端 domain.CUSTOM_KCAL_FACTOR 重複宣告，改任一邊要同步改另一邊
export const CUSTOM_KCAL_FACTOR: Record<string, number> = { sugar: 4, alcohol: 7, protein: 4 };
export const MAX_CUSTOM_ITEMS = 20;

export const customItemSchema = z.object({
  type: z.enum(CUSTOM_ITEM_TYPES),
  name: z.string().trim().max(50),
  amount: z.number().min(0).max(9999).nullable(),
  kcal: z.number().min(0).max(9999),
});
export const customItemsSchema = z.array(customItemSchema).max(MAX_CUSTOM_ITEMS);

// 逐張照片的自定義項目（photo url → CustomItem[]）
export const photoCustomsSchema = z
  .record(z.string().max(300), customItemsSchema)
  .refine((o) => Object.keys(o).length <= MAX_PHOTOS);

// 無照片的食物項目頁（每項＝六大類份數＋自定義；可與照片頁並存）
export const MAX_ITEMS = 20;
export const itemsSchema = z
  .array(z.object({ food: foodSchema, customItems: customItemsSchema }))
  .max(MAX_ITEMS);

export const entryPatchSchema = z.object({
  desc: z.string().max(2000).optional(),
  // 舊 client 相容：無照片單一份數（新 client 一律改送 photoFoods+photoCustoms+items）
  food: foodSchema.optional(),
  // 逐張照片份數；提供時 food 欄位會改存照片＋items 的總和
  photoFoods: photoFoodsSchema.optional(),
  // 逐張照片的自定義熱量項目
  photoCustoms: photoCustomsSchema.optional(),
  // 無照片的食物項目頁
  items: itemsSchema.optional(),
  // PATCH 只能「保留既有照片的子集合」（刪除用）；新增照片走 /photos 上傳
  photos: z.array(z.string().max(300)).max(MAX_PHOTOS).optional(),
  // 用餐日期／時間：改日期會把這筆紀錄移到該天（需為真實日曆日）
  date: dateSchema.optional(),
  eatTime: eatTimeSchema.optional(),
  // 樂觀鎖：帶上開啟編輯當下的 revision，不符（已在其他裝置修改）回 409 不覆蓋
  expectedRevision: z.number().int().min(0).optional(),
});

// 樂觀鎖 expectedRevision：未提供＝相容舊 client（不檢查）；有提供就必須是非負整數，
// 格式錯誤回 400——不能靜默當成未提供，否則鎖形同虛設
export const expectedRevisionSchema = z.number().int().min(0).optional();

// 從歷史加入：複製自己既有的照片到目前這筆紀錄
export const copyPhotoSchema = z.object({ photo: z.string().max(300), expectedRevision: expectedRevisionSchema });

// 留言對象：某筆飲食（entry:<id>）、某筆喝水（water:<id>）或某筆運動（ex:<id>）
export const COMMENT_TARGET_RE = /^(entry:\d{1,10}|water:\d{1,10}|ex:\d{1,10})$/;

export const commentCreateSchema = z.object({
  target: z.string().regex(COMMENT_TARGET_RE),
  body: z.string().trim().min(1).max(1000),
});

// 編輯留言：只改內容
export const commentEditSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1).max(200),
    newPassword: z.string().min(6).max(200),
    confirmPassword: z.string().min(6).max(200),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: '兩次輸入的密碼不一致' });

// 暱稱：1～20 字；私人暱稱允許空字串（＝清除）
export const nicknameSchema = z.object({ nickname: z.string().trim().min(1).max(20) });
export const aliasSchema = z.object({ alias: z.string().trim().max(20) });
export const followSchema = z.object({ follow: z.boolean() });

export const ROLES = ['member', 'citizen', 'dietitian', 'admin'] as const;

// 營養師替單張照片評分；rating 為 null 表示清除評分
export const photoRatingSchema = z.object({
  photo: z.string().max(300),
  rating: z.enum(['green', 'yellow', 'red']).nullable(),
});

export const adminPatchUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['pending', 'active']).optional(),
  aiEnabled: z.boolean().optional(),
});

// NG 分類等級。與前端 lib/ng.ts 的 NG_LEVEL_LABELS 是同步契約，改任一邊要同步改另一邊
export const NG_LEVELS = ['extreme', 'high', 'medium'] as const;

// NG 分類是資料不是 enum（管理員可自行增刪改）
export const ngCategorySchema = z.object({
  name: z.string().trim().min(1).max(20),
  level: z.enum(NG_LEVELS),
  note: z.string().trim().max(100).optional(),
});

// isExclusion＝排除詞：命中的字段先從掃描文字剔除再比對 NG 關鍵字（如「黑巧克力」不算「巧克力」）。
// 非排除詞必須帶 categoryId（路由層檢查）；排除詞不屬於任何分類
export const ngKeywordSchema = z.object({
  keyword: z.string().trim().min(1).max(30),
  categoryId: z.number().int().positive().optional(),
  isExclusion: z.boolean().optional(),
});

// 每日精緻糖門檻（公克，全域設定；WHO 建議 25）
export const sugarLimitSchema = z.object({
  grams: z.number().int().min(1).max(200),
});

// NG 匯入檔（與前端「匯出」下載的檔案同格式，可直接 round-trip）。
// strict：未知欄位不默默放行——拼錯欄位名（keyword vs keywords）要 400，不能靜默匯入 0 筆；
// 陣列上限抓在 express json limit 1mb 之內
export const ngImportSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(20),
            level: z.enum(NG_LEVELS),
            note: z.string().trim().max(100).optional(),
            keywords: z.array(z.string().trim().min(1).max(30)).max(1000).optional(),
          })
          .strict()
      )
      .max(200)
      .optional(),
    exclusions: z.array(z.string().trim().min(1).max(30)).max(1000).optional(),
  })
  .strict();

// AI：判斷單張照片的營養素份數
export const aiOcrSchema = z.object({
  entryId: z.number().int().positive(),
  photo: z.string().max(300),
});

// AI：辨識 InBody 報告照片（前端壓縮後以 data URI 上傳，不落地存檔；
// 上限抓在 express json limit 1mb 之內）
export const aiInbodySchema = z.object({
  image: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .max(1_000_000),
});

// AI 評語：目前僅支援飲食貼文（entry:<id>）
export const aiCommentSchema = z.object({
  target: z.string().regex(/^entry:\d{1,10}$/),
});

// AI 今日總評：針對某一天產生整天的綜合評語
export const aiDailySchema = z.object({
  date: dateSchema,
});

// 營養師查詢輔助：網路搜尋＋LLM 摘要的問題
export const aiResearchSchema = z.object({
  question: z.string().trim().min(2).max(200),
});

// AI 評價：對某則 AI 產出按讚(1)／倒讚(-1)／取消(0)
// kind：comment/daily（ref＝留言id/日期，內容快照由後端擷取）；
//       ocr_caption/ocr_food（ref＝照片 url，內容快照由前端以 body 帶入，因 OCR 結果未持久化）
// dishId：ocr_food 若對應到知識庫某道菜，帶上以累計該菜的讚/倒讚
export const aiFeedbackSchema = z.object({
  kind: z.enum(['comment', 'daily', 'ocr_caption', 'ocr_food']),
  ref: z.string().min(1).max(300),
  vote: z.union([z.literal(1), z.literal(0), z.literal(-1)]),
  body: z.string().max(500).optional(),
  dishId: z.number().int().positive().optional(),
});

export const goalsSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  vals: z.object({
    meat: z.number().min(0).max(99),
    veg: z.number().min(0).max(99),
    grain: z.number().min(0).max(99),
    oil: z.number().min(0).max(99),
    fruit: z.number().min(0).max(99),
    milk: z.number().min(0).max(99),
  }),
  water: z.number().int().min(0).max(999999),
}).refine((d) => d.start <= d.end, { message: '起日不可晚於迄日' });

export const BODY_FIELDS = ['weight', 'fat', 'waist', 'muscle', 'fatkg'] as const;

// TDEE 活動量（係數定義於前端 domain.ACTIVITY_DEFS：1.2／1.375／1.55／1.725／1.9）
export const ACTIVITY_KEYS = ['sedentary', 'light', 'moderate', 'high', 'veryhigh'] as const;

// TDEE 基本資料：''＝未設定；數值以字串存（與 body 欄位一致）
const numField = (min: number, max: number, integer = false) =>
  z.string().max(10).refine((s) => {
    if (s === '') return true;
    const n = Number(s);
    return isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
  });
export const profileSchema = z.object({
  height: numField(50, 250),
  birthYear: numField(1900, 2100, true),
  gender: z.enum(['', 'male', 'female']),
  activity: z.enum(['', ...ACTIVITY_KEYS]),
  // 體重目標：normal＝TDEE 不調整；cut／gain＝TDEE 減／加 goalKcal
  goal: z.enum(['normal', 'cut', 'gain']),
  goalKcal: numField(0, 5000, true),
});

// 介面自定義：主頁卡片順序與隱藏清單。卡片鍵值由前端定義（讀取時會再清洗），
// 後端只限制型別與長度，之後前端新增卡片不需要動後端
export const uiLayoutSchema = z.object({
  order: z.array(z.string().min(1).max(20)).max(12),
  hidden: z.array(z.string().min(1).max(20)).max(12),
});

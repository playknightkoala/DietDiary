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

export const dateSchema = z.string().regex(DATE_RE);

const numText = z.string().max(20); // body/ex values stored as strings, '' = not set

const hmOrEmpty = z.string().regex(TIME_RE).or(z.literal(''));

export const dayPatchSchema = z.object({
  water: z.number().int().min(0).max(999999).optional(),
  waterTime: hmOrEmpty.optional(),
  ex: z.object({ min: numText, desc: z.string().max(500) }).optional(),
  exTime: hmOrEmpty.optional(),
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

export const MAX_PHOTOS = 10;

const eatTimeSchema = z.string().regex(TIME_RE).or(z.literal(''));

// 逐張照片的份數（photo url → food）
export const photoFoodsSchema = z
  .record(z.string().max(300), foodSchema)
  .refine((o) => Object.keys(o).length <= MAX_PHOTOS);

export const entryPatchSchema = z.object({
  desc: z.string().max(2000).optional(),
  food: foodSchema.optional(),
  // 逐張照片份數；提供時 food 欄位會改存各照片的總和
  photoFoods: photoFoodsSchema.optional(),
  // PATCH 只能「保留既有照片的子集合」（刪除用）；新增照片走 /photos 上傳
  photos: z.array(z.string().max(300)).max(MAX_PHOTOS).optional(),
  // 用餐日期／時間：改日期會把這筆紀錄移到該天
  date: z.string().regex(DATE_RE).optional(),
  eatTime: eatTimeSchema.optional(),
});

// 從歷史加入：複製自己既有的照片到目前這筆紀錄
export const copyPhotoSchema = z.object({ photo: z.string().max(300) });

// 留言對象：某筆飲食（entry:<id>）、某天的喝水（water:<date>）或運動（ex:<date>）
export const COMMENT_TARGET_RE = /^(entry:\d{1,10}|water:\d{4}-\d{2}-\d{2}|ex:\d{4}-\d{2}-\d{2})$/;

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

// AI：判斷單張照片的營養素份數
export const aiOcrSchema = z.object({
  entryId: z.number().int().positive(),
  photo: z.string().max(300),
});

// AI 評語：目前僅支援飲食貼文（entry:<id>）
export const aiCommentSchema = z.object({
  target: z.string().regex(/^entry:\d{1,10}$/),
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
});

export const BODY_FIELDS = ['weight', 'fat', 'waist', 'muscle', 'fatkg'] as const;

import { z } from 'zod';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export const dayPatchSchema = z.object({
  water: z.number().int().min(0).max(999999).optional(),
  ex: z.object({ min: numText, desc: z.string().max(500) }).optional(),
  body: z
    .object({
      weight: numText,
      fat: numText,
      waist: numText,
      muscle: numText,
      fatkg: numText,
    })
    .optional(),
});

export const entryCreateSchema = z.object({
  meal: z.enum(MEAL_KEYS),
});

export const MAX_PHOTOS = 6;

export const entryPatchSchema = z.object({
  desc: z.string().max(2000).optional(),
  food: foodSchema.optional(),
  // PATCH 只能「保留既有照片的子集合」（刪除用）；新增照片走 /photos 上傳
  photos: z.array(z.string().max(300)).max(MAX_PHOTOS).optional(),
});

export const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1).max(200),
    newPassword: z.string().min(6).max(200),
    confirmPassword: z.string().min(6).max(200),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: '兩次輸入的密碼不一致' });

export const ROLES = ['member', 'dietitian', 'admin'] as const;

// 營養師替單張照片評分；rating 為 null 表示清除評分
export const photoRatingSchema = z.object({
  photo: z.string().max(300),
  rating: z.enum(['green', 'yellow', 'red']).nullable(),
});

export const adminPatchUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['pending', 'active']).optional(),
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

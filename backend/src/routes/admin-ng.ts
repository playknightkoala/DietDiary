import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ngCategorySchema, ngKeywordSchema, sugarLimitSchema } from '../validation.js';
import {
  createNgCategory,
  createNgKeyword,
  deleteNgCategory,
  deleteNgKeyword,
  getSugarLimit,
  listNgCategories,
  listNgKeywords,
  normalizeNgText,
  setSugarLimit,
  updateNgCategory,
  updateNgKeyword,
} from '../ng.js';

// NG 分類／關鍵字清單與糖門檻的讀寫全部 admin-only（會員不讀關鍵字表，掃描在 month-stats 端點完成）。
// 由 admin.ts 掛在 /api/admin/ng 底下；自帶授權（fail-closed，不只依賴父層的 requireRole）
export const adminNgRouter = Router();
adminNgRouter.use(requireAuth, requireRole('admin'));

adminNgRouter.get('/', (_req, res) => {
  return res.json({ sugarLimit: getSugarLimit(), categories: listNgCategories(), keywords: listNgKeywords() });
});

adminNgRouter.put('/sugar-limit', (req, res) => {
  const parsed = sugarLimitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  setSugarLimit(parsed.data.grams);
  return res.json({ sugarLimit: getSugarLimit() });
});

// 只把 UNIQUE／FK 衝突當業務衝突，其他錯誤誠實往上拋成 500
const sqliteCode = (e: unknown): string => (e as { code?: string }).code ?? '';
const isUniqueViolation = (e: unknown) => sqliteCode(e) === 'SQLITE_CONSTRAINT_UNIQUE';
const isFkViolation = (e: unknown) => sqliteCode(e) === 'SQLITE_CONSTRAINT_FOREIGNKEY';

const parseId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// ---- 分類 ----

adminNgRouter.post('/categories', (req, res) => {
  const parsed = ngCategorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  try {
    return res.status(201).json(createNgCategory(parsed.data.name, parsed.data.level, parsed.data.note ?? ''));
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: '分類已存在' });
    throw e;
  }
});

adminNgRouter.put('/categories/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid params' });
  const parsed = ngCategorySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  try {
    const updated = updateNgCategory(id, parsed.data.name, parsed.data.level, parsed.data.note ?? '');
    if (!updated) return res.status(404).json({ error: 'not found' });
    return res.json(updated);
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: '分類已存在' });
    throw e;
  }
});

adminNgRouter.delete('/categories/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid params' });
  try {
    if (!deleteNgCategory(id)) return res.status(404).json({ error: 'not found' });
    return res.status(204).end();
  } catch (e) {
    if (isFkViolation(e)) return res.status(409).json({ error: '此分類下還有關鍵字，請先刪除或搬移' });
    throw e;
  }
});

// ---- 關鍵字 ----

adminNgRouter.post('/keywords', (req, res) => {
  const parsed = ngKeywordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const isExclusion = parsed.data.isExclusion ?? false;
  // schema 的 trim 擋不住「正規化後變空」（例如全形空白），normalize 之後再驗一次；
  // 非排除詞必須歸屬某個分類
  if (!normalizeNgText(parsed.data.keyword)) return res.status(400).json({ error: 'invalid payload' });
  if (!isExclusion && !parsed.data.categoryId) return res.status(400).json({ error: 'invalid payload' });
  try {
    return res.status(201).json(createNgKeyword(parsed.data.keyword, parsed.data.categoryId ?? null, isExclusion));
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: '關鍵字已存在' });
    if (isFkViolation(e)) return res.status(400).json({ error: 'invalid payload' });
    throw e;
  }
});

adminNgRouter.put('/keywords/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid params' });
  const parsed = ngKeywordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const isExclusion = parsed.data.isExclusion ?? false;
  if (!normalizeNgText(parsed.data.keyword)) return res.status(400).json({ error: 'invalid payload' });
  if (!isExclusion && !parsed.data.categoryId) return res.status(400).json({ error: 'invalid payload' });
  try {
    const updated = updateNgKeyword(id, parsed.data.keyword, parsed.data.categoryId ?? null, isExclusion);
    if (!updated) return res.status(404).json({ error: 'not found' });
    return res.json(updated);
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(409).json({ error: '關鍵字已存在' });
    if (isFkViolation(e)) return res.status(400).json({ error: 'invalid payload' });
    throw e;
  }
});

adminNgRouter.delete('/keywords/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid params' });
  if (!deleteNgKeyword(id)) return res.status(404).json({ error: 'not found' });
  return res.status(204).end();
});

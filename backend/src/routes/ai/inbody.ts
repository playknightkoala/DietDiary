// 辨識 InBody 報告照片：擷取檢測日期與身體組成數值，供自動記錄與前後比較。拆自原 routes/ai.ts。
// 報告照片只在記憶體中處理、不落地存檔（含個資：姓名／ID）。
// 對應關係：體重→weight、骨骼肌重 SMM→muscle（肌肉重）、體脂肪重→fatkg、體脂肪率 PBF→fat、
// 部位別圍度「腹部」→waist（腰圍，量測位置接近，仍由使用者確認後才儲存）。
import { Router } from 'express';
import { db } from '../../db.js';
import { aiInbodySchema } from '../../validation.js';
import { OCR_MODEL, chat, documentDataUri, extractJson, imagePart, textPart } from '../../llm.js';

export const inbodyRouter = Router();

inbodyRouter.post('/inbody', async (req, res) => {
  const parsed = aiInbodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });

  const raw = Buffer.from(parsed.data.image.slice(parsed.data.image.indexOf(',') + 1), 'base64');
  const dataUri = await documentDataUri(raw);
  if (!dataUri) return res.status(400).json({ error: '無法讀取這張圖片，請重新拍攝或選擇其他照片' });

  const prompt =
    '這是一張 InBody 身體組成分析報告（或類似體組成量測報告）的照片。請仔細找出以下數值，只輸出 JSON 物件：\n' +
    '- date：檢測日期（Test Date），輸出 "YYYY-MM-DD" 格式\n' +
    '- time：檢測時間（24 小時制 "HH:MM"），報告上沒有印時間就填 null\n' +
    '- weight：體重 Weight（kg），以「肌肉脂肪分析 Muscle-Fat Analysis」區塊「體重」列橫條旁的數字為準\n' +
    '- smm：骨骼肌重 SMM（kg），「骨骼肌重」列橫條旁的數字\n' +
    '- fatkg：體脂肪重 Body Fat Mass（kg），「體脂肪重」列橫條旁的數字\n' +
    '- pbf：體脂肪率 PBF（%），「肥胖分析 Obesity Analysis」區塊「體脂肪率」列的數字\n' +
    '- waist：腹部圍度（cm），「部位別圍度 Segmental Circumference」清單中「腹部 Abdomen」的數字，沒有這個區塊就填 null\n' +
    '- score：InBody評分 InBody Score（0～100 的分數），沒有就填 null\n' +
    '- height：身高 Height（cm，報告上方基本資料列）\n' +
    '- age：年齡 Age（歲，報告上方基本資料列）\n' +
    '- gender：性別 Gender（報告上方基本資料列），男填 "male"、女填 "female"，看不到填 null\n' +
    '重要：只抄照片上實際印出的數字，看不清楚或找不到的欄位一律填 null，絕對不要猜、不要用其他欄位的數字充當；' +
    '不要把參考範圍（括號內的區間）當成量測值。\n' +
    '範例：{"date":"2026-07-13","time":null,"weight":86.3,"smm":35.1,"fatkg":24.7,"pbf":28.6,"waist":96.9,"score":76,"height":166.0,"age":29,"gender":"male"}';

  try {
    const model = OCR_MODEL;
    const text = await chat({
      model,
      json: true,
      temperature: 0,
      maxTokens: 300,
      messages: [{ role: 'user', content: [imagePart(dataUri), textPart(prompt)] }],
    });
    const out = extractJson<Record<string, unknown>>(text);

    // 合理範圍檢查：超出範圍視同沒讀到（寧缺勿錯，數值會由使用者確認後才儲存）
    const numIn = (v: unknown, min: number, max: number): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!isFinite(n) || n < min || n > max) return null;
      return Math.round(n * 10) / 10;
    };
    const values = {
      weight: numIn(out.weight, 20, 300),
      muscle: numIn(out.smm, 5, 100),
      fatkg: numIn(out.fatkg, 1, 150),
      fat: numIn(out.pbf, 1, 70),
      waist: numIn(out.waist, 30, 250),
    };
    if (Object.values(values).every((v) => v === null)) {
      return res.status(422).json({ error: '照片中找不到可辨識的 InBody 數值，請確認拍到完整報告、光線充足後再試' });
    }
    const score = numIn(out.score, 0, 100);
    // 基本資料（身高／年齡／性別）：報告上方就有，順便讀出來補 TDEE 基本資料（前端只補「尚未設定」的欄位）
    const profile = {
      height: numIn(out.height, 50, 250),
      age: numIn(out.age, 1, 120),
      gender: out.gender === 'male' || out.gender === 'female' ? out.gender : null,
    };

    // 檢測日期正規化（YYYY-MM-DD／YYYY/MM/DD 都收）；讀不到就留空，由前端帶入所選日期
    let date = '';
    const m = typeof out.date === 'string' ? /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(out.date.trim()) : null;
    if (m) {
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]) {
        date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      }
    }

    // 檢測時間正規化（HH:MM）；讀不到留空
    let time = '';
    const tm = typeof out.time === 'string' ? /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(out.time.trim()) : null;
    if (tm) time = `${tm[1].padStart(2, '0')}:${tm[2]}`;

    // 前一次量測（嚴格早於檢測日；沒讀到日期就取最近一次），供前端顯示本次 vs 前次的比較
    const prevRow = db
      .prepare(
        `SELECT date, body_weight, body_fat, body_waist, body_muscle, body_fatkg FROM days
         WHERE user_id = ? AND date < ?
           AND (body_weight != '' OR body_fat != '' OR body_waist != '' OR body_muscle != '' OR body_fatkg != '')
         ORDER BY date DESC LIMIT 1`
      )
      .get(req.userId, date || '9999-12-31') as
      | { date: string; body_weight: string; body_fat: string; body_waist: string; body_muscle: string; body_fatkg: string }
      | undefined;
    const prev = prevRow
      ? {
          date: prevRow.date,
          body: {
            weight: prevRow.body_weight,
            fat: prevRow.body_fat,
            waist: prevRow.body_waist,
            muscle: prevRow.body_muscle,
            fatkg: prevRow.body_fatkg,
          },
        }
      : null;

    return res.json({ date, time, values, score, profile, prev, model });
  } catch (e) {
    console.error('ai inbody failed:', e);
    return res.status(502).json({ error: 'AI 辨識失敗（視覺模型暫時無法使用），請稍後再試' });
  }
});

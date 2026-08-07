// 判斷單張照片的營養素份數（＋一句敘述）。拆自原 routes/ai.ts。
// 網路搜尋可用時會請視覺模型認品牌，KB 未命中則搜營養標示讓文字模型校正份數。
import { Router } from 'express';
import { db } from '../../db.js';
import { aiOcrSchema } from '../../validation.js';
import { emptyFood, parsePhotos } from '../../helpers.js';
import { kbHint, kbLookupByImage } from '../../kb.js';
import { searchActive, webResultForPrompt, webSearch } from '../../search.js';
import { COMMENT_MODEL, OCR_MODEL, chat, extractJson, imagePart, photoDataUri, textPart } from '../../llm.js';
import { clampPortion, foodSummaryZh } from './nutrition.js';

export const ocrRouter = Router();

ocrRouter.post('/ocr', async (req, res) => {
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

  // 網路搜尋可用時，請視覺模型順便認品牌：之後拿品牌品項查官方營養標示來校正份數
  const brandAsk = searchActive()
    ? '\n另外：若照片中「明確看得到」連鎖店或品牌名稱（招牌、包裝、杯身、logo 上的文字，例如麥當勞、50嵐、超商包裝食品），' +
      '請在 JSON 多輸出鍵 brand，值為「品牌＋品項名」（例：「麥當勞 大麥克」「50嵐 波霸奶茶」）；' +
      '看不到明確的品牌文字或標誌就填空字串，絕對不要用猜的。'
    : '';

  // 共用知識庫（開關開啟時）：先找相似菜色，把社群共識份數當估算參考注入提示。查詢失敗不影響 OCR。
  const kbMatch = await kbLookupByImage(photo).catch(() => null);
  const promptFull = prompt + brandAsk + (kbMatch ? '\n' + kbHint(kbMatch) : '');

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

    // 品牌品項且知識庫沒有共識時：搜營養標示，讓文字模型把官方數據換算回六大類份數校正視覺估計。
    // 補知識庫的冷啟動——校正後的份數在使用者存檔時經 kbUpsert 回寫 KB，之後同品項直接命中不再搜。
    // 搜尋／換算任一步失敗（額度用完、模型故障、資料不符）都保留原本的視覺估計。
    const brand = typeof raw.brand === 'string' ? raw.brand.trim().replace(/\s+/g, ' ').slice(0, 50) : '';
    let web: { query: string; sources: { title: string; url: string }[] } | null = null;
    if (brand && !kbMatch) {
      const found = await webSearch(`${brand} 熱量 營養成分`);
      if (found) {
        try {
          const refinePrompt =
            `你是專業營養師。使用者拍了「${brand}」的照片，視覺模型的初步六大類估計為：${foodSummaryZh(food)}` +
            `（照片敘述：${caption || '無'}）。\n以下是網路搜尋到的這個品項的營養資訊：\n${webResultForPrompt(found)}\n` +
            '請優先依上述營養資訊（官方熱量／三大營養素）校正六大類份數。換算參考——每份熱量：' +
            '蛋豆魚肉（中脂）約 75 大卡、蔬菜 25、全穀雜糧 70、油脂堅果 45、水果 60、乳品（低脂）120。' +
            '份量以照片實際看到的為準（例如飲料只剩半杯就按半份算）；搜尋資料與品項明顯不符時維持原估計。\n' +
            '只輸出 JSON 物件，鍵為 protein、veg、grain、oil、fruit、milk（份數，可含一位小數），不要有其他文字。';
          const refined = extractJson<Record<string, unknown>>(
            await chat({
              model: COMMENT_MODEL,
              json: true,
              temperature: 0.2,
              maxTokens: 300,
              messages: [{ role: 'user', content: refinePrompt }],
            })
          );
          const keys = ['protein', 'veg', 'grain', 'oil', 'fruit', 'milk'] as const;
          // 全零視為換算失敗，保留視覺估計
          if (keys.some((k) => clampPortion(refined[k]) > 0)) {
            food.meatMed = clampPortion(refined.protein);
            food.veg = clampPortion(refined.veg);
            food.grain = clampPortion(refined.grain);
            food.oil = clampPortion(refined.oil);
            food.fruit = clampPortion(refined.fruit);
            food.milkLow = clampPortion(refined.milk);
            web = { query: found.query, sources: found.results.map((r) => ({ title: r.title, url: r.url })) };
          }
        } catch (e) {
          console.error('ai ocr web refine failed (keeping visual estimate):', e instanceof Error ? e.message : e);
        }
      }
    }

    // 附上知識庫命中的參考（前端顯示「類似菜色社群份數」，並讓份數評價回饋到該道菜）
    const kb = kbMatch ? { dishId: kbMatch.id, caption: kbMatch.caption, food: kbMatch.food, up: kbMatch.up, down: kbMatch.down } : null;
    return res.json({ food, caption, model, kb, web });
  } catch (e) {
    console.error('ai ocr failed:', e);
    return res.status(502).json({ error: 'AI 判斷失敗（視覺模型暫時無法使用），請稍後再試' });
  }
});

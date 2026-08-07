// AI 評語（單篇餐點）與今日總評（整天綜合），共用偏好提示與「查證搜尋」生成流程。拆自原 routes/ai.ts。
import { Router } from 'express';
import { db } from '../../db.js';
import { FOOD_KEYS, aiCommentSchema, aiDailySchema } from '../../validation.js';
import {
  ENTRY_COLS,
  createComment,
  customItemsKcal,
  emptyFood,
  entryAllCustoms,
  getDayJson,
  getFeedbackExamples,
  listComments,
  parseFood,
  parseItems,
  parsePhotoCustoms,
  upsertDailySummary,
} from '../../helpers.js';
import { searchActive, webResultForPrompt, webSearch } from '../../search.js';
import { COMMENT_FALLBACK_MODEL, COMMENT_MODEL, chat } from '../../llm.js';
import { EntryFull, MEAL_NAMES } from './common.js';
import {
  CAT_DEFS,
  CATEGORY_LABEL_CAVEAT,
  bodyLineFor,
  bodyStrFrom,
  customItemsZh,
  dayGoalBreakdown,
  foodSummaryZh,
  goalForDate,
  goalSummaryZh,
  kcalOfFood,
  kcalVsTargetZh,
  macrosOf,
  macrosZh,
  round1,
  sixCategories,
  tdeeInfoFor,
  waterGoalNote,
} from './nutrition.js';

export const commentRouter = Router();

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

// ---- 評語／總評的「查證搜尋」：gateway 的 gemma 模型不支援原生 tool-use，用單回合協定模擬 ----
// 模型遇到不熟悉的特殊食材／品牌品項時，可整段只回「SEARCH: 查詢詞」，系統搜尋後帶結果重問一次
// （每次生成最多一輪）。搜尋不可用（未設定／額度用完）時完全不提供此選項，模型永遠不會輸出指令。
const SEARCH_PROTOCOL_HINT =
  '\n若敘述中出現你不熟悉、無法確定營養特性的特殊食材、品牌品項或飲品，導致無法正確評估，' +
  '你可以先不寫評語，整段回覆只輸出一行「SEARCH: 查詢詞」（例：SEARCH: 蝶豆花 營養成分），' +
  '系統會提供網路搜尋結果讓你重新作答。常見食材請直接作答、不要查詢；最多查一次。';

// 依模型鏈生成一段文字，支援上述查證協定；全部模型都失敗時丟出最後的錯誤
async function chatWithVerification(
  models: string[],
  system: string,
  context: string,
  maxTokens: number
): Promise<{ body: string; model: string }> {
  let lastError: unknown = null;
  for (const model of models) {
    try {
      let text = await chat({
        model,
        temperature: 0.6,
        maxTokens,
        messages: [
          { role: 'system', content: searchActive() ? system + SEARCH_PROTOCOL_HINT : system },
          { role: 'user', content: context },
        ],
      });
      // 只有「整段回覆就是一行 SEARCH 指令」才視為查證要求，避免誤判評語內文
      const trimmed = text.trim();
      const m = !trimmed.includes('\n') ? /^SEARCH[:：]\s*(.{2,120})$/i.exec(trimmed) : null;
      if (m) {
        // 搜到就帶資料重問；沒搜到（額度用完等）也要重問——不能把 SEARCH 指令當成評語存檔。
        // 重問時不再提供查證選項，模型必須作答。
        const found = await webSearch(m[1].trim());
        const extra = found
          ? '\n【網路查證資料（僅供參考，請自行判斷取用；評語中不要提到「搜尋」、不要列出網址）】\n' +
            webResultForPrompt(found) + '\n'
          : '';
        text = await chat({
          model,
          temperature: 0.6,
          maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: context + extra },
          ],
        });
      }
      return { body: text.replace(/\s+$/, ''), model };
    } catch (e) {
      lastError = e;
      console.error(`ai generate attempt failed (${model}), trying next:`, e instanceof Error ? e.message : e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('all models failed');
}

// ---- AI 評語（純文字：依敘述＋份數＋餐期＋時間，對自己的飲食貼文產生一則 AI 留言）----
commentRouter.post('/comment', async (req, res) => {
  const parsed = aiCommentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { target } = parsed.data;
  const entryId = Number(target.slice('entry:'.length));

  const entry = db
    .prepare(`SELECT date, ${ENTRY_COLS} FROM entries WHERE id = ? AND user_id = ?`)
    .get(entryId, req.userId) as EntryFull | undefined;
  if (!entry) return res.status(404).json({ error: 'not found' });

  const food = parseFood(entry.food);
  // 自定義項目彙總（照片綁定＋無照片項目）
  const customItems = entryAllCustoms({
    photoCustoms: parsePhotoCustoms(entry.photo_customs ?? '{}'),
    items: parseItems(entry.items ?? '[]'),
  });
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
    `這餐已記錄的六大類份數：${foodSummaryZh(food)}（約 ${kcalOfFood(food) + customItemsKcal(customItems)} 大卡${customItems.length ? '，含自定義項目' : ''}）\n` +
    `這餐三大營養素（系統依份數與自定義項目換算，可作為均衡度參考；酒精與自訂項目只計熱量不計營養素）：${macrosZh(macrosOf(food, customItems))}\n` +
    (customItems.length
      ? `這餐另外記錄的自定義熱量項目（不屬於六大類份數，請勿當成六大類評論）：${customItemsZh(customItems)}\n`
      : '') +
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
  try {
    const { body: text, model } = await chatWithVerification(
      [COMMENT_MODEL, COMMENT_FALLBACK_MODEL],
      systemFull,
      context,
      500
    );
    const body = text.slice(0, 1000);
    createComment(req.userId, target, req.userId, body, true, model);
    return res.status(201).json(listComments(req.userId, target, req.userId));
  } catch (e) {
    console.error('ai comment failed (all attempts):', e);
    return res.status(502).json({ error: 'AI 評語產生失敗，請稍後再試' });
  }
});

// ---- AI 今日總評（純文字：擷取當天所有動態＋六大類總份數＋熱量喝水＋身體數據＋當日目標，
//      產生一則整天綜合評語，存為當天一則「AI 動態」，本人與營養師皆可見；使用者按鈕才觸發）----
commentRouter.post('/daily', async (req, res) => {
  const parsed = aiDailySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid payload' });
  const { date } = parsed.data;

  const day = getDayJson(req.userId, date);
  const entries = day.entries.filter(
    (e) => e.desc || e.photos.length || FOOD_KEYS.some((k) => (e.food[k] || 0) > 0) || entryAllCustoms(e).length
  );
  const hasEx = day.exLogs.length > 0;
  const hasBodyToday = !!bodyStrFrom(day.body);
  if (!entries.length && !(day.water > 0) && !hasEx && !hasBodyToday) {
    return res.status(400).json({ error: '這天還沒有任何紀錄，先記錄後再產生今日總評' });
  }

  // 當天六大類總份數（各餐加總）＋自定義熱量總和
  const dayTotal = emptyFood();
  let dayCustomKcal = 0;
  for (const e of entries) {
    for (const k of FOOD_KEYS) dayTotal[k] = round1(dayTotal[k] + (e.food[k] || 0));
    dayCustomKcal += customItemsKcal(entryAllCustoms(e));
  }
  const goal = goalForDate(req.userId, date);

  const mealLines = entries.length
    ? entries
        .map((e) => {
          const mn = MEAL_NAMES[e.meal] || '這餐';
          const t = e.eatTime ? ` ${e.eatTime}` : '';
          const d = e.desc ? e.desc : '（未填敘述）';
          const customs = entryAllCustoms(e);
          const custom = customs.length ? `；自定義熱量項目：${customItemsZh(customs)}` : '';
          return `・${mn}${t}：${d}（${foodSummaryZh(e.food)}，約 ${kcalOfFood(e.food) + customItemsKcal(customs)} 大卡${custom}）`;
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
  const dayKcal = kcalOfFood(dayTotal) + dayCustomKcal;
  // 每日消耗量（BMR/TDEE/體重目標）：基本資料齊全才提供；比較由後端算好
  const tdee = tdeeInfoFor(req.userId, date, day.body);

  const context =
    `以下是使用者在 ${date} 這一天的完整飲食與健康紀錄，請據此給出「一整天」的綜合總評。\n\n` +
    `【當天各餐】\n${mealLines}\n\n` +
    `【當天六大類總份數】${foodSummaryZh(dayTotal)}（全天約 ${dayKcal} 大卡${
      dayCustomKcal ? `，其中自定義熱量項目 ${dayCustomKcal} 大卡——這部分不屬於六大類份數，與目標比對時請勿當成某類份數` : ''
    }）\n` +
    `【當天三大營養素】${macrosZh(macrosOf(dayTotal, entries.flatMap((e) => entryAllCustoms(e))))}` +
    '（系統依份數與自定義項目換算，可作為均衡度參考；酒精與自訂項目只計熱量不計營養素）\n' +
    `【當日六大類目標】${goalSummaryZh(goal.vals)}\n` +
    `【與目標比對（系統已算好，請直接採用，不要自行加減或臆測其他數字）】\n${dayGoalBreakdown(dayTotal, goal.vals).join('\n')}\n` +
    `【喝水】${day.water} / ${goal.water} ml（${waterGoalNote(day.water, goal.water)}）${
      day.waterLogs.length
        ? `（分 ${day.waterLogs.length} 次：${day.waterLogs.map((w) => `${w.time || '未填時間'} ${w.ml} ml`).join('、')}）`
        : ''
    }\n` +
    `【運動】${exStr}\n` +
    `【身體數據】${bodyStr}\n` +
    (tdee
      ? `【每日消耗量與熱量目標（系統已算好，請直接採用，不要自行加減或重算）】${tdee.line}。${kcalVsTargetZh(dayKcal, tdee.target)}\n`
      : '');

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
    '若提供了【每日消耗量與熱量目標】，請把「總攝取 vs 目標攝取」的比較自然納入總評，一律以系統算好的結果為準：' +
    '目標為減重卻明顯超過目標攝取時要溫和提醒；明顯低於目標攝取時，先想想是否只是餐點少記了' +
    '（例如整天只記了一兩餐），記錄看起來完整才提醒攝取偏低——目標是減重也不建議吃得遠低於目標攝取，過度節食不利健康也難持續。' +
    '未提供每日消耗量資訊時，不要自行推算或臆測 BMR、TDEE。' +
    '身體數據若只有較早日期的紀錄，當作參考背景即可，不要當成今天的數字。' +
    '批評對事不對人，不要讓使用者因為誠實記錄而覺得被責備。' +
    '請用繁體中文、溫暖鼓勵的口吻，寫成通順的 3～5 句短文（約 120～250 字），直接寫內容，不要用標題或條列、不要逐項複述所有數字。';

  // 評價當作依據：注入使用者過去讚／倒讚的偏好，讓這份總評貼近他的喜好
  const systemFull = system + preferenceHint(req.userId);

  try {
    const { body: text, model } = await chatWithVerification(
      [COMMENT_MODEL, COMMENT_FALLBACK_MODEL],
      systemFull,
      context,
      700
    );
    const body = text.slice(0, 2000);
    upsertDailySummary(req.userId, date, body, model);
    return res.status(201).json(getDayJson(req.userId, date));
  } catch (e) {
    console.error('ai daily failed (all attempts):', e);
    return res.status(502).json({ error: 'AI 今日總評產生失敗，請稍後再試' });
  }
});

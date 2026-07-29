import { useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { api } from '../../lib/api';
import { compressImage } from '../../lib/photo';
import { FOOD_KEYS, MEALS, clampPortion, customDraftsKcal, customDraftsToItems, customItemsToDrafts, emptyFood, entryHasData, fmtCommentTime, foodSummary, kcalOfFood, sumFoods, type CustomDraft } from '../../lib/domain';
import { useStore } from '../../store';
import type { CustomItem, EntryFoodItem, Food, FoodKey, HistoryMeal, HistoryPhoto } from '../../types';
import { CustomItemsEditor, FoodFields } from '../FoodFields';
import { Lightbox } from '../Lightbox';
import { PhotoRatingBadge } from '../PhotoRatingBadge';
import { PickerInput } from '../PickerInput';
import { HistoryPickerSheet } from './HistoryPickerSheet';
import { CloseButton, ModalShell } from './ModalShell';

type FoodStr = Record<FoodKey, string>;

const emptyFoodStr = (): FoodStr => {
  const s = {} as FoodStr;
  FOOD_KEYS.forEach((k) => (s[k] = ''));
  return s;
};

const foodToStr = (f: Food): FoodStr => {
  const s = {} as FoodStr;
  FOOD_KEYS.forEach((k) => (s[k] = f[k] ? String(f[k]) : ''));
  return s;
};

const strToFood = (s: FoodStr | undefined): Food => {
  const f = emptyFood();
  if (s) FOOD_KEYS.forEach((k) => (f[k] = clampPortion(s[k] ?? '')));
  return f;
};

// 知識庫回傳的六大類（protein/veg/grain/oil/fruit/milk）→ 中文摘要
const sixCatText = (c: Record<string, number>): string => {
  const map: [string, string][] = [
    ['protein', '蛋豆魚肉'], ['veg', '蔬菜'], ['grain', '全穀雜糧'],
    ['oil', '油脂堅果'], ['fruit', '水果'], ['milk', '乳品'],
  ];
  const parts = map.filter(([k]) => (c[k] || 0) > 0).map(([k, n]) => `${n} ${c[k]}`);
  return parts.join('、') || '份數皆為 0';
};

// 記錄頁：照片頁（一張照片＝六大類份數＋自定義項目）或無照片的食物項目頁（同樣結構，只是沒有照片）。
// 兩種頁可混合並存；item 頁用遞增流水號當 key，增刪照片不會讓 key 錯位
type Page = { kind: 'photo'; url: string } | { kind: 'item'; key: string };

// 無照片項目頁的草稿
interface ItemDraft {
  foodStr: FoodStr;
  customs: CustomDraft[];
}

// 記錄飲食：先新增照片（或略過）→ 逐頁記錄六大類份數＋自定義項目；敘述為整筆共用，貼文顯示總和
export function LogFoodModal() {
  const editingId = useStore((s) => s.editingId);
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);
  const openGuide = useStore((s) => s.openGuide);
  const aiEnabled = useStore((s) => s.aiEnabled);

  const entry = useMemo(() => day.entries.find((e) => e.id === editingId) ?? null, [day.entries, editingId]);

  const [desc, setDesc] = useState(entry?.desc ?? '');
  const [photos, setPhotos] = useState<string[]>(entry?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  // AI 判斷這張照片的營養素份數
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiModel, setAiModel] = useState(''); // 最近一次 AI 判斷實際使用的模型
  // 用餐時間：預設為目前檢視的日期＋紀錄上的時間；改日期會把這筆移到該天
  const [eatDate, setEatDate] = useState(selected);
  const [eatTime, setEatTime] = useState(entry?.eatTime ?? '');

  // 逐張照片的份數字串。舊資料（有照片但沒逐張份數、也沒有 items）：整筆份數先放到第一張，總和不變
  const [photoFoodsStr, setPhotoFoodsStr] = useState<Record<string, FoodStr>>(() => {
    if (!entry) return {};
    const init: Record<string, FoodStr> = {};
    entry.photos.forEach((url) => (init[url] = foodToStr(entry.photoFoods[url] ?? emptyFood())));
    const hasAny = entry.photos.some((url) => FOOD_KEYS.some((k) => (entry.photoFoods[url]?.[k] ?? 0) > 0));
    if (entry.photos.length && !hasAny && !entry.items.length && FOOD_KEYS.some((k) => entry.food[k] > 0)) {
      init[entry.photos[0]] = foodToStr(entry.food);
    }
    return init;
  });
  // 逐張照片的自定義項目草稿
  const [photoCustomDrafts, setPhotoCustomDrafts] = useState<Record<string, CustomDraft[]>>(() => {
    if (!entry) return {};
    const init: Record<string, CustomDraft[]> = {};
    entry.photos.forEach((url) => {
      const list = entry.photoCustoms[url];
      if (list?.length) init[url] = customItemsToDrafts(list);
    });
    return init;
  });
  // 無照片項目頁：key 流水號 → 草稿。legacy（無照片、無 items、有整筆份數）視為一個項目頁
  const itemSeq = useRef(0);
  const [itemState, setItemState] = useState<{ order: string[]; drafts: Record<string, ItemDraft> }>(() => {
    const order: string[] = [];
    const drafts: Record<string, ItemDraft> = {};
    const add = (food: Food, customs: CustomItem[]) => {
      const key = `i${itemSeq.current++}`;
      order.push(key);
      drafts[key] = { foodStr: foodToStr(food), customs: customItemsToDrafts(customs) };
    };
    if (entry) {
      if (entry.items.length) entry.items.forEach((it) => add(it.food, it.customItems));
      else if (!entry.photos.length && FOOD_KEYS.some((k) => entry.food[k] > 0)) add(entry.food, []);
    }
    return { order, drafts };
  });
  // 每頁的份數／自定義分頁；開啟時若第一頁沒份數但有自定義項目，直接落在自定義分頁
  const [tab, setTab] = useState<'portions' | 'custom'>(() => {
    if (!entry) return 'portions';
    const firstCustoms = entry.photos.length
      ? entry.photoCustoms[entry.photos[0]]?.length
      : entry.items[0]?.customItems.length;
    const firstFood = entry.photos.length
      ? FOOD_KEYS.some((k) => (entry.photoFoods[entry.photos[0]]?.[k] ?? 0) > 0)
      : FOOD_KEYS.some((k) => (entry.items[0]?.food[k] ?? 0) > 0);
    return firstCustoms && !firstFood ? 'custom' : 'portions';
  });
  // AI 幫每張照片寫的敘述（本回合暫存，不持久化）；用來在 desc 內「替換自己那行」而不重複、不蓋掉手打的字
  const [photoCaptions, setPhotoCaptions] = useState<Record<string, string>>({});
  // 從歷史帶入的敘述（來源紀錄 id → 帶入的文字）：同一餐只帶一次，該來源照片全移除時收回
  const [historyDescs, setHistoryDescs] = useState<Record<number, string>>({});
  // 這次視窗內從歷史加入的照片來源（新照片 url → 歷史紀錄 id），供收回敘述判斷
  const [photoSources, setPhotoSources] = useState<Record<string, number>>({});
  // 每張照片最近一次 OCR 的結果（敘述、AI 估的份數摘要、知識庫命中），供顯示參考與評價用
  type OcrMeta = {
    caption: string;
    foodSummary: string;
    kb: { dishId: number; caption: string; food: Record<string, number>; up: number; down: number } | null;
    web: { query: string; sources: { title: string; url: string }[] } | null;
  };
  const [ocrResult, setOcrResult] = useState<Record<string, OcrMeta>>({});
  // 對這次 OCR 的評價：敘述與份數各自 1/-1/0
  const [ocrVote, setOcrVote] = useState<Record<string, { caption: number; food: number }>>({});
  const [pageIdx, setPageIdx] = useState(0);

  // 新建流程（尚無任何內容）先選擇「新增照片或略過」；編輯既有紀錄直接進入記錄頁
  const isNew = !!entry && !entryHasData(entry);
  const [step, setStep] = useState<'photos' | 'detail'>(isNew && (entry?.photos.length ?? 0) === 0 ? 'photos' : 'detail');
  const [showHistory, setShowHistory] = useState(false);
  // 點照片放大檢視（燈箱）；存放要開啟的照片索引
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const closing = useRef(false);
  // 開啟視窗當下就有的照片；用來區分「這次視窗內新增的照片」（取消時要還原）
  const initialPhotos = useRef<string[]>(entry?.photos ?? []);

  if (!entry || editingId === null) return null;
  const mealDef = MEALS.find((m) => m.k === entry.meal) || MEALS[0];

  // 頁面清單：照片頁在前、項目頁在後
  const pages: Page[] = [
    ...photos.map((url): Page => ({ kind: 'photo', url })),
    ...itemState.order.map((key): Page => ({ kind: 'item', key })),
  ];
  const cur: Page | undefined = pages[Math.min(pageIdx, pages.length - 1)];
  const curIdx = pages.length ? Math.min(pageIdx, pages.length - 1) : 0;

  const photoFood = (url: string): Food => strToFood(photoFoodsStr[url]);
  const itemFood = (key: string): Food => strToFood(itemState.drafts[key]?.foodStr);
  const pageFood = (p: Page): Food => (p.kind === 'photo' ? photoFood(p.url) : itemFood(p.key));
  const pageCustoms = (p: Page): CustomDraft[] =>
    p.kind === 'photo' ? photoCustomDrafts[p.url] ?? [] : itemState.drafts[p.key]?.customs ?? [];
  const pageKcal = (p: Page): number => kcalOfFood(pageFood(p)) + customDraftsKcal(pageCustoms(p));

  const totalFood = (): Food => sumFoods(pages.map(pageFood));
  const customKcal = pages.reduce((a, p) => a + customDraftsKcal(pageCustoms(p)), 0);
  const kcal = kcalOfFood(totalFood()) + customKcal;

  const setPhotoField = (url: string, key: FoodKey, raw: string) =>
    setPhotoFoodsStr((s) => ({ ...s, [url]: { ...(s[url] ?? emptyFoodStr()), [key]: raw } }));
  const blurPhotoField = (url: string, key: FoodKey) =>
    setPhotoFoodsStr((s) => {
      const v = clampPortion(s[url]?.[key] ?? '');
      return { ...s, [url]: { ...(s[url] ?? emptyFoodStr()), [key]: v ? String(v) : '' } };
    });
  const setItemField = (key: string, fk: FoodKey, raw: string) =>
    setItemState((s) => ({
      ...s,
      drafts: { ...s.drafts, [key]: { ...(s.drafts[key] ?? { foodStr: emptyFoodStr(), customs: [] }), foodStr: { ...(s.drafts[key]?.foodStr ?? emptyFoodStr()), [fk]: raw } } },
    }));
  const blurItemField = (key: string, fk: FoodKey) =>
    setItemState((s) => {
      const v = clampPortion(s.drafts[key]?.foodStr[fk] ?? '');
      return {
        ...s,
        drafts: { ...s.drafts, [key]: { ...(s.drafts[key] ?? { foodStr: emptyFoodStr(), customs: [] }), foodStr: { ...(s.drafts[key]?.foodStr ?? emptyFoodStr()), [fk]: v ? String(v) : '' } } },
      };
    });

  // CustomItemsEditor 需要 useState 形式的 setter：把目前頁的草稿包成一個
  const photoCustomSetter = (url: string): Dispatch<SetStateAction<CustomDraft[]>> => (action) =>
    setPhotoCustomDrafts((s) => ({
      ...s,
      [url]: typeof action === 'function' ? (action as (p: CustomDraft[]) => CustomDraft[])(s[url] ?? []) : action,
    }));
  const itemCustomSetter = (key: string): Dispatch<SetStateAction<CustomDraft[]>> => (action) =>
    setItemState((s) => ({
      ...s,
      drafts: {
        ...s.drafts,
        [key]: {
          ...(s.drafts[key] ?? { foodStr: emptyFoodStr(), customs: [] }),
          customs: typeof action === 'function' ? (action as (p: CustomDraft[]) => CustomDraft[])(s.drafts[key]?.customs ?? []) : action,
        },
      },
    }));

  const MAX_PHOTOS = 10;
  const MAX_ITEM_PAGES = 20;

  // 新增／移除無照片項目頁（純草稿；完成才寫入、取消即捨棄）
  const addItemPage = () => {
    if (itemState.order.length >= MAX_ITEM_PAGES) return;
    const key = `i${itemSeq.current++}`;
    setItemState((s) => ({ order: [...s.order, key], drafts: { ...s.drafts, [key]: { foodStr: emptyFoodStr(), customs: [] } } }));
    setPageIdx(photos.length + itemState.order.length); // 跳到剛新增的項目頁
  };
  const removeItemPage = (key: string) => {
    setItemState((s) => {
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { order: s.order.filter((k) => k !== key), drafts };
    });
    setPageIdx((p) => Math.max(0, Math.min(p, pages.length - 2)));
  };

  // 把某張照片的 AI 敘述組進整筆 desc：同一張重跑會替換自己那行（不重複），
  // 沒有前次則附加到尾端；使用者手打的字永遠保留、不會被蓋掉。desc 一律不回送 API。
  const applyCaption = (url: string, caption: string) => {
    const line = caption.trim();
    if (!line) return;
    const prev = photoCaptions[url];
    setDesc((d) => {
      if (prev && d.includes(prev)) return d.replace(prev, line);
      return d.trim() ? `${d.replace(/\s+$/, '')}\n${line}` : line;
    });
    setPhotoCaptions((s) => ({ ...s, [url]: line }));
  };

  // AI 判斷目前這張照片的六大類份數＋順便寫一句敘述（只在照片頁可用）
  const runOcr = async () => {
    if (cur?.kind !== 'photo' || aiBusy) return;
    const url = cur.url;
    setAiBusy(true);
    setAiError('');
    setAiModel('');
    try {
      const { food, caption, model, kb, web } = await api.aiOcr(entry.id, url);
      setPhotoFoodsStr((s) => ({ ...s, [url]: foodToStr(food) }));
      applyCaption(url, caption);
      setAiModel(model);
      // 記下這次 OCR 結果供顯示參考與評價；重跑會覆蓋、評價歸零
      setOcrResult((s) => ({ ...s, [url]: { caption, foodSummary: foodSummary(food) || '份數皆為 0', kb, web } }));
      setOcrVote((s) => ({ ...s, [url]: { caption: 0, food: 0 } }));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI 判斷失敗，請再試一次');
    } finally {
      setAiBusy(false);
    }
  };

  // 對這次 OCR 的敘述或份數按讚/倒讚（再按同鍵取消）。份數評價會回饋到知識庫該道菜。
  const voteOcr = async (url: string, aspect: 'caption' | 'food', v: 1 | -1) => {
    const curVote = ocrVote[url]?.[aspect] ?? 0;
    const next = (curVote === v ? 0 : v) as 1 | 0 | -1;
    setOcrVote((s) => ({ ...s, [url]: { caption: s[url]?.caption ?? 0, food: s[url]?.food ?? 0, [aspect]: next } }));
    const meta = ocrResult[url];
    try {
      await api.aiFeedback(aspect === 'caption' ? 'ocr_caption' : 'ocr_food', url, next, {
        body: aspect === 'caption' ? meta?.caption : meta?.foodSummary,
        dishId: aspect === 'food' ? meta?.kb?.dishId : undefined,
      });
    } catch { /* 評價失敗不影響記錄 */ }
  };

  // 草稿 → 送出用的三份資料（全空的項目頁剔除，空白紀錄才能維持自動刪除）
  const buildPayload = () => {
    const photoFoods = Object.fromEntries(photos.map((u) => [u, photoFood(u)]));
    const photoCustoms: Record<string, CustomItem[]> = {};
    photos.forEach((u) => {
      const list = customDraftsToItems(photoCustomDrafts[u] ?? []);
      if (list.length) photoCustoms[u] = list;
    });
    const items: EntryFoodItem[] = itemState.order
      .map((key) => ({ food: itemFood(key), customItems: customDraftsToItems(itemState.drafts[key]?.customs ?? []) }))
      .filter((it) => FOOD_KEYS.some((k) => it.food[k] > 0) || it.customItems.length);
    return { photoFoods, photoCustoms, items };
  };

  // 關閉（完成或 ✕）：有資料 → 儲存；空白 entry → 自動刪除
  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    const { photoFoods, photoCustoms, items } = buildPayload();
    const food = sumFoods([...Object.values(photoFoods), ...items.map((it) => it.food)]);
    try {
      if (entryHasData({ desc, photos, food, photoCustoms, items })) {
        // 三份資料一律帶上：清空也要存回（不帶＝後端保留原值）
        await api.patchEntry(entry.id, { desc, eatTime, date: eatDate || selected, photoFoods, photoCustoms, items });
      } else {
        await api.deleteEntry(entry.id);
      }
      await refresh();
    } finally {
      closeModal();
    }
  };

  // 從「＋」剛建立的空白紀錄不顯示刪除鈕（關閉即自動刪除）；編輯既有紀錄才顯示
  const isExisting = entryHasData(entry);

  // 取消（按 ✕）：不儲存這次視窗內的變更。
  // 新建立的空白紀錄整筆刪除（連同這次加入／上傳的照片）；既有紀錄只移除這次新增的照片，
  // 份數／自定義／項目頁的修改因為只在「完成」時才寫入，所以會自動被捨棄。
  const cancel = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      const added = photos.filter((p) => !initialPhotos.current.includes(p));
      if (!isExisting) {
        await api.deleteEntry(entry.id);
      } else if (added.length) {
        await api.patchEntry(entry.id, { photos: photos.filter((p) => initialPhotos.current.includes(p)) });
      }
      await refresh();
    } finally {
      closeModal();
    }
  };

  const remove = async () => {
    if (closing.current) return;
    if (!window.confirm('確定要刪除這筆紀錄？留言與照片會一併刪除。')) return;
    closing.current = true;
    try {
      await api.deleteEntry(entry.id);
      await refresh();
    } finally {
      closeModal();
    }
  };

  const uploadPhotos = async (files: File[]) => {
    if (!files.length || uploading) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = files.slice(0, room);
    if (!picked.length) return;
    setUploading(true);
    try {
      const blobs = await Promise.all(picked.map(compressImage));
      const { photos: urls } = await api.uploadPhotos(entry.id, blobs);
      setPhotoFoodsStr((s) => {
        const next = { ...s };
        urls.forEach((u) => {
          if (!next[u]) next[u] = emptyFoodStr();
        });
        return next;
      });
      // 目前停在項目頁的話，照片頁增加會使索引位移：把索引跟著移，維持停在同一頁
      if (cur?.kind === 'item') {
        const itemIdx = itemState.order.indexOf(cur.key);
        setPageIdx(urls.length + itemIdx);
      }
      setPhotos(urls);
    } catch {
      /* 壓縮或上傳失敗時維持原狀 */
    } finally {
      setUploading(false);
    }
  };

  // 無照片項目頁「補上照片」：上傳後把該項目的份數與自定義搬到新照片上，項目頁移除。
  // 先記錄、之後有空再補照片的動線
  const uploadPhotoForItem = async (key: string, files: File[]) => {
    if (!files.length || uploading) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = files.slice(0, room);
    if (!picked.length) return;
    setUploading(true);
    try {
      const blobs = await Promise.all(picked.map(compressImage));
      const { photos: urls } = await api.uploadPhotos(entry.id, blobs);
      const newUrls = urls.filter((u) => !photos.includes(u));
      const draft = itemState.drafts[key];
      setPhotoFoodsStr((s) => {
        const next = { ...s };
        newUrls.forEach((u, i) => {
          next[u] = i === 0 && draft ? { ...draft.foodStr } : emptyFoodStr();
        });
        return next;
      });
      if (newUrls.length && draft?.customs.length) {
        setPhotoCustomDrafts((s) => ({ ...s, [newUrls[0]]: draft.customs }));
      }
      if (newUrls.length) {
        setItemState((s) => {
          const drafts = { ...s.drafts };
          delete drafts[key];
          return { order: s.order.filter((k) => k !== key), drafts };
        });
      }
      setPhotos(urls);
      setPageIdx(urls.length - 1); // 跳到剛補上的照片頁（照片頁在項目頁之前）
    } catch {
      /* 壓縮或上傳失敗時維持原狀 */
    } finally {
      setUploading(false);
    }
  };

  // 從歷史加入：複製一餐（或其中幾張）到這筆紀錄，帶入各照片的份數與自定義項目。
  // 敘述以「來源紀錄」為單位只帶一次——同一餐再加第二張照片不會重複貼；
  // 該來源的照片全部移除時，帶入的敘述會自動收回（使用者手打的其他文字不動）
  const addFromHistory = async (meal: HistoryMeal, picks: HistoryPhoto[]): Promise<boolean> => {
    const room = MAX_PHOTOS - photos.length;
    const list = picks.slice(0, room);
    if (!list.length) return false;
    try {
      let urls = photos;
      const added: { url: string; item: HistoryPhoto }[] = [];
      for (const item of list) {
        const { photos: next, photo: newUrl } = await api.copyPhoto(entry.id, item.photo);
        urls = next;
        added.push({ url: newUrl, item });
      }
      setPhotoFoodsStr((s) => {
        const next = { ...s };
        added.forEach(({ url, item }) => (next[url] = foodToStr(item.food)));
        return next;
      });
      setPhotoCustomDrafts((s) => {
        const next = { ...s };
        added.forEach(({ url, item }) => {
          if (item.customItems.length) next[url] = customItemsToDrafts(item.customItems);
        });
        return next;
      });
      setPhotoSources((s) => ({ ...s, ...Object.fromEntries(added.map(({ url }) => [url, meal.entryId])) }));
      const line = meal.desc.trim();
      if (line && historyDescs[meal.entryId] === undefined) {
        setDesc((d) => (d.includes(line) ? d : d.trim() ? `${d.replace(/\s+$/, '')}\n${line}` : line));
        setHistoryDescs((s) => ({ ...s, [meal.entryId]: line }));
      }
      setPhotos(urls);
      setPageIdx(urls.length - 1); // 跳到剛加入的最後一張（照片頁在項目頁之前）
      if (step === 'photos') setStep('detail');
      return true;
    } catch {
      return false;
    }
  };

  const removePhoto = async (url: string) => {
    try {
      const { photos: urls } = await api.patchEntry(entry.id, { photos: photos.filter((p) => p !== url) });
      setPhotos(urls);
      setPhotoFoodsStr((s) => {
        const next = { ...s };
        delete next[url];
        return next;
      });
      // 這張照片的自定義草稿與 OCR 狀態一併清掉，橫幅熱量才不會殘留已刪照片的項目
      setPhotoCustomDrafts((s) => {
        const next = { ...s };
        delete next[url];
        return next;
      });
      setOcrResult((s) => {
        const next = { ...s };
        delete next[url];
        return next;
      });
      setOcrVote((s) => {
        const next = { ...s };
        delete next[url];
        return next;
      });
      // 若這張照片曾由 AI 把敘述組進 desc，一併移除那一行（使用者手打的其他內容保留）
      const cap = photoCaptions[url];
      if (cap) {
        setDesc((d) => (d.includes(cap) ? d.split('\n').filter((ln) => ln.trim() !== cap).join('\n') : d));
        setPhotoCaptions((s) => {
          const next = { ...s };
          delete next[url];
          return next;
        });
      }
      // 從歷史帶入的照片：該來源的照片全移除時，收回帶入的敘述
      const src = photoSources[url];
      if (src !== undefined) {
        const stillHas = Object.entries(photoSources).some(([u, v]) => u !== url && v === src);
        setPhotoSources((s) => {
          const next = { ...s };
          delete next[url];
          return next;
        });
        const line = historyDescs[src];
        if (!stillHas && line) {
          setDesc((d) => (d.includes(line) ? d.replace(line, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '') : d));
          setHistoryDescs((s) => {
            const next = { ...s };
            delete next[src];
            return next;
          });
        }
      }
      setPageIdx((p) => Math.max(0, Math.min(p, pages.length - 2)));
    } catch {
      /* ignore */
    }
  };

  const photoGridCell = (url: string) => (
    <div key={url} style={{ position: 'relative', aspectRatio: '1', borderRadius: 14, border: '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')` }}>
      <button
        onClick={() => void removePhoto(url)}
        title="移除這張照片"
        style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, border: 'none', borderRadius: '50%', background: 'rgba(45,59,45,.65)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        ✕
      </button>
      <PhotoRatingBadge rating={entry.ratings[url]} />
    </div>
  );

  const addPhotoCell = (label: string) => (
    <label style={{ aspectRatio: '1', border: '1.5px dashed #C9C2B2', borderRadius: 14, background: '#FBFAF6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: uploading ? 'default' : 'pointer', color: '#8A9284', opacity: uploading ? 0.6 : 1 }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="14" rx="3" /><circle cx="12" cy="13" r="3.5" /><path d="M9 6l1.2-2h3.6L15 6" /></svg>
      <span style={{ fontSize: 11 }}>{uploading ? '上傳中…' : label}</span>
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={uploading}
        onChange={(e) => { const files = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; void uploadPhotos(files); }}
        style={{ display: 'none' }}
      />
    </label>
  );

  // 「從歷史加入」按鈕（照片未達上限才顯示）與歷史選擇視窗
  const historyButton = photos.length < MAX_PHOTOS && (
    <button
      onClick={() => setShowHistory(true)}
      className="hv-cream"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, flex: 'none', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', color: '#4A5A4A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 106 5.3L3 8" /><path d="M12 7v5l3 2" /></svg>
      從歷史紀錄加入
    </button>
  );
  const historySheet = showHistory && (
    <HistoryPickerSheet
      excludeId={entry.id}
      remaining={MAX_PHOTOS - photos.length}
      onPick={(meal, picks) => addFromHistory(meal, picks)}
      onClose={() => setShowHistory(false)}
    />
  );

  // 縮圖列的「＋項目」格：新增一個無照片的食物項目頁
  const addItemTile = itemState.order.length < MAX_ITEM_PAGES && (
    <button
      onClick={addItemPage}
      title="新增無照片的食物項目"
      style={{ flex: 'none', width: 58, height: 58, border: '1.5px dashed #C9C2B2', borderRadius: 12, background: '#FBFAF6', color: '#8A9284', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0 }}
    >
      <span style={{ fontSize: 17, lineHeight: 1 }}>＋</span>
      項目
    </button>
  );

  const curCustoms = cur ? pageCustoms(cur) : [];

  // 單一 return：步驟一（照片）與步驟二（詳細）共用同一棵樹，讓 historySheet／Lightbox
  // 位置固定，切換步驟時不會被 React 卸載重建（否則歷史視窗會閃一下並跳回第一個餐別分頁）
  return (
    <>
    {step === 'photos' ? (
      // 步驟一：先新增照片或略過
      <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>記錄{mealDef.name}</div>
          <CloseButton onClick={() => void cancel()} />
        </div>
        <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13.5, color: '#6B7565', lineHeight: 1.7 }}>
            先幫這餐拍幾張照片（最多 {MAX_PHOTOS} 張，可一次選多張），接下來會<b>逐張記錄六大類份數與自定義熱量</b>；也可以略過照片直接記錄，或<b>從歷史紀錄加入</b>吃過的餐點。
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
            {photos.map(photoGridCell)}
            {photos.length < MAX_PHOTOS && addPhotoCell('新增照片')}
          </div>
          {historyButton}
          {photos.length > 0 ? (
            <button onClick={() => setStep('detail')} className="hv-green" style={{ height: 48, flex: 'none', border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              開始記錄份數（共 {photos.length} 張）
            </button>
          ) : (
            <button
              onClick={() => { if (!pages.length) addItemPage(); setStep('detail'); }}
              className="hv-sand"
              style={{ height: 48, flex: 'none', border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', color: '#4A5A4A', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
            >
              略過照片，直接記錄
            </button>
          )}
        </div>
      </ModalShell>
    ) : (
      <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄{mealDef.name}</div>
        <CloseButton onClick={() => void cancel()} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 這餐熱量（所有頁面份數＋自定義項目的總和） */}
        <div style={{ background: '#EDF2E6', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#4A7C59' }}>
            {mealDef.name}熱量{pages.length > 1 ? '（總和）' : ''}
            {customKcal > 0 && <span style={{ fontSize: 11.5, fontWeight: 500, color: '#8A9284' }}>・含自定義 {customKcal} kcal</span>}
          </span>
          <span style={{ fontFamily: 'Outfit', fontSize: 24, fontWeight: 800, color: '#2D3B2D' }}>
            {kcal} <span style={{ fontSize: 13, fontWeight: 500, color: '#8A9284' }}>kcal</span>
          </span>
        </div>
        {/* 用餐時間 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>用餐時間（改日期會把這筆紀錄移到該天）</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <PickerInput
              type="date"
              value={eatDate}
              onChange={(e) => setEatDate(e.target.value)}
              style={{ flex: 1, minWidth: 0, height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 14, outline: 'none', background: '#FBFAF6' }}
            />
            <PickerInput
              type="time"
              value={eatTime}
              onChange={(e) => setEatTime(e.target.value)}
              style={{ flex: 1, minWidth: 0, height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 14, outline: 'none', background: '#FBFAF6' }}
            />
          </div>
        </div>
        {/* 敘述：整筆共用，不論幾頁都只有一個 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>這餐吃了什麼？{pages.length > 1 ? '（所有頁面共用）' : ''}</label>
          <textarea
            rows={3}
            placeholder="例：滷雞腿便當，飯只吃一半⋯"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '10px 12px', fontSize: 14.5, outline: 'none', background: '#FBFAF6', resize: 'none' }}
          />
        </div>

        {historyButton}

        {entry.foodEditedAt > 0 && (
          <div style={{ fontSize: 12.5, color: '#5B8DB8', background: '#E5EBF1', borderRadius: 10, padding: '8px 12px', lineHeight: 1.6, fontWeight: 700 }}>
            此筆份數已由營養師於 {fmtCommentTime(entry.foodEditedAt)} 調整；若自行修改，此標記將移除。
          </div>
        )}

        {!cur ? (
          // 沒有任何頁：加照片或加無照片項目
          <>
            <div style={{ fontSize: 12.5, color: '#6B7565', lineHeight: 1.7 }}>
              新增餐點照片逐張記錄，或新增「無照片項目」直接記份數與熱量。
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
              {addPhotoCell('新增照片')}
            </div>
            <button onClick={addItemPage} className="hv-sand" style={{ height: 44, flex: 'none', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', color: '#4A5A4A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              ＋新增無照片的食物項目
            </button>
            <button onClick={() => void finish()} className="hv-green" style={{ height: 48, flex: 'none', border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              完成
            </button>
          </>
        ) : (
          <>
            {/* 逐頁記錄：照片頁或無照片項目頁 */}
            <div style={{ borderTop: '1px solid #F0EDE3', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: '#2D3B2D' }}>
                  第 {curIdx + 1} / {pages.length} 頁{cur.kind === 'item' ? '・無照片項目' : ''}
                </span>
                <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 700, color: '#4A7C59' }}>{pageKcal(cur)} kcal</span>
                <span style={{ flex: 1 }} />
                {cur.kind === 'item' && (
                  <button onClick={() => removeItemPage(cur.key)} className="hv-red-tint" style={{ flex: 'none', border: '1px solid #E4C9C2', color: '#C0564A', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
                    移除此項目
                  </button>
                )}
                <button onClick={() => openGuide()} className="hv-cream" style={{ flex: 'none', border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
                  份數指南
                </button>
              </div>
              {cur.kind === 'photo' && (
                <div style={{ position: 'relative', flex: 'none' }}>
                  <button
                    onClick={() => setLightboxIndex(curIdx)}
                    title="點擊放大檢視"
                    style={{ display: 'block', width: '100%', height: 190, borderRadius: 14, border: '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundImage: `url('${cur.url}')`, cursor: 'zoom-in', padding: 0 }}
                  />
                  <button
                    onClick={() => void removePhoto(cur.url)}
                    title="移除這張照片"
                    style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, border: 'none', borderRadius: '50%', background: 'rgba(45,59,45,.65)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                  <PhotoRatingBadge rating={entry.ratings[cur.url]} />
                </div>
              )}
              {cur.kind === 'item' && photos.length < MAX_PHOTOS && (
                // 先記錄、之後補照片：上傳後這個項目的份數與自定義會搬到新照片上
                <label style={{ flex: 'none', height: 88, border: '1.5px dashed #C9C2B2', borderRadius: 14, background: '#FBFAF6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: uploading ? 'default' : 'pointer', color: '#8A9284', opacity: uploading ? 0.6 : 1 }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="14" rx="3" /><circle cx="12" cy="13" r="3.5" /><path d="M9 6l1.2-2h3.6L15 6" /></svg>
                  <span style={{ fontSize: 12 }}>{uploading ? '上傳中…' : '補上這個項目的照片（已填的份數與自定義會跟著照片）'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploading}
                    onChange={(e) => { const files = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; if (cur.kind === 'item') void uploadPhotoForItem(cur.key, files); }}
                    style={{ display: 'none' }}
                  />
                </label>
              )}
              {/* 縮圖列：照片頁縮圖＋項目頁圖格；點格子跳頁；最後是新增照片／新增項目 */}
              <div style={{ flex: 'none', display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
                {pages.map((p, i) =>
                  p.kind === 'photo' ? (
                    <button
                      key={p.url}
                      onClick={() => setPageIdx(i)}
                      style={{ flex: 'none', width: 58, height: 58, borderRadius: 12, border: i === curIdx ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${p.url}')`, cursor: 'pointer', padding: 0 }}
                    />
                  ) : (
                    <button
                      key={p.key}
                      onClick={() => setPageIdx(i)}
                      title="無照片的食物項目"
                      style={{ flex: 'none', width: 58, height: 58, borderRadius: 12, border: i === curIdx ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', background: '#F0EDE3', color: '#8A9284', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20h16" /><path d="M6 20a6 6 0 0 1 12 0" /><circle cx="12" cy="9" r="1.2" /></svg>
                    </button>
                  )
                )}
                {photos.length < MAX_PHOTOS && (
                  <div style={{ flex: 'none', width: 58 }}>{addPhotoCell('新增')}</div>
                )}
                {addItemTile}
              </div>
              <div style={{ fontSize: 12.5, color: '#6B7565' }}>
                {cur.kind === 'photo'
                  ? <>輸入<b>這張照片</b>的份數與自定義熱量，記好一頁換下一頁。</>
                  : <>輸入<b>這個項目</b>的份數與自定義熱量（沒拍到照片的食物、飲料都可以記在這裡）。</>}
              </div>
              {cur.kind === 'photo' && aiEnabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <button
                    onClick={() => void runOcr()}
                    disabled={aiBusy}
                    className="hv-cream"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, border: '1.5px solid #D9CEEA', borderRadius: 12, background: '#F6F3FB', color: '#7A5AB8', fontSize: 14, fontWeight: 700, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.65 : 1 }}
                  >
                    <span style={{ fontSize: 15 }}>✨</span>
                    {aiBusy ? 'AI 判斷中…' : 'AI 判斷份數並幫忙寫敘述'}
                  </button>
                  <div style={{ fontSize: 11.5, color: aiError ? '#C0564A' : '#8A9284', lineHeight: 1.5 }}>
                    {aiError
                      || (aiModel
                        ? `已由模型 ${aiModel} 估算份數並把敘述補進上方，可再自行微調。`
                        : 'AI 會估算這張照片的份數（填入下方，肉類預設中脂、乳品預設低脂），並把一句敘述補進上方「這餐吃了什麼」，都可再自行修改。')}
                  </div>
                  {/* 這次 OCR 的評價：敘述與份數分開，回饋給 AI 越用越準；份數評價也會回饋到共用知識庫 */}
                  {ocrResult[cur.url] && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#FBF9FE', border: '1px solid #EAE2F5', borderRadius: 10, padding: '8px 10px' }}>
                      {ocrResult[cur.url].kb && (
                        <div style={{ fontSize: 11.5, color: '#6B7565', lineHeight: 1.5 }}>
                          💡 類似菜色社群參考份數：{sixCatText(ocrResult[cur.url].kb!.food)}
                          <span style={{ color: '#8A9284' }}>（👍{ocrResult[cur.url].kb!.up}・👎{ocrResult[cur.url].kb!.down}）</span>
                        </div>
                      )}
                      {ocrResult[cur.url].web && (
                        <div style={{ fontSize: 11.5, color: '#6B7565', lineHeight: 1.5 }}>
                          🔎 已依網路營養資訊校正份數（{ocrResult[cur.url].web!.query}）
                        </div>
                      )}
                      <div style={{ fontSize: 11.5, color: '#7A5AB8', fontWeight: 700 }}>這次 AI 判斷準嗎？（幫助 AI 越來越準）</div>
                      {(['caption', 'food'] as const).map((aspect) => {
                        const v = ocrVote[cur.url]?.[aspect] ?? 0;
                        const label = aspect === 'caption' ? '敘述' : '份數';
                        return (
                          <div key={aspect} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#4A5A4A', width: 30 }}>{label}</span>
                            <button onClick={() => cur.kind === 'photo' && void voteOcr(cur.url, aspect, 1)} title="準" style={{ border: `1px solid ${v === 1 ? '#4A7C59' : '#DDD8CA'}`, background: v === 1 ? '#E3EBD9' : '#fff', color: v === 1 ? '#3B6647' : '#8A9284', borderRadius: 99, padding: '2px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>👍</button>
                            <button onClick={() => cur.kind === 'photo' && void voteOcr(cur.url, aspect, -1)} title="不準" style={{ border: `1px solid ${v === -1 ? '#C0564A' : '#DDD8CA'}`, background: v === -1 ? '#F5E3DB' : '#fff', color: v === -1 ? '#A8433A' : '#8A9284', borderRadius: 99, padding: '2px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>👎</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 這一頁的份數／自定義分頁 */}
              <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                {([
                  ['portions', '六大類份數', 0],
                  ['custom', '自定義', curCustoms.length],
                ] as const).map(([k, label, count]) => {
                  const on = tab === k;
                  return (
                    <button
                      key={k}
                      onClick={() => setTab(k)}
                      style={{
                        flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 34, padding: '0 13px', borderRadius: 99,
                        border: on ? '1.5px solid #4A7C59' : '1.5px solid #E4DFD2',
                        background: on ? '#4A7C59' : '#fff', color: on ? '#fff' : '#4A5A4A',
                        fontSize: 13, fontWeight: 800, cursor: 'pointer',
                      }}
                    >
                      <span>{label}</span>
                      {count > 0 && <span style={{ fontFamily: 'Outfit', fontSize: 11.5, opacity: 0.85 }}>{count}</span>}
                    </button>
                  );
                })}
              </div>

              {tab === 'portions' ? (
                cur.kind === 'photo' ? (
                  <FoodFields
                    key={cur.url}
                    foodStr={photoFoodsStr[cur.url] ?? emptyFoodStr()}
                    onChange={(k, raw) => cur.kind === 'photo' && setPhotoField(cur.url, k, raw)}
                    onBlur={(k) => cur.kind === 'photo' && blurPhotoField(cur.url, k)}
                  />
                ) : (
                  <FoodFields
                    key={cur.key}
                    foodStr={itemState.drafts[cur.key]?.foodStr ?? emptyFoodStr()}
                    onChange={(k, raw) => cur.kind === 'item' && setItemField(cur.key, k, raw)}
                    onBlur={(k) => cur.kind === 'item' && blurItemField(cur.key, k)}
                  />
                )
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: '#6B7565', lineHeight: 1.7 }}>
                    六大類份數無法表達的食物（含糖飲料、酒精等），可在這裡直接記熱量，會計入{cur.kind === 'photo' ? '這張照片' : '這個項目'}與這餐、當日的攝取熱量。
                  </div>
                  <CustomItemsEditor
                    key={cur.kind === 'photo' ? cur.url : cur.key}
                    drafts={curCustoms}
                    setDrafts={cur.kind === 'photo' ? photoCustomSetter(cur.url) : itemCustomSetter(cur.key)}
                    history={api.customItemHistory}
                  />
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {curIdx > 0 && (
                <button onClick={() => setPageIdx(curIdx - 1)} className="hv-sand" style={{ flex: 1, height: 48, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', color: '#4A5A4A', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  上一頁
                </button>
              )}
              {curIdx < pages.length - 1 ? (
                <button onClick={() => setPageIdx(curIdx + 1)} className="hv-green" style={{ flex: 2, height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  下一頁
                </button>
              ) : (
                <button onClick={() => void finish()} className="hv-green" style={{ flex: 2, height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  完成
                </button>
              )}
            </div>
          </>
        )}

        {isExisting && (
          <button onClick={() => void remove()} className="hv-red-tint" style={{ height: 40, flex: 'none', border: 'none', background: 'transparent', color: '#C0564A', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            刪除這筆紀錄
          </button>
        )}
      </div>
    </ModalShell>
    )}
    {lightboxIndex !== null && (
      <Lightbox
        photos={photos}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        caption={(url) => {
          const f = photoFood(url);
          const customs = customDraftsToItems(photoCustomDrafts[url] ?? []);
          const summary = foodSummary(f);
          const customText = customs.map((c) => `${c.name || (c.type === 'sugar' ? '糖' : c.type === 'alcohol' ? '酒精' : '蛋白質')} ${c.kcal} kcal`).join('、');
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#B8CDBB' }}>
                這張照片的份數・{kcalOfFood(f) + customs.reduce((a, c) => a + c.kcal, 0)} kcal
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                {[summary, customText].filter(Boolean).join('；') || '尚未記錄這張照片的份數'}
              </div>
            </div>
          );
        }}
      />
    )}
    {historySheet}
    </>
  );
}

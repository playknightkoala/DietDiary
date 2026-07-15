import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { compressImage } from '../../lib/photo';
import { FOOD_KEYS, MEALS, clampPortion, emptyFood, entryHasData, fmtCommentTime, kcalOfFood, sumFoods } from '../../lib/domain';
import { useStore } from '../../store';
import type { Food, FoodKey, HistoryItem } from '../../types';
import { FoodFields } from '../FoodFields';
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

// 記錄飲食：先新增照片（或略過）→ 逐張照片記錄六大類份數；敘述為整筆共用，貼文顯示總和
export function LogFoodModal() {
  const editingId = useStore((s) => s.editingId);
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);
  const openGuide = useStore((s) => s.openGuide);

  const entry = useMemo(() => day.entries.find((e) => e.id === editingId) ?? null, [day.entries, editingId]);

  const [desc, setDesc] = useState(entry?.desc ?? '');
  const [photos, setPhotos] = useState<string[]>(entry?.photos ?? []);
  const [uploading, setUploading] = useState(false);
  // 用餐時間：預設為目前檢視的日期＋紀錄上的時間；改日期會把這筆移到該天
  const [eatDate, setEatDate] = useState(selected);
  const [eatTime, setEatTime] = useState(entry?.eatTime ?? '');

  // 逐張照片的份數字串；無照片時使用整筆層級（entryFoodStr）
  // 舊資料（有照片但沒逐張份數）：把整筆份數先放到第一張，總和不變
  const [photoFoodsStr, setPhotoFoodsStr] = useState<Record<string, FoodStr>>(() => {
    if (!entry) return {};
    const init: Record<string, FoodStr> = {};
    entry.photos.forEach((url) => (init[url] = foodToStr(entry.photoFoods[url] ?? emptyFood())));
    const hasAny = entry.photos.some((url) => FOOD_KEYS.some((k) => (entry.photoFoods[url]?.[k] ?? 0) > 0));
    if (entry.photos.length && !hasAny && FOOD_KEYS.some((k) => entry.food[k] > 0)) {
      init[entry.photos[0]] = foodToStr(entry.food);
    }
    return init;
  });
  const [entryFoodStr, setEntryFoodStr] = useState<FoodStr>(() => (entry ? foodToStr(entry.food) : emptyFoodStr()));
  const [page, setPage] = useState(0);

  // 新建流程（尚無任何內容）先選擇「新增照片或略過」；編輯既有紀錄直接進入記錄頁
  const isNew = !!entry && !entryHasData(entry);
  const [step, setStep] = useState<'photos' | 'detail'>(isNew && (entry?.photos.length ?? 0) === 0 ? 'photos' : 'detail');
  const [showHistory, setShowHistory] = useState(false);
  const closing = useRef(false);
  // 開啟視窗當下就有的照片；用來區分「這次視窗內新增的照片」（取消時要還原）
  const initialPhotos = useRef<string[]>(entry?.photos ?? []);

  if (!entry || editingId === null) return null;
  const mealDef = MEALS.find((m) => m.k === entry.meal) || MEALS[0];

  const photoFood = (url: string): Food => strToFood(photoFoodsStr[url]);
  const totalFood = (): Food => (photos.length ? sumFoods(photos.map(photoFood)) : strToFood(entryFoodStr));
  const kcal = kcalOfFood(totalFood());
  const currentUrl = photos[Math.min(page, photos.length - 1)];

  const setPhotoField = (url: string, key: FoodKey, raw: string) =>
    setPhotoFoodsStr((s) => ({ ...s, [url]: { ...(s[url] ?? emptyFoodStr()), [key]: raw } }));
  const blurPhotoField = (url: string, key: FoodKey) =>
    setPhotoFoodsStr((s) => {
      const v = clampPortion(s[url]?.[key] ?? '');
      return { ...s, [url]: { ...(s[url] ?? emptyFoodStr()), [key]: v ? String(v) : '' } };
    });

  // 關閉（完成或 ✕）：有資料 → 儲存；空白 entry → 自動刪除
  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    const food = totalFood();
    try {
      if (entryHasData({ desc, photos, food })) {
        const patch: Parameters<typeof api.patchEntry>[1] = { desc, eatTime, date: eatDate || selected };
        if (photos.length) patch.photoFoods = Object.fromEntries(photos.map((u) => [u, photoFood(u)]));
        else patch.food = food;
        await api.patchEntry(entry.id, patch);
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
  // 份數／敘述的修改因為只在「完成」時才寫入，所以會自動被捨棄。
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

  const MAX_PHOTOS = 10;

  const uploadPhotos = async (files: File[]) => {
    if (!files.length || uploading) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = files.slice(0, room);
    if (!picked.length) return;
    setUploading(true);
    try {
      const blobs = await Promise.all(picked.map(compressImage));
      const { photos: urls } = await api.uploadPhotos(entry.id, blobs);
      // 原本沒有照片：把已輸入的整筆份數帶到第一張，總和不變
      setPhotoFoodsStr((s) => {
        const next = { ...s };
        const hadPhotos = photos.length > 0;
        urls.forEach((u, i) => {
          if (!next[u]) next[u] = !hadPhotos && i === 0 ? { ...entryFoodStr } : emptyFoodStr();
        });
        return next;
      });
      setPhotos(urls);
    } catch {
      /* 壓縮或上傳失敗時維持原狀 */
    } finally {
      setUploading(false);
    }
  };

  // 從歷史加入：複製該照片到這筆紀錄，並把它的份數帶入該張（總和自動更新）
  const addFromHistory = async (item: HistoryItem): Promise<boolean> => {
    if (photos.length >= MAX_PHOTOS) return false;
    try {
      const { photos: urls, photo: newUrl } = await api.copyPhoto(entry.id, item.photo);
      setPhotoFoodsStr((s) => ({ ...s, [newUrl]: foodToStr(item.food) }));
      setPhotos(urls);
      setPage(urls.length - 1); // 跳到剛加入的這張
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
      setPage((p) => Math.max(0, Math.min(p, urls.length - 1)));
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
      onPick={addFromHistory}
      onClose={() => setShowHistory(false)}
    />
  );

  // 步驟一：先新增照片或略過
  if (step === 'photos') {
    return (
      <>
      <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>記錄{mealDef.name}</div>
          <CloseButton onClick={() => void cancel()} />
        </div>
        <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13.5, color: '#6B7565', lineHeight: 1.7 }}>
            先幫這餐拍幾張照片（最多 {MAX_PHOTOS} 張，可一次選多張），接下來會<b>逐張記錄六大類份數</b>；也可以略過照片直接記錄，或<b>從歷史紀錄加入</b>吃過的餐點。
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
            <button onClick={() => setStep('detail')} className="hv-sand" style={{ height: 48, flex: 'none', border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', color: '#4A5A4A', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              略過照片，直接記錄
            </button>
          )}
        </div>
      </ModalShell>
      {historySheet}
      </>
    );
  }

  const hasPhotos = photos.length > 0;

  return (
    <>
    <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄{mealDef.name}</div>
        <CloseButton onClick={() => void cancel()} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 這餐熱量（各照片份數的總和） */}
        <div style={{ background: '#EDF2E6', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#4A7C59' }}>{mealDef.name}熱量{hasPhotos ? '（總和）' : ''}</span>
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
        {/* 敘述：整筆共用，不論幾張照片都只有一個 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>這餐吃了什麼？{hasPhotos ? '（所有照片共用）' : ''}</label>
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

        {hasPhotos ? (
          <>
            {/* 逐張照片：目前這張＋份數輸入 */}
            <div style={{ borderTop: '1px solid #F0EDE3', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 900, color: '#2D3B2D' }}>第 {Math.min(page, photos.length - 1) + 1} / {photos.length} 張照片</span>
                <span style={{ fontFamily: 'Outfit', fontSize: 13, fontWeight: 700, color: '#4A7C59' }}>{kcalOfFood(photoFood(currentUrl))} kcal</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => openGuide()} className="hv-cream" style={{ flex: 'none', border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
                  份數指南
                </button>
              </div>
              <div style={{ position: 'relative', flex: 'none' }}>
                <div style={{ height: 190, borderRadius: 14, border: '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', backgroundImage: `url('${currentUrl}')` }} />
                <button
                  onClick={() => void removePhoto(currentUrl)}
                  title="移除這張照片"
                  style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, border: 'none', borderRadius: '50%', background: 'rgba(45,59,45,.65)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer' }}
                >
                  ✕
                </button>
                <PhotoRatingBadge rating={entry.ratings[currentUrl]} />
              </div>
              {/* 縮圖列：點縮圖跳頁；最後是新增照片 */}
              <div style={{ flex: 'none', display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                {photos.map((url, i) => (
                  <button
                    key={url}
                    onClick={() => setPage(i)}
                    style={{ flex: 'none', width: 44, height: 44, borderRadius: 10, border: i === Math.min(page, photos.length - 1) ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')`, cursor: 'pointer', padding: 0 }}
                  />
                ))}
                {photos.length < MAX_PHOTOS && (
                  <div style={{ flex: 'none', width: 44 }}>{addPhotoCell('新增')}</div>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: '#6B7565' }}>輸入<b>這張照片</b>的六大類份數（0.1 ～ 99），記好一張換下一張。</div>
              <FoodFields
                key={currentUrl}
                foodStr={photoFoodsStr[currentUrl] ?? emptyFoodStr()}
                onChange={(k, raw) => setPhotoField(currentUrl, k, raw)}
                onBlur={(k) => blurPhotoField(currentUrl, k)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {page > 0 && (
                <button onClick={() => setPage((p) => p - 1)} className="hv-sand" style={{ flex: 1, height: 48, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', color: '#4A5A4A', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  上一張
                </button>
              )}
              {page < photos.length - 1 ? (
                <button onClick={() => setPage((p) => p + 1)} className="hv-green" style={{ flex: 2, height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  下一張
                </button>
              ) : (
                <button onClick={() => void finish()} className="hv-green" style={{ flex: 2, height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  完成
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {/* 無照片：整筆份數（照舊），也可在此補照片改為逐張記錄 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, color: '#6B7565' }}>餐點照片（補上照片後改為逐張記錄份數）</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
                {addPhotoCell('新增照片')}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, color: '#6B7565' }}>輸入這餐的六大類份數（0.1 ～ 99）。</span>
              <button onClick={() => openGuide()} className="hv-cream" style={{ flex: 'none', border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
                份數指南
              </button>
            </div>
            <FoodFields
              foodStr={entryFoodStr}
              onChange={(k, raw) => setEntryFoodStr((s) => ({ ...s, [k]: raw }))}
              onBlur={(k) => setEntryFoodStr((s) => { const v = clampPortion(s[k] ?? ''); return { ...s, [k]: v ? String(v) : '' }; })}
            />
            <button onClick={() => void finish()} className="hv-green" style={{ height: 48, flex: 'none', border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              完成
            </button>
          </>
        )}

        {isExisting && (
          <button onClick={() => void remove()} className="hv-red-tint" style={{ height: 40, flex: 'none', border: 'none', background: 'transparent', color: '#C0564A', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
            刪除這筆紀錄
          </button>
        )}
      </div>
    </ModalShell>
    {historySheet}
    </>
  );
}

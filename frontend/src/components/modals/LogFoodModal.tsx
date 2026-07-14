import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { compressImage } from '../../lib/photo';
import { FOOD_KEYS, MEALS, clampPortion, emptyFood, entryHasData, fmtCommentTime, kcalOfFood } from '../../lib/domain';
import { useStore } from '../../store';
import type { Food, FoodKey } from '../../types';
import { FoodFields } from '../FoodFields';
import { PhotoRatingBadge } from '../PhotoRatingBadge';
import { PickerInput } from '../PickerInput';
import { CloseButton, ModalShell } from './ModalShell';

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
  const [foodStr, setFoodStr] = useState<Record<FoodKey, string>>(() => {
    const init = {} as Record<FoodKey, string>;
    const f = entry?.food ?? emptyFood();
    FOOD_KEYS.forEach((k) => (init[k] = f[k] ? String(f[k]) : ''));
    return init;
  });
  const closing = useRef(false);

  if (!entry || editingId === null) return null;
  const mealDef = MEALS.find((m) => m.k === entry.meal) || MEALS[0];

  const draftFood = (): Food => {
    const f = emptyFood();
    FOOD_KEYS.forEach((k) => (f[k] = clampPortion(foodStr[k])));
    return f;
  };
  const kcal = kcalOfFood(draftFood());

  const setField = (key: FoodKey, raw: string) => setFoodStr((s) => ({ ...s, [key]: raw }));
  const blurField = (key: FoodKey) => {
    const v = clampPortion(foodStr[key]);
    setFoodStr((s) => ({ ...s, [key]: v ? String(v) : '' }));
  };

  // 關閉（完成或 ✕）：有資料 → 儲存；空白 entry → 自動刪除（同原型 pruneEmptyEntries）
  const finish = async () => {
    if (closing.current) return;
    closing.current = true;
    const food = draftFood();
    try {
      if (entryHasData({ desc, photos, food })) {
        await api.patchEntry(entry.id, { desc, food, eatTime, date: eatDate || selected });
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
      setPhotos(urls);
    } catch {
      /* 壓縮或上傳失敗時維持原狀 */
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (url: string) => {
    try {
      const { photos: urls } = await api.patchEntry(entry.id, { photos: photos.filter((p) => p !== url) });
      setPhotos(urls);
    } catch {
      /* ignore */
    }
  };

  return (
    <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>記錄{mealDef.name}</div>
        <CloseButton onClick={() => void finish()} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 這餐熱量 */}
        <div style={{ background: '#EDF2E6', borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#4A7C59' }}>{mealDef.name}熱量</span>
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
        {/* 敘述 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>這餐吃了什麼？</label>
          <textarea
            rows={3}
            placeholder="例：滷雞腿便當，飯只吃一半⋯"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '10px 12px', fontSize: 14.5, outline: 'none', background: '#FBFAF6', resize: 'none' }}
          />
        </div>
        {/* 照片（最多 6 張） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12.5, color: '#6B7565' }}>餐點照片（最多 {MAX_PHOTOS} 張，可一次選多張）</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 8 }}>
            {photos.map((url) => (
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
            ))}
            {photos.length < MAX_PHOTOS && (
              <label style={{ aspectRatio: '1', border: '1.5px dashed #C9C2B2', borderRadius: 14, background: '#FBFAF6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: uploading ? 'default' : 'pointer', color: '#8A9284', opacity: uploading ? 0.6 : 1 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="14" rx="3" /><circle cx="12" cy="13" r="3.5" /><path d="M9 6l1.2-2h3.6L15 6" /></svg>
                <span style={{ fontSize: 11 }}>{uploading ? '上傳中…' : '新增照片'}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={(e) => { const files = e.target.files ? Array.from(e.target.files) : []; e.target.value = ''; void uploadPhotos(files); }}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>
        </div>
        {/* 份數輸入 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: '#6B7565' }}>輸入這餐的六大類份數（0.1 ～ 99）。</span>
          <button onClick={() => openGuide()} className="hv-cream" style={{ flex: 'none', border: '1px solid #4A7C59', color: '#4A7C59', background: 'transparent', borderRadius: 99, fontSize: 12, padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}>
            份數指南
          </button>
        </div>
        {entry.foodEditedAt > 0 && (
          <div style={{ fontSize: 12.5, color: '#5B8DB8', background: '#E5EBF1', borderRadius: 10, padding: '8px 12px', lineHeight: 1.6, fontWeight: 700 }}>
            此筆份數已由營養師於 {fmtCommentTime(entry.foodEditedAt)} 調整；若自行修改，此標記將移除。
          </div>
        )}
        <FoodFields foodStr={foodStr} onChange={setField} onBlur={blurField} />
        <button onClick={() => void finish()} className="hv-green" style={{ height: 48, flex: 'none', border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>完成</button>
        {isExisting && (
          <button onClick={() => void remove()} className="hv-red-tint" style={{ height: 40, flex: 'none', border: 'none', borderRadius: 13, background: 'transparent', color: '#C0564A', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>刪除這筆紀錄</button>
        )}
      </div>
    </ModalShell>
  );
}

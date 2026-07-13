import { useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { compressImage } from '../../lib/photo';
import { FOOD_KEYS, MEALS, clampPortion, emptyFood, entryHasData, kcalOfFood } from '../../lib/domain';
import { useStore } from '../../store';
import type { Food, FoodKey } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

interface InputGroup {
  name: string;
  glyph: string;
  tint: string;
  color: string;
  note: string;
  fields: { key: FoodKey; label: string }[];
}

const INPUT_GROUPS: InputGroup[] = [
  { name: '蛋豆魚肉', glyph: '蛋', tint: '#F5E3DB', color: '#C0564A', note: '55–135 卡/份',
    fields: [
      { key: 'meatLow', label: '低脂（55卡）' },
      { key: 'meatMed', label: '中脂（75卡）' },
      { key: 'meatHigh', label: '高脂（120卡）' },
      { key: 'meatXHigh', label: '超高脂（135卡）' },
    ] },
  { name: '蔬菜', glyph: '蔬', tint: '#E3EBD9', color: '#4A7C59', note: '25 卡/份', fields: [{ key: 'veg', label: '份數' }] },
  { name: '全穀雜糧', glyph: '穀', tint: '#F1E8D2', color: '#A8842E', note: '70 卡/份', fields: [{ key: 'grain', label: '份數' }] },
  { name: '油脂堅果', glyph: '油', tint: '#F3E7D8', color: '#C77B4A', note: '45 卡/份', fields: [{ key: 'oil', label: '份數' }] },
  { name: '水果', glyph: '果', tint: '#F6E5E9', color: '#B5537A', note: '60 卡/份', fields: [{ key: 'fruit', label: '份數' }] },
  { name: '乳品', glyph: '乳', tint: '#E5EBF1', color: '#5B8DB8', note: '80–150 卡/份',
    fields: [
      { key: 'milkSkim', label: '脫脂（80卡）' },
      { key: 'milkLow', label: '低脂（120卡）' },
      { key: 'milkFull', label: '全脂（150卡）' },
    ] },
];

export function LogFoodModal() {
  const editingId = useStore((s) => s.editingId);
  const day = useStore((s) => s.day);
  const refresh = useStore((s) => s.refresh);
  const closeModal = useStore((s) => s.closeModal);

  const entry = useMemo(() => day.entries.find((e) => e.id === editingId) ?? null, [day.entries, editingId]);

  const [desc, setDesc] = useState(entry?.desc ?? '');
  const [photo, setPhoto] = useState(entry?.photo ?? '');
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
      if (entryHasData({ desc, photo, food })) {
        await api.patchEntry(entry.id, { desc, food });
      } else {
        await api.deleteEntry(entry.id);
      }
      await refresh();
    } finally {
      closeModal();
    }
  };

  const remove = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await api.deleteEntry(entry.id);
      await refresh();
    } finally {
      closeModal();
    }
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const blob = await compressImage(file);
      const { photo: url } = await api.uploadPhoto(entry.id, blob);
      setPhoto(url);
    } catch {
      /* 壓縮或上傳失敗時維持原狀 */
    }
  };

  const removePhoto = async () => {
    try {
      await api.patchEntry(entry.id, { photo: '' });
      setPhoto('');
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
        {/* 照片 + 敘述 */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {photo ? (
              <>
                <div role="img" aria-label="餐點照片" style={{ width: 88, height: 88, borderRadius: 14, border: '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${photo}')` }} />
                <button onClick={() => void removePhoto()} style={{ border: 'none', background: 'transparent', color: '#C0564A', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>移除照片</button>
              </>
            ) : (
              <label style={{ width: 88, height: 88, border: '1.5px dashed #C9C2B2', borderRadius: 14, background: '#FBFAF6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', color: '#8A9284' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="14" rx="3" /><circle cx="12" cy="13" r="3.5" /><path d="M9 6l1.2-2h3.6L15 6" /></svg>
                <span style={{ fontSize: 11 }}>上傳照片</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void uploadPhoto(file); }}
                  style={{ display: 'none' }}
                />
              </label>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <label style={{ fontSize: 12.5, color: '#6B7565' }}>這餐吃了什麼？</label>
            <textarea
              rows={3}
              placeholder="例：滷雞腿便當，飯只吃一半⋯"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              style={{ flex: 1, border: '1.5px solid #DDD8CA', borderRadius: 12, padding: '10px 12px', fontSize: 14.5, outline: 'none', background: '#FBFAF6', resize: 'none' }}
            />
          </div>
        </div>
        {/* 份數輸入 */}
        <div style={{ fontSize: 12.5, color: '#6B7565' }}>輸入這餐的六大類份數（0.1 ～ 99）。</div>
        {INPUT_GROUPS.map((g) => (
          <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #F0EDE3', paddingTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 30, height: 30, flex: 'none', borderRadius: 9, background: g.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: g.color, fontWeight: 900 }}>{g.glyph}</div>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{g.name}</span>
              <span style={{ fontSize: 12, color: '#8A9284' }}>{g.note}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', gap: 8 }}>
              {g.fields.map((f) => (
                <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11.5, color: '#8A9284' }}>{f.label}</label>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    step={0.1}
                    placeholder="0"
                    value={foodStr[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    onBlur={() => blurField(f.key)}
                    style={{ height: 42, border: '1.5px solid #DDD8CA', borderRadius: 11, padding: '0 10px', fontSize: 15, outline: 'none', background: '#FBFAF6', width: '100%', textAlign: 'center' }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button onClick={() => void finish()} className="hv-green" style={{ height: 48, flex: 'none', border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>完成</button>
        <button onClick={() => void remove()} className="hv-red-tint" style={{ height: 40, flex: 'none', border: 'none', borderRadius: 13, background: 'transparent', color: '#C0564A', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>刪除這筆紀錄</button>
      </div>
    </ModalShell>
  );
}

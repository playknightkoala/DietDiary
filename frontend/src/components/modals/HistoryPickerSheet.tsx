import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { MEALS, customItemLabel, customItemsKcal, foodSummary, kcalOfFood } from '../../lib/domain';
import type { EntryFoodItem, HistoryMeal, HistoryPhoto, MealKey } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

// M/D
const fmtMD = (d: string) => {
  const p = d.split('-');
  return p.length === 3 ? `${+p[1]}/${+p[2]}` : d;
};

const pageKcal = (p: { food: HistoryPhoto['food']; customItems: HistoryPhoto['customItems'] }) =>
  kcalOfFood(p.food) + customItemsKcal(p.customItems);
const pageSummary = (p: { food: HistoryPhoto['food']; customItems: HistoryPhoto['customItems'] }) =>
  [foodSummary(p.food), p.customItems.map((c) => customItemLabel(c)).join('、')].filter(Boolean).join('、') || '未記份數';
// 項目頁的識別鍵（同一張卡內以索引區分）
const itemKey = (m: HistoryMeal, idx: number) => `${m.entryId}:item:${idx}`;

// 從歷史加入：最近記過的餐（新→舊，以原始紀錄分組成卡），照片頁與無照片項目頁都會列出。
// 「加入整餐」＝所有頁面＋各自份數與自定義＋敘述一次；也可點單頁只加那頁（敘述同樣只帶一次）
export function HistoryPickerSheet({
  excludeId,
  remaining,
  remainingItems,
  defaultMeal,
  onPick,
  onClose,
}: {
  excludeId: number;
  remaining: number; // 目前還能再加幾張照片
  remainingItems: number; // 目前還能再加幾個無照片項目頁
  defaultMeal?: MealKey; // 正在記錄的餐別：預設選到同餐別的分頁（該餐別沒紀錄則退回第一個）
  // 回傳「實際成功加入」的結果：照片為成功張數（依傳入順序的前 N 張）、項目為是否已加入。
  // 部分失敗時只標記成功的那幾張，失敗的照片保持可再點補加，不會重複複製
  onPick: (meal: HistoryMeal, picks: { photos: HistoryPhoto[]; items: EntryFoodItem[] }) => Promise<{ photosAdded: number; itemsAdded: boolean }>;
  onClose: () => void;
}) {
  const [meals, setMeals] = useState<HistoryMeal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${entryId}` 整餐或 `${entryId}:...` 單頁
  const [added, setAdded] = useState<string[]>([]); // 已加入的頁（照片 url／項目鍵）
  const [activeTab, setActiveTab] = useState<MealKey | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .entryHistory(excludeId)
      .then((list) => alive && setMeals(list))
      .catch(() => alive && setMeals([]));
    return () => {
      alive = false;
    };
  }, [excludeId]);

  // 容量以父層即時 props 為唯一來源：加入成功會立即反映在父層 state（照片與項目皆然），
  // 父層重繪時 remaining 已扣過——Sheet 內不可再自己計數扣一次，否則重複扣除、提前顯示已達上限
  const photoRoom = remaining;
  const itemRoom = remainingItems;
  const full = photoRoom <= 0 && itemRoom <= 0;

  const pick = async (
    meal: HistoryMeal,
    photos: { p: HistoryPhoto }[],
    items: { it: EntryFoodItem; key: string }[],
    busyKey: string
  ) => {
    if (busy) return;
    const freshPhotos = photos.filter(({ p }) => !added.includes(p.photo)).slice(0, Math.max(0, photoRoom));
    const freshItems = items.filter(({ key }) => !added.includes(key)).slice(0, Math.max(0, itemRoom));
    if (!freshPhotos.length && !freshItems.length) return;
    setBusy(busyKey);
    const result = await onPick(meal, { photos: freshPhotos.map(({ p }) => p), items: freshItems.map(({ it }) => it) });
    setBusy(null);
    // 只標記實際成功的部分：照片依順序取前 photosAdded 張；失敗的保持可再點補加
    const okPhotoUrls = freshPhotos.slice(0, result.photosAdded).map(({ p }) => p.photo);
    const okItemKeys = result.itemsAdded ? freshItems.map(({ key }) => key) : [];
    if (okPhotoUrls.length || okItemKeys.length) {
      setAdded((a) => [...a, ...okPhotoUrls, ...okItemKeys]);
    }
  };

  // 依餐別分組（早餐／午餐／晚餐／宵夜／點心），只顯示有紀錄的分類；組內維持新→舊
  const groups = MEALS.map((m) => ({ meal: m, list: (meals ?? []).filter((i) => i.meal === m.k) })).filter(
    (g) => g.list.length
  );
  // tab：預設選「正在記錄的餐別」（該餐別沒紀錄則退回第一個有資料的）；使用者選過就用選的
  const tabMeals = groups.map((g) => g.meal.k);
  const active =
    activeTab && tabMeals.includes(activeTab)
      ? activeTab
      : defaultMeal && tabMeals.includes(defaultMeal)
        ? defaultMeal
        : tabMeals[0];
  const activeList = groups.find((g) => g.meal.k === active)?.list ?? [];

  const badge = (state: 'added' | 'busy' | 'idle') => (
    <span
      style={{
        position: 'absolute', right: 3, bottom: 3, minWidth: 18, height: 18, borderRadius: 9,
        background: state === 'added' ? '#4A7C59' : 'rgba(45,59,45,.65)', color: '#fff',
        fontSize: 11, lineHeight: '18px', fontWeight: 800, padding: '0 4px',
      }}
    >
      {state === 'busy' ? '…' : state === 'added' ? '✓' : '＋'}
    </span>
  );

  const card = (m: HistoryMeal) => {
    const mealDef = MEALS.find((x) => x.k === m.meal) || MEALS[0];
    const totalKcal = m.photos.reduce((a, p) => a + pageKcal(p), 0) + m.items.reduce((a, it) => a + pageKcal(it), 0);
    const pageCount = m.photos.length + m.items.length;
    const allAdded =
      m.photos.every((p) => added.includes(p.photo)) && m.items.every((_, i) => added.includes(itemKey(m, i)));
    const mealBusy = busy === String(m.entryId);
    const mealDisabled = allAdded || !!busy || (full && !allAdded);
    return (
      <div
        key={m.entryId}
        style={{
          flex: 'none', display: 'flex', flexDirection: 'column', gap: 8,
          border: allAdded ? '1.5px solid #4A7C59' : '1.5px solid #E4DFD2', borderRadius: 14,
          background: allAdded ? '#EDF2E6' : '#FBFAF6', padding: '10px 12px',
          opacity: full && !allAdded ? 0.55 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: mealDef.color, flex: 'none' }}>{mealDef.name}</span>
          <span style={{ fontSize: 12, color: '#8A9284', flex: 'none' }}>{fmtMD(m.date)}</span>
          <span style={{ fontFamily: 'Outfit', fontSize: 12.5, fontWeight: 700, color: '#4A7C59', flex: 'none' }}>{totalKcal} kcal</span>
          {pageCount > 1 && <span style={{ fontSize: 11.5, color: '#8A9284', flex: 'none' }}>共 {pageCount} 頁</span>}
          <span style={{ flex: 1 }} />
          <button
            onClick={() =>
              void pick(
                m,
                m.photos.map((p) => ({ p })),
                m.items.map((it, i) => ({ it, key: itemKey(m, i) })),
                String(m.entryId)
              )
            }
            disabled={mealDisabled}
            className="hv-green"
            style={{
              flex: 'none', height: 32, padding: '0 13px', border: 'none', borderRadius: 99,
              background: allAdded ? 'transparent' : '#4A7C59', color: allAdded ? '#4A7C59' : '#fff',
              fontSize: 12.5, fontWeight: 800, cursor: mealDisabled ? 'default' : 'pointer',
              opacity: mealBusy ? 0.7 : 1,
            }}
          >
            {mealBusy ? '加入中…' : allAdded ? '已加入' : pageCount > 1 ? '加入整餐' : '加入'}
          </button>
        </div>
        {m.desc && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#2D3B2D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.desc}
          </div>
        )}
        {/* 頁面列：照片縮圖＋無照片項目圖格；點單頁只加那頁（份數與自定義跟著頁；敘述同一餐只帶一次） */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
          {m.photos.map((p) => {
            const isAdded = added.includes(p.photo);
            const isBusy = busy === `${m.entryId}:${p.photo}`;
            const disabled = isAdded || !!busy || photoRoom <= 0;
            return (
              <button
                key={p.photo}
                onClick={() => void pick(m, [{ p }], [], `${m.entryId}:${p.photo}`)}
                disabled={disabled}
                title={`只加入這張：${pageSummary(p)}`}
                style={{ flex: 'none', position: 'relative', width: 64, height: 64, borderRadius: 12, border: isAdded ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${p.photo}')`, cursor: disabled ? 'default' : 'pointer', padding: 0 }}
              >
                {badge(isBusy ? 'busy' : isAdded ? 'added' : 'idle')}
              </button>
            );
          })}
          {m.items.map((it, i) => {
            const key = itemKey(m, i);
            const isAdded = added.includes(key);
            const isBusy = busy === key;
            const disabled = isAdded || !!busy || itemRoom <= 0;
            return (
              <button
                key={key}
                onClick={() => void pick(m, [], [{ it, key }], key)}
                disabled={disabled}
                title={`只加入這個無照片項目：${pageSummary(it)}`}
                style={{ flex: 'none', position: 'relative', width: 64, height: 64, borderRadius: 12, border: isAdded ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', background: '#F0EDE3', color: '#8A9284', cursor: disabled ? 'default' : 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20h16" /><path d="M6 20a6 6 0 0 1 12 0" /><circle cx="12" cy="9" r="1.2" /></svg>
                {badge(isBusy ? 'busy' : isAdded ? 'added' : 'idle')}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: '#8A9284', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[...m.photos.map(pageSummary), ...m.items.map(pageSummary)].join('｜')}
        </div>
      </div>
    );
  };

  return (
    <ModalShell maxWidth={480} zIndex={60} cardStyle={{ maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* 固定表頭：標題 */}
      <div style={{ flex: 'none', padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>從歷史加入</div>
        <CloseButton onClick={onClose} />
      </div>

      {/* 固定表頭：說明 + 餐別分頁（不隨清單捲動，避免項目多時最上方的分頁被捲掉遮住） */}
      <div style={{ flex: 'none', padding: '10px 20px 0' }}>
        <div style={{ fontSize: 13, color: '#6B7565', lineHeight: 1.6 }}>
          一張卡＝過去的一餐（含照片與無照片項目）。「加入整餐」帶入<b>所有頁面、各自份數與敘述</b>；點單頁只加那頁（每個餐別顯示最近 30 餐）。
          {full && <span style={{ color: '#C0564A' }}>　已達頁面上限</span>}
        </div>
        {groups.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, margin: '10px -2px 0' }}>
            {groups.map(({ meal, list }) => {
              const on = meal.k === active;
              return (
                <button
                  key={meal.k}
                  onClick={() => setActiveTab(meal.k)}
                  style={{
                    flex: 'none', display: 'flex', alignItems: 'center', gap: 5, height: 34, padding: '0 13px', borderRadius: 99,
                    border: on ? '1.5px solid #4A7C59' : '1.5px solid #E4DFD2',
                    background: on ? '#4A7C59' : '#fff', color: on ? '#fff' : '#4A5A4A',
                    fontSize: 13, fontWeight: 800, cursor: 'pointer',
                  }}
                >
                  <span>{meal.name}</span>
                  <span style={{ fontFamily: 'Outfit', fontSize: 11.5, opacity: 0.85 }}>{list.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 捲動區：只有清單本身（flex:1 + minHeight:0 才能在固定高度卡片內正確捲動） */}
      <div style={{ flex: 1, minHeight: 0, padding: '10px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {meals === null && <div style={{ fontSize: 13, color: '#8A9284', padding: '20px 0', textAlign: 'center' }}>載入中…</div>}
        {meals !== null && meals.length === 0 && (
          <div style={{ fontSize: 13, color: '#8A9284', padding: '24px 0', textAlign: 'center', lineHeight: 1.7 }}>
            還沒有記過份數的紀錄。<br />先記幾餐，之後就能從這裡快速加入。
          </div>
        )}
        {activeList.map(card)}
      </div>
    </ModalShell>
  );
}

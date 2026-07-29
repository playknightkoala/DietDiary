import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { MEALS, customItemLabel, customItemsKcal, foodSummary, kcalOfFood } from '../../lib/domain';
import type { HistoryMeal, HistoryPhoto, MealKey } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

// M/D
const fmtMD = (d: string) => {
  const p = d.split('-');
  return p.length === 3 ? `${+p[1]}/${+p[2]}` : d;
};

const photoKcal = (p: HistoryPhoto) => kcalOfFood(p.food) + customItemsKcal(p.customItems);

// 從歷史加入：最近記過的餐（新→舊，以原始紀錄分組成卡）。
// 「加入整餐」＝所有照片＋各自份數與自定義＋敘述一次；也可點單張照片只加那張（敘述同樣只帶一次）
export function HistoryPickerSheet({
  excludeId,
  remaining,
  onPick,
  onClose,
}: {
  excludeId: number;
  remaining: number; // 目前還能再加幾張照片
  onPick: (meal: HistoryMeal, picks: HistoryPhoto[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [meals, setMeals] = useState<HistoryMeal[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${entryId}` 整餐或 `${entryId}:${photo}` 單張
  const [added, setAdded] = useState<string[]>([]); // 已加入的照片（來源 url）
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

  const room = remaining - added.length;
  const full = room <= 0;

  const pickPhotos = async (meal: HistoryMeal, picks: HistoryPhoto[], busyKey: string) => {
    if (busy) return;
    const fresh = picks.filter((p) => !added.includes(p.photo)).slice(0, Math.max(0, room));
    if (!fresh.length) return;
    setBusy(busyKey);
    const ok = await onPick(meal, fresh);
    setBusy(null);
    if (ok) setAdded((a) => [...a, ...fresh.map((p) => p.photo)]);
  };

  // 依餐別分組（早餐／午餐／晚餐／宵夜／點心），只顯示有紀錄的分類；組內維持新→舊
  const groups = MEALS.map((m) => ({ meal: m, list: (meals ?? []).filter((i) => i.meal === m.k) })).filter(
    (g) => g.list.length
  );
  // tab：預設第一個有資料的餐別；使用者選過就用選的（若該餐別已無資料則回退到第一個）
  const tabMeals = groups.map((g) => g.meal.k);
  const active = activeTab && tabMeals.includes(activeTab) ? activeTab : tabMeals[0];
  const activeList = groups.find((g) => g.meal.k === active)?.list ?? [];

  const card = (m: HistoryMeal) => {
    const mealDef = MEALS.find((x) => x.k === m.meal) || MEALS[0];
    const totalKcal = m.photos.reduce((a, p) => a + photoKcal(p), 0);
    const freshCount = m.photos.filter((p) => !added.includes(p.photo)).length;
    const allAdded = freshCount === 0;
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
          {m.photos.length > 1 && <span style={{ fontSize: 11.5, color: '#8A9284', flex: 'none' }}>共 {m.photos.length} 張</span>}
          <span style={{ flex: 1 }} />
          <button
            onClick={() => void pickPhotos(m, m.photos, String(m.entryId))}
            disabled={mealDisabled}
            className="hv-green"
            style={{
              flex: 'none', height: 32, padding: '0 13px', border: 'none', borderRadius: 99,
              background: allAdded ? 'transparent' : '#4A7C59', color: allAdded ? '#4A7C59' : '#fff',
              fontSize: 12.5, fontWeight: 800, cursor: mealDisabled ? 'default' : 'pointer',
              opacity: mealBusy ? 0.7 : 1,
            }}
          >
            {mealBusy ? '加入中…' : allAdded ? '已加入' : m.photos.length > 1 ? '加入整餐' : '加入'}
          </button>
        </div>
        {m.desc && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#2D3B2D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.desc}
          </div>
        )}
        {/* 照片列：點單張只加那張（份數與自定義跟著照片；敘述同一餐只帶一次） */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
          {m.photos.map((p) => {
            const isAdded = added.includes(p.photo);
            const isBusy = busy === `${m.entryId}:${p.photo}`;
            const disabled = isAdded || !!busy || full;
            const summary = [foodSummary(p.food), p.customItems.map((c) => customItemLabel(c)).join('、')]
              .filter(Boolean)
              .join('、');
            return (
              <button
                key={p.photo}
                onClick={() => void pickPhotos(m, [p], `${m.entryId}:${p.photo}`)}
                disabled={disabled}
                title={m.photos.length > 1 ? `只加入這張：${summary || '未記份數'}` : summary}
                style={{ flex: 'none', position: 'relative', width: 64, height: 64, borderRadius: 12, border: isAdded ? '2.5px solid #4A7C59' : '1.5px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${p.photo}')`, cursor: disabled ? 'default' : 'pointer', padding: 0 }}
              >
                <span
                  style={{
                    position: 'absolute', right: 3, bottom: 3, minWidth: 18, height: 18, borderRadius: 9,
                    background: isAdded ? '#4A7C59' : 'rgba(45,59,45,.65)', color: '#fff',
                    fontSize: 11, lineHeight: '18px', fontWeight: 800, padding: '0 4px',
                  }}
                >
                  {isBusy ? '…' : isAdded ? '✓' : '＋'}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: '#8A9284', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {m.photos
            .map((p) => {
              const parts = [foodSummary(p.food), p.customItems.map((c) => customItemLabel(c)).join('、')].filter(Boolean).join('、');
              return parts || '未記份數';
            })
            .join('｜')}
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
          一張卡＝過去的一餐。「加入整餐」帶入<b>所有照片、各自份數與敘述</b>；點單張照片只加那張（每個餐別顯示最近 30 餐）。
          {full && <span style={{ color: '#C0564A' }}>　已達照片上限</span>}
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
            還沒有記過份數的照片。<br />先記幾餐，之後就能從這裡快速加入。
          </div>
        )}
        {activeList.map(card)}
      </div>
    </ModalShell>
  );
}

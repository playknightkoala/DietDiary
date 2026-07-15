import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { MEALS, foodSummary, kcalOfFood } from '../../lib/domain';
import type { HistoryItem } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

// M/D
const fmtMD = (d: string) => {
  const p = d.split('-');
  return p.length === 3 ? `${+p[1]}/${+p[2]}` : d;
};

// 從歷史加入：列出最近記過份數的照片（新→舊），點一列＝複製該照片＋帶入份數
export function HistoryPickerSheet({
  excludeId,
  remaining,
  onPick,
  onClose,
}: {
  excludeId: number;
  remaining: number; // 目前還能再加幾張
  onPick: (item: HistoryItem) => Promise<boolean>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .entryHistory(excludeId)
      .then((list) => alive && setItems(list))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [excludeId]);

  const full = remaining - added.length <= 0;

  const pick = async (item: HistoryItem) => {
    if (busy || added.includes(item.photo) || full) return;
    setBusy(item.photo);
    const ok = await onPick(item);
    setBusy(null);
    if (ok) setAdded((a) => [...a, item.photo]);
  };

  return (
    <ModalShell maxWidth={480} zIndex={60} cardStyle={{ maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>從歷史加入</div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ padding: '10px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: '#6B7565', lineHeight: 1.6 }}>
          選一筆記過的餐點，直接加入<b>這張照片與它的份數</b>（顯示最近 {items?.length ?? ''} 筆）。
          {full && <span style={{ color: '#C0564A' }}>　已達照片上限</span>}
        </div>

        {items === null && <div style={{ fontSize: 13, color: '#8A9284', padding: '20px 0', textAlign: 'center' }}>載入中…</div>}
        {items !== null && items.length === 0 && (
          <div style={{ fontSize: 13, color: '#8A9284', padding: '24px 0', textAlign: 'center', lineHeight: 1.7 }}>
            還沒有記過份數的照片。<br />先記幾餐，之後就能從這裡快速加入。
          </div>
        )}

        {items?.map((item) => {
          const meal = MEALS.find((m) => m.k === item.meal) || MEALS[0];
          const isAdded = added.includes(item.photo);
          const isBusy = busy === item.photo;
          const disabled = isAdded || isBusy || (full && !isAdded);
          const summary = foodSummary(item.food);
          return (
            <button
              key={item.photo}
              onClick={() => void pick(item)}
              disabled={disabled}
              className="hv-sand"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%',
                border: isAdded ? '1.5px solid #4A7C59' : '1.5px solid #E4DFD2', borderRadius: 14,
                background: isAdded ? '#EDF2E6' : '#FBFAF6', padding: 8,
                cursor: disabled ? 'default' : 'pointer', opacity: full && !isAdded ? 0.5 : 1,
              }}
            >
              <div style={{ width: 58, height: 58, flex: 'none', borderRadius: 10, border: '1px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${item.photo}')` }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8A9284' }}>
                  <span style={{ fontWeight: 800, color: meal.color }}>{meal.name}</span>
                  <span>{fmtMD(item.date)}</span>
                  <span style={{ fontFamily: 'Outfit', fontWeight: 700, color: '#4A7C59' }}>{kcalOfFood(item.food)} kcal</span>
                </div>
                {item.desc && (
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#2D3B2D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</div>
                )}
                <div style={{ fontSize: 12, color: '#6B7565', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary || '（未記份數）'}</div>
              </div>
              <div style={{ flex: 'none', fontSize: 13, fontWeight: 800, color: isAdded ? '#4A7C59' : '#4A5A4A', minWidth: 40, textAlign: 'center' }}>
                {isBusy ? '…' : isAdded ? '已加入' : '＋'}
              </div>
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}

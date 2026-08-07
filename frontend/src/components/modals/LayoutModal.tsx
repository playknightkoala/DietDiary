import { DEFAULT_CARD_ORDER, useStore, type CardKey } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

const CARD_NAMES: Record<CardKey, string> = {
  kcal: '今日攝取熱量',
  water: '喝水',
  macro: '熱量及三大營養素',
  groups: '六大類飲食份數',
};

// 介面自定義：調整主頁總覽卡片的順序與顯示與否（存在此裝置，換裝置需重新設定）
export function LayoutModal() {
  const layout = useStore((s) => s.layout);
  const setLayout = useStore((s) => s.setLayout);
  const closeModal = useStore((s) => s.closeModal);

  const move = (k: CardKey, dir: -1 | 1) => {
    const order = [...layout.order];
    const i = order.indexOf(k);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setLayout({ ...layout, order });
  };
  const toggle = (k: CardKey) => {
    const hidden = layout.hidden.includes(k) ? layout.hidden.filter((h) => h !== k) : [...layout.hidden, k];
    setLayout({ ...layout, hidden });
  };
  const reset = () => setLayout({ order: [...DEFAULT_CARD_ORDER], hidden: [] });

  const arrowBtnStyle = (disabled: boolean) => ({
    width: 30, height: 30, border: '1.5px solid #DDD8CA', borderRadius: 9, background: '#fff',
    color: disabled ? '#D5D0C2' : '#4A5A4A', cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  } as const);

  return (
    <ModalShell maxWidth={440} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>介面自定義</div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: '#6B7565', lineHeight: 1.7 }}>
          調整主頁各卡片的<b>順序</b>與<b>要不要顯示</b>，改了立即生效。設定存在這台裝置上。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {layout.order.map((k, i) => {
            const hidden = layout.hidden.includes(k);
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #E4DFD2', borderRadius: 13, background: hidden ? '#F7F5EF' : '#FBFAF6', padding: '9px 12px' }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  <button title="往上移" disabled={i === 0} onClick={() => move(k, -1)} className={i === 0 ? undefined : 'hv-cream'} style={arrowBtnStyle(i === 0)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 15 12 9 18 15" /></svg>
                  </button>
                  <button title="往下移" disabled={i === layout.order.length - 1} onClick={() => move(k, 1)} className={i === layout.order.length - 1 ? undefined : 'hv-cream'} style={arrowBtnStyle(i === layout.order.length - 1)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                  </button>
                </div>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: hidden ? '#A39C8C' : '#2D3B2D' }}>{CARD_NAMES[k]}</span>
                <button
                  onClick={() => toggle(k)}
                  className="hv-cream"
                  style={{ border: `1.5px solid ${hidden ? '#DDD8CA' : '#4A7C59'}`, background: hidden ? '#fff' : '#E3EBD9', color: hidden ? '#8A9284' : '#3B6647', borderRadius: 99, fontSize: 12, fontWeight: 700, padding: '5px 12px', cursor: 'pointer', flex: 'none' }}
                >
                  {hidden ? '已隱藏' : '顯示中'}
                </button>
              </div>
            );
          })}
        </div>
        <button onClick={reset} className="hv-sand" style={{ height: 42, flex: 'none', border: '1.5px solid #DDD8CA', borderRadius: 12, background: '#fff', color: '#4A5A4A', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          恢復預設排列
        </button>
      </div>
    </ModalShell>
  );
}

import { useEffect } from 'react';
import { useStore } from '../../store';
import { BODY_DEFS, bmrTdeeOf } from '../../lib/domain';
import { TrendChart } from '../TrendChart';
import { CloseButton, ModalShell } from './ModalShell';

// 身體數據總覽（漢堡選單 → 身體數據）：當日數值、BMR／TDEE 與歷程趨勢一次呈現，
// 主頁不再顯示身體數據卡片；記錄入口在此視窗與右下角「＋」選單
export function BodyOverviewModal() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const trendRows = useStore((s) => s.trendRows);
  const loadTrend = useStore((s) => s.loadTrend);
  const openLogBody = useStore((s) => s.openLogBody);
  const closeModal = useStore((s) => s.closeModal);
  const profile = useStore((s) => s.profile);

  // 開啟即載入趨勢（含剛記錄完的新數值）
  useEffect(() => {
    void loadTrend();
  }, [loadTrend]);

  // BMR／TDEE：以基本資料＋最近一次體重計算（公式見 domain.bmrTdeeOf；資料不齊顯示 —）
  const { bmr, tdee } = bmrTdeeOf(profile);

  const tile = (name: string, value: string, unit: string) => (
    <div key={name} style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 11.5, color: '#8A9284' }}>{name}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, color: '#2D3B2D' }}>{value}</span>
        <span style={{ fontSize: 11, color: '#8A9284' }}>{unit}</span>
      </div>
    </div>
  );

  return (
    <ModalShell maxWidth={520} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18M5 8c2-2 12-2 14 0M5 16c2 2 12 2 14 0" /></svg>
          <div style={{ fontSize: 17, fontWeight: 900 }}>身體數據</div>
        </div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 當日數值 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>
            {selected} 的數值
            {day.bodyTime && <span style={{ fontSize: 11.5, fontWeight: 400, color: '#8A9284', marginLeft: 6 }}>{day.bodyTime} 測量</span>}
          </div>
          <button
            onClick={() => openLogBody(true)}
            className="hv-green"
            style={{ border: 'none', background: '#4A7C59', color: '#fff', borderRadius: 99, fontSize: 12, fontWeight: 700, padding: '6px 16px', cursor: 'pointer', flex: 'none' }}
          >
            ＋ 記錄
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
          {BODY_DEFS.map((b) => tile(b.name, day.body[b.k] !== '' ? day.body[b.k] : '—', b.unit))}
        </div>

        {/* 代謝估算：BMR／TDEE（基本資料與活動量在「＋ 記錄」視窗內設定） */}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>代謝估算</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {([['BMR（基礎代謝）', bmr], ['TDEE（每日消耗）', tdee]] as const).map(([name, v]) => tile(name, String(v ?? '—'), 'kcal'))}
        </div>

        {/* 歷程趨勢 */}
        <div style={{ fontSize: 13, fontWeight: 800, color: '#4A5A4A' }}>歷程趨勢</div>
        <div style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: 10 }}>
          <TrendChart rows={trendRows} />
        </div>
      </div>
    </ModalShell>
  );
}

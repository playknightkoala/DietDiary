import { useStore } from '../../store';
import { WD_NAMES } from '../../lib/domain';
import { NG_LEVEL_COLORS, ngDays, overSugarDays } from '../../lib/ng';
import { CloseButton, ModalShell } from './ModalShell';

// 當月飲食警示明細：依 store.sugarNgMode 只顯示「精緻糖超標」或「NG 食品」的日子（新→舊），
// 點某天直接跳到當天（setAnchor＝跨月時週列要一起搬）。資料源＝store.monthStats，不另外 fetch
export function SugarNgModal() {
  const monthStats = useStore((s) => s.monthStats);
  const mode = useStore((s) => s.sugarNgMode);
  const selected = useStore((s) => s.selected);
  const selectDate = useStore((s) => s.selectDate);
  const closeModal = useStore((s) => s.closeModal);

  const ready = monthStats !== null && monthStats.month === selected.slice(0, 7);
  const flagged = ready
    ? [...(mode === 'sugar' ? overSugarDays(monthStats) : ngDays(monthStats))].sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];
  const month = Number(selected.slice(5, 7));
  const title = mode === 'sugar' ? `${month} 月精緻糖超標` : `${month} 月 NG 食品`;

  const dateLabel = (date: string) => {
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()}（${WD_NAMES[(d.getDay() + 6) % 7]}）`;
  };

  return (
    <ModalShell maxWidth={440} cardStyle={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>{title}</div>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ padding: '14px 20px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!ready ? (
          <div style={{ fontSize: 13, color: '#8A9284', padding: '18px 0', textAlign: 'center' }}>統計載入中…</div>
        ) : flagged.length === 0 ? (
          <div style={{ fontSize: 13, color: '#4A7C59', fontWeight: 700, padding: '18px 0', textAlign: 'center', lineHeight: 1.7 }}>
            {mode === 'sugar' ? '這個月目前沒有精緻糖超標的日子，繼續保持！' : '這個月目前沒有吃到 NG 食品的日子，繼續保持！'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {flagged.map((d) => (
              <button
                key={d.date}
                onClick={() => { selectDate(d.date, true); closeModal(); }}
                className="hv-cream"
                style={{ border: '1.5px solid #E4DFD2', borderRadius: 13, background: '#FBFAF6', padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 7, width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: '#2D3B2D' }}>{dateLabel(d.date)}</span>
                  {mode === 'sugar' && (
                    <span style={{ fontSize: 12.5, color: '#A8433A', fontWeight: 900 }}>
                      精緻糖 {d.sugar} g / 上限 {monthStats.sugarLimit} g
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: '#8A9284', flex: 'none' }}>›</span>
                </div>
                {mode === 'ng' && d.ngHits.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {d.ngHits.map((h) => (
                      <span key={h.keyword} style={{ fontSize: 11.5, fontWeight: 700, color: NG_LEVEL_COLORS[h.level].fg, background: NG_LEVEL_COLORS[h.level].bg, borderRadius: 99, padding: '3px 9px' }}>
                        {h.keyword} · {h.category}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: '#8A9284', lineHeight: 1.7 }}>
          {mode === 'sugar'
            ? `每日精緻糖建議上限 ${monthStats?.sugarLimit ?? '—'} g（管理員設定；WHO 建議 25 g）。點日期可跳到當天查看紀錄。`
            : 'NG 食品依紀錄文字與自定義項目名稱比對關鍵字（炸物、甜點、含糖飲料等）。點日期可跳到當天查看紀錄。'}
        </div>
      </div>
    </ModalShell>
  );
}

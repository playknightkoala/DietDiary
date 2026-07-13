import { useStore } from '../store';
import { BODY_DEFS } from '../lib/domain';
import { TrendChart } from './TrendChart';

export function BodyCard() {
  const day = useStore((s) => s.day);
  const trendOpen = useStore((s) => s.trendOpen);
  const trendField = useStore((s) => s.trendField);
  const trendPoints = useStore((s) => s.trendPoints);
  const setTrendOpen = useStore((s) => s.setTrendOpen);
  const setTrendField = useStore((s) => s.setTrendField);

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round"><path d="M12 3v18M5 8c2-2 12-2 14 0M5 16c2 2 12 2 14 0" /></svg>
          <div style={{ fontSize: 16, fontWeight: 900 }}>身體數據</div>
        </div>
        <button
          onClick={() => setTrendOpen(!trendOpen)}
          style={{ border: '1.5px solid #DDD8CA', background: trendOpen ? '#4A7C59' : '#fff', color: trendOpen ? '#fff' : '#4A5A4A', borderRadius: 99, fontSize: 12, fontWeight: 700, padding: '5px 12px', cursor: 'pointer' }}
        >
          {trendOpen ? '返回數值' : '看趨勢'}
        </button>
      </div>
      {trendOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {BODY_DEFS.map((b) => (
              <button
                key={b.k}
                onClick={() => setTrendField(b.k)}
                style={{ border: 'none', borderRadius: 99, fontSize: 12, fontWeight: 700, padding: '5px 11px', cursor: 'pointer', background: trendField === b.k ? '#4A7C59' : '#F0EDE3', color: trendField === b.k ? '#fff' : '#4A5A4A' }}
              >
                {b.name}
              </button>
            ))}
          </div>
          <div style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: 10 }}>
            <TrendChart points={trendPoints} field={trendField} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10 }}>
          {BODY_DEFS.map((b) => (
            <div key={b.k} style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 11.5, color: '#8A9284' }}>{b.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <span style={{ fontFamily: 'Outfit', fontSize: 19, fontWeight: 700, color: '#2D3B2D' }}>{day.body[b.k] !== '' ? day.body[b.k] : '—'}</span>
                <span style={{ fontSize: 11, color: '#8A9284' }}>{b.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

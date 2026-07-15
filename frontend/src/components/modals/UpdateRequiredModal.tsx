import { changelogFor } from '../../lib/changelog';
import { APP_VERSION } from '../../lib/version';
import { useStore } from '../../store';

// 改版後強制更新：不可關閉、蓋在所有畫面之上，只能重新整理載入新版
export function UpdateRequiredModal() {
  const latest = useStore((s) => s.latestVersion);
  const entry = changelogFor(latest);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(45,59,45,.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 22, width: '100%', maxWidth: 380, maxHeight: '85vh', overflowY: 'auto', padding: 26, textAlign: 'center', boxShadow: '0 24px 60px rgba(45,59,45,.3)', display: 'flex', flexDirection: 'column', gap: 14, animation: 'popIn .25s ease both' }}>
        <div style={{ width: 54, height: 54, margin: '0 auto', borderRadius: 16, background: '#EDF2E6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 106 5.3L3 8" /></svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#2D3B2D' }}>有新版本</div>
        <div style={{ fontSize: 14, color: '#6B7565', lineHeight: 1.8 }}>
          均衡日記已更新{latest ? <> 至 <b style={{ color: '#4A7C59' }}>v{latest}</b></> : ''}
          <br />
          （目前使用 v{APP_VERSION}）<br />
          請更新後繼續使用。
        </div>
        {entry && entry.notes.length > 0 && (
          <div style={{ textAlign: 'left', background: '#F7F5EF', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#4A7C59' }}>這次更新內容</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {entry.notes.map((n, i) => (
                <li key={i} style={{ fontSize: 13, color: '#4A5A4A', lineHeight: 1.6 }}>{n}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={() => window.location.reload()}
          className="hv-green"
          style={{ height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}
        >
          立即更新
        </button>
      </div>
    </div>
  );
}

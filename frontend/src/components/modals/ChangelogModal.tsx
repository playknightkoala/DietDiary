import { CHANGELOG } from '../../lib/changelog';
import { APP_VERSION } from '../../lib/version';
import { CloseButton, ModalShell } from './ModalShell';

// 版本歷程紀錄：列出每個版本更新了什麼
export function ChangelogModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell maxWidth={460} zIndex={60} cardStyle={{ maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '18px 20px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>版本紀錄</div>
        <CloseButton onClick={onClose} />
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {CHANGELOG.map((c) => {
          const current = c.version === APP_VERSION;
          return (
            <div
              key={c.version}
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                border: current ? '1.5px solid #4A7C59' : '1.5px solid #E4DFD2',
                background: current ? '#F3F7EF' : '#FBFAF6',
                borderRadius: 14, padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: 900, color: '#2D3B2D' }}>v{c.version}</span>
                {current && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#4A7C59', background: '#EDF2E6', borderRadius: 99, padding: '2px 9px' }}>目前版本</span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: '#A7AE9F', fontFamily: 'Outfit' }}>{c.date}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {c.notes.map((n, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.6 }}>{n}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}

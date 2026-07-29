import { GUIDE_DATA } from '../../lib/guideData';
import { useStore } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

export function GuideModal() {
  const guideTab = useStore((s) => s.guideTab);
  const setGuideTab = useStore((s) => s.setGuideTab);
  const closeGuide = useStore((s) => s.closeGuide);

  const cat = GUIDE_DATA[guideTab];

  return (
    // zIndex 60：指南是獨立疊加層，需蓋在一般彈窗（50）之上
    <ModalShell maxWidth={560} zIndex={60} cardStyle={{ background: '#F4F1EA', maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '18px 20px 12px', background: '#fff', borderBottom: '1.5px solid #E4DFD2', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '22px 22px 0 0' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>食物份數指南</div>
        <CloseButton onClick={closeGuide} />
      </div>
      <div style={{ flex: 'none', padding: '10px 14px', background: '#fff', display: 'flex', gap: 6, overflowX: 'auto', borderBottom: '1.5px solid #E4DFD2' }}>
        {GUIDE_DATA.map((g, i) => (
          <button
            key={g.name}
            onClick={() => setGuideTab(i)}
            style={{ flex: 'none', border: 'none', borderRadius: 99, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: i === guideTab ? g.color : '#F0EDE3', color: i === guideTab ? '#fff' : '#4A5A4A' }}
          >
            {g.name}
          </button>
        ))}
      </div>
      <div key={guideTab} style={{ flex: '1 1 auto', minHeight: 0, padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 每份營養成分小圖（衛福部食物代換表：熱量／醣類／蛋白質／脂肪） */}
        {cat.macros && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: cat.color }}>每份營養成分</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cat.macros.map((m) => (
                <div key={m.label} style={{ display: 'flex', alignItems: 'stretch', background: '#fff', border: '1px solid #EEEAE0', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ flex: 'none', width: 52, background: cat.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 900, padding: '10px 4px', textAlign: 'center', lineHeight: 1.3 }}>
                    {m.label}
                  </div>
                  {([
                    ['熱量', m.kcal],
                    ['醣類', m.carb],
                    ['蛋白質', m.protein],
                    ['脂肪', m.fat],
                  ] as const).map(([h, v]) => (
                    <div key={h} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '7px 2px', borderLeft: '1px solid #F0EDE3' }}>
                      <span style={{ fontSize: 11, color: '#8A9284' }}>{h}</span>
                      <span style={{ fontSize: 13, fontWeight: 900, color: cat.color, whiteSpace: 'nowrap' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {cat.sections.map((sec) => (
          <div key={sec.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: cat.color }}>{sec.title}</div>
            {sec.items && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sec.items.map((it, j) => (
                  <div key={j} style={{ display: 'flex', gap: 10, background: '#fff', border: '1px solid #EEEAE0', borderRadius: 12, padding: '9px 12px', fontSize: 13.5 }}>
                    <span style={{ flex: 'none', fontWeight: 800, color: cat.color, minWidth: 64 }}>{it.qty}</span>
                    <span style={{ color: '#4A5A4A' }}>{it.desc}</span>
                  </div>
                ))}
              </div>
            )}
            {sec.image && (
              <img src={sec.image} alt={sec.title} style={{ display: 'block', width: '100%', background: '#fff', border: '1px solid #EEEAE0', borderRadius: 12 }} />
            )}
            {sec.text && (
              <div style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.7, background: '#fff', border: '1px solid #EEEAE0', borderRadius: 12, padding: '12px 14px' }}>{sec.text}</div>
            )}
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

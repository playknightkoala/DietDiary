import { MEALS, entryHasData, kcalOfFood } from '../../lib/domain';
import { useStore } from '../../store';
import { CloseButton, ModalShell } from './ModalShell';

export function TodayMealsModal() {
  const day = useStore((s) => s.day);
  const openLogFood = useStore((s) => s.openLogFood);
  const closeModal = useStore((s) => s.closeModal);

  const mealOrder: Record<string, number> = {};
  MEALS.forEach((m, i) => (mealOrder[m.k] = i));
  const entries = day.entries
    .filter(entryHasData)
    .slice()
    .sort((a, b) => mealOrder[a.meal] - mealOrder[b.meal]);

  return (
    <ModalShell maxWidth={480} cardStyle={{ maxHeight: '88vh', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>今日飲食</div>
        <CloseButton onClick={closeModal} />
      </div>
      {entries.length === 0 && (
        <div style={{ padding: '20px 10px', textAlign: 'center', color: '#8A9284', fontSize: 13.5 }}>
          今天還沒有飲食紀錄，點右下「＋」新增。
        </div>
      )}
      {entries.map((e) => {
        const m = MEALS.find((mm) => mm.k === e.meal) || MEALS[0];
        return (
          <button key={e.id} onClick={() => openLogFood(e.id)} className="hv-cream" style={{ background: '#FBFAF6', border: '1px solid #EEEAE0', borderRadius: 16, padding: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%' }}>
            {e.photos.length > 0 ? (
              <div role="img" aria-label={m.name} style={{ position: 'relative', width: 52, height: 52, flex: 'none', borderRadius: 12, backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${e.photos[0]}')` }}>
                {e.photos.length > 1 && (
                  <span style={{ position: 'absolute', right: 2, bottom: 2, background: 'rgba(45,59,45,.7)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 8, padding: '1px 5px' }}>
                    {e.photos.length}張
                  </span>
                )}
              </div>
            ) : (
              <div style={{ width: 52, height: 52, flex: 'none', borderRadius: 12, background: m.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, color: m.color }}>{m.glyph}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700 }}>{m.name}</span>
                <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 700, color: '#4A7C59' }}>{kcalOfFood(e.food)} kcal</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#8A9284', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.desc || '（無敘述）'}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9C2B2" strokeWidth="2.4" strokeLinecap="round" style={{ flex: 'none' }}><path d="M9 6l6 6-6 6" /></svg>
          </button>
        );
      })}
    </ModalShell>
  );
}

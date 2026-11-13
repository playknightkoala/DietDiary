import { useState, type ReactNode } from 'react';
import { MEALS, entryAllCustoms, fmtCommentTime } from '../../lib/domain';
import { useStore } from '../../store';
import type { ReviewItem } from '../../types';
import { ROLE_BADGES } from '../CommentsThread';
import { CustomItemsSummary, FoodSummaryGrid, OrigSummary } from '../FoodFields';
import { Lightbox } from '../Lightbox';
import { PhotoRatingBadge, RATING_DEFS } from '../PhotoRatingBadge';
import { ModalShell } from './ModalShell';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 「8/8（六）」；格式不對就原樣顯示
function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${m}/${d}（${WEEKDAYS[new Date(y, m - 1, d).getDay()]}）`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: '#6B7565' }}>{title}</div>
      {children}
    </div>
  );
}

const thumbStyle = (url: string, size: number) =>
  ({
    width: size, height: size, borderRadius: 12, border: '1px solid #E4DFD2', backgroundColor: '#F0EDE3',
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')`,
  }) as const;

// 營養師回饋必讀視窗：營養師評燈號／留言／調整份量後自動跳出，一餐一頁。
// 沒有關閉鈕、不可點背景關閉——翻到最後一頁按「我知道了」才會標已讀並關閉。
// zIndex 70：蓋在一般彈窗與指南之上、低於 Lightbox（80），照片仍可點開放大。
export function ReviewModal() {
  const ackReviews = useStore((s) => s.ackReviews);
  const snoozeReviews = useStore((s) => s.snoozeReviews);
  // 掛載當下把佇列快照下來：顯示的與最後送出已讀的是同一份，不受 store 之後的變動影響
  const [items] = useState<ReviewItem[]>(() => useStore.getState().reviewQueue);
  const [pageIdx, setPageIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);

  const item = items[Math.min(pageIdx, items.length - 1)];
  if (!item) return null;
  const e = item.entry;
  const meal = MEALS.find((m) => m.k === e.meal) || MEALS[0];
  const isLast = pageIdx >= items.length - 1;
  // 依照片原本的順序列出這次被評分的照片
  const rated = e.photos.filter((url) => item.ratings[url]);

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await ackReviews(items); // 成功後 store 清空佇列，App 會卸載這個視窗
    } catch {
      // 失敗不假裝已讀也不把人鎖在視窗裡：保留畫面讓使用者重試，或選「稍後再說」先關閉
      setError('已讀狀態沒有存成功，請檢查網路後重試。選「稍後再說」會先關閉，下次開啟時再提醒你一次。');
      setBusy(false);
    }
  };

  return (
    <>
      <ModalShell maxWidth={440} zIndex={70} cardStyle={{ padding: 22, maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 900 }}>營養師回饋</div>
          <div style={{ fontSize: 12.5, color: '#8A9284', fontWeight: 700 }}>
            第 {pageIdx + 1} / {items.length} 餐
          </div>
        </div>

        {/* key＝頁碼：換頁時重新掛載，捲動位置回到頂端、「調整前」等區塊的展開狀態不沿用 */}
        <div key={pageIdx} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, flex: 'none', borderRadius: 12, background: meal.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color: meal.color, fontWeight: 900 }}>{meal.glyph}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 900, color: '#2D3B2D' }}>{dateLabel(item.date)} {meal.name}</div>
              {e.eatTime && <div style={{ fontSize: 11.5, color: '#8A9284' }}>{e.eatTime}</div>}
            </div>
          </div>
          {e.desc && <div style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.desc}</div>}

          {rated.length > 0 ? (
            <Section title="照片評分">
              {rated.map((url) => {
                const rating = item.ratings[url]!;
                const def = RATING_DEFS[rating];
                return (
                  <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => setLightbox({ photos: e.photos, index: e.photos.indexOf(url) })} title="放大檢視" style={{ position: 'relative', display: 'block', flex: 'none', border: 'none', background: 'transparent', padding: 0, cursor: 'zoom-in' }}>
                      <div style={thumbStyle(url, 76)} />
                      <PhotoRatingBadge rating={rating} size={14} />
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ width: 14, height: 14, flex: 'none', borderRadius: '50%', background: def.color }} />
                      <span style={{ fontSize: 14, fontWeight: 800, color: def.color }}>{def.name}</span>
                    </div>
                  </div>
                );
              })}
            </Section>
          ) : (
            // 這餐沒有新評分：照片只當脈絡，讓會員認得是哪一餐
            e.photos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {e.photos.map((url, pi) => (
                  <button key={url} onClick={() => setLightbox({ photos: e.photos, index: pi })} title="放大檢視" style={{ display: 'block', border: 'none', background: 'transparent', padding: 0, cursor: 'zoom-in' }}>
                    <div style={thumbStyle(url, 60)} />
                  </button>
                ))}
              </div>
            )
          )}

          {item.foodUnreadAt > 0 && (
            <Section title="營養師調整了份量">
              <div style={{ fontSize: 12.5, color: '#8A9284' }}>調整後的六大類份數：</div>
              <FoodSummaryGrid food={e.food} />
              <CustomItemsSummary items={entryAllCustoms(e)} />
              {e.orig && <OrigSummary orig={e.orig} current={e} label="你原本記的（營養師調整前）" />}
            </Section>
          )}

          {item.comments.length > 0 && (
            <Section title="營養師留言">
              {item.comments.map((c) => {
                const badge = ROLE_BADGES[c.role];
                return (
                  <div key={c.id} style={{ background: '#F4F7FA', borderRadius: 12, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#2D3B2D', wordBreak: 'break-all' }}>{c.author}</span>
                      {badge && <span style={{ fontSize: 10.5, fontWeight: 700, color: badge.color, background: badge.bg, borderRadius: 99, padding: '1px 7px' }}>{badge.name}</span>}
                      <span style={{ fontSize: 11, color: '#8A9284' }}>{fmtCommentTime(c.createdAt)}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: '#2D3B2D', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
                  </div>
                );
              })}
            </Section>
          )}
        </div>

        {error && <div style={{ fontSize: 12.5, color: '#C0564A', fontWeight: 700, lineHeight: 1.6 }}>{error}</div>}
        {!isLast && items.length > 1 && (
          <div style={{ fontSize: 12, color: '#8A9284', textAlign: 'center' }}>看完每一餐的回饋後才能關閉</div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          {error ? (
            <button onClick={snoozeReviews} disabled={busy} className="hv-sand" style={{ flex: 1, height: 48, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', color: '#4A5A4A', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              稍後再說
            </button>
          ) : (
            pageIdx > 0 && (
              <button onClick={() => setPageIdx(pageIdx - 1)} disabled={busy} className="hv-sand" style={{ flex: 1, height: 48, border: '1.5px solid #DDD8CA', borderRadius: 13, background: '#fff', color: '#4A5A4A', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                上一頁
              </button>
            )
          )}
          {isLast ? (
            <button onClick={() => void finish()} disabled={busy} className="hv-green" style={{ flex: 2, height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>
              {busy ? '儲存中…' : error ? '重試' : '我知道了'}
            </button>
          ) : (
            <button onClick={() => setPageIdx(pageIdx + 1)} className="hv-green" style={{ flex: 2, height: 48, border: 'none', borderRadius: 13, background: '#4A7C59', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              下一頁
            </button>
          )}
        </div>
      </ModalShell>
      {lightbox && <Lightbox photos={lightbox.photos} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </>
  );
}

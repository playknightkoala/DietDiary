import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../lib/api';
import { MEALS, dstr, entryHasData, fmtCommentTime, foodSummary, goalsFor, kcalOfFood, photoFoodOf, sortEntriesNewestFirst } from '../lib/domain';
import { useStore } from '../store';
import { CommentsThread } from './CommentsThread';
import { FoodSummaryGrid } from './FoodFields';
import { Lightbox } from './Lightbox';
import { PhotoRatingBadge } from './PhotoRatingBadge';
import type { CommentTarget } from '../types';

const postStyle: CSSProperties = {
  background: '#FFFFFF', borderRadius: 20, border: '1.5px solid #E4DFD2', padding: '14px 16px',
  display: 'flex', flexDirection: 'column', gap: 10,
};

function PostHeader({ glyph, tint, color, title, time, right }: { glyph: string; tint: string; color: string; title: string; time?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 38, height: 38, flex: 'none', borderRadius: 12, background: tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, color, fontWeight: 900 }}>{glyph}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 900, color: '#2D3B2D' }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#8A9284' }}>{time || '未填時間'}</div>
      </div>
      {right}
    </div>
  );
}

// 當日動態牆：飲食（新→舊）＋喝水＋運動，每則可展開留言
export function DayFeed() {
  const day = useStore((s) => s.day);
  const selected = useStore((s) => s.selected);
  const goals = useStore((s) => s.goals);
  const openLogFood = useStore((s) => s.openLogFood);
  const aiEnabled = useStore((s) => s.aiEnabled);
  const loadDay = useStore((s) => s.loadDay);
  const [lightbox, setLightbox] = useState<{ entryId: number; photos: string[]; index: number } | null>(null);
  // AI 今日總評（使用者按鈕觸發，產生後存成當天一則 AI 動態）
  const [dailyBusy, setDailyBusy] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const lightboxEntry = lightbox ? day.entries.find((e) => e.id === lightbox.entryId) : null;

  const entries = sortEntriesNewestFirst(day.entries.filter(entryHasData));
  const hasEx = (day.ex.min && +day.ex.min > 0) || day.ex.desc;
  const { water: waterGoal } = goalsFor(selected, goals);
  const isToday = selected === dstr(new Date());

  const commentProps = (target: CommentTarget, count: number) => ({
    count,
    load: () => api.getComments(target),
    post: (body: string) => api.postComment(target, body),
    edit: (id: number, body: string) => api.editComment(id, body),
    remove: (id: number) => api.deleteComment(id),
  });

  const hasBody = Object.values(day.body).some((v) => v !== '');
  const empty = entries.length === 0 && !hasEx && day.water <= 0;
  // 有任何當天資料才給按「今日總評」（純身體數據也算）
  const canSummarize = aiEnabled && (!empty || hasBody);

  const runDaily = async () => {
    if (dailyBusy) return;
    setDailyBusy(true);
    setDailyError('');
    try {
      await api.aiDaily(selected);
      await loadDay();
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : 'AI 今日總評產生失敗，請再試一次');
    } finally {
      setDailyBusy(false);
    }
  };

  // 讚／倒讚今日總評：再按同鍵＝取消；樂觀更新 store，失敗回復。倒讚會成為下次重新產生的依據
  const voteDaily = async (v: 1 | -1) => {
    const cur = day.aiSummary?.feedback ?? 0;
    const next = (cur === v ? 0 : v) as 1 | 0 | -1;
    useStore.setState((s) => (s.day.aiSummary ? { day: { ...s.day, aiSummary: { ...s.day.aiSummary, feedback: next } } } : {}));
    try {
      await api.aiFeedback('daily', selected, next);
    } catch {
      useStore.setState((s) => (s.day.aiSummary ? { day: { ...s.day, aiSummary: { ...s.day.aiSummary, feedback: cur } } } : {}));
    }
  };

  // 統一排序：飲食（用餐時間）、喝水（最後喝水時間）、運動（運動時刻）混排，新→舊；沒填時間的墊後
  const posts: { key: string; time: string; node: ReactNode }[] = entries.map((e) => {
    const m = MEALS.find((mm) => mm.k === e.meal) || MEALS[0];
    return {
      key: `e${e.id}`,
      time: e.eatTime,
      node: (
        <div key={`e${e.id}`} style={postStyle}>
          <PostHeader
            glyph={m.glyph}
            tint={m.tint}
            color={m.color}
            title={m.name}
            time={e.eatTime}
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {e.foodEditedAt > 0 && (
                  <span
                    title={`營養師於 ${fmtCommentTime(e.foodEditedAt)} 調整過這筆的六大類份數`}
                    style={{ fontSize: 11, fontWeight: 700, color: '#5B8DB8', background: '#E5EBF1', borderRadius: 99, padding: '3px 9px' }}
                  >
                    營養師調整份數
                  </span>
                )}
                <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: '#4A7C59' }}>{kcalOfFood(e.food)} kcal</span>
                <button onClick={() => openLogFood(e.id)} className="hv-cream" style={{ border: '1px solid #DDD8CA', background: '#fff', color: '#4A5A4A', borderRadius: 99, fontSize: 12, fontWeight: 700, padding: '4px 12px', cursor: 'pointer' }}>
                  編輯
                </button>
              </div>
            }
          />
          {e.desc && <div style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.desc}</div>}
          {e.photos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {e.photos.map((url, pi) => (
                <button key={url} onClick={() => setLightbox({ entryId: e.id, photos: e.photos, index: pi })} title="放大檢視" style={{ position: 'relative', display: 'block', border: 'none', background: 'transparent', padding: 0, cursor: 'zoom-in' }}>
                  <div style={{ width: 76, height: 76, borderRadius: 12, border: '1px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')` }} />
                  <PhotoRatingBadge rating={e.ratings[url]} size={14} />
                </button>
              ))}
            </div>
          )}
          {/* 這餐的六大類份數（唯讀，只列有填的欄位；要修改請按「編輯」） */}
          <FoodSummaryGrid food={e.food} />
          <CommentsThread
            key={`ec${e.id}`}
            {...commentProps(`entry:${e.id}`, e.commentCount)}
            aiComment={aiEnabled ? () => api.aiComment(`entry:${e.id}`) : undefined}
            voteAi={aiEnabled ? (id, v) => api.aiFeedback('comment', String(id), v).then(() => {}) : undefined}
          />
        </div>
      ),
    };
  });

  if (day.water > 0) {
    posts.push({
      key: 'water',
      time: day.waterTime,
      node: (
        <div key="water" style={postStyle}>
          <PostHeader
            glyph="水"
            tint="#E5EBF1"
            color="#5B8DB8"
            title="喝水"
            time={day.waterTime ? `${day.waterTime}・當日累計` : '當日累計'}
            right={<span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: '#5B8DB8', flex: 'none' }}>{day.water} / {waterGoal} ml</span>}
          />
          <CommentsThread key={`w${selected}`} {...commentProps(`water:${selected}`, day.commentCounts.water)} />
        </div>
      ),
    });
  }

  if (hasEx) {
    posts.push({
      key: 'ex',
      time: day.exTime,
      node: (
        <div key="ex" style={postStyle}>
          <PostHeader
            glyph="動"
            tint="#F3E7D8"
            color="#C77B4A"
            title="運動"
            time={day.exTime}
            right={day.ex.min && +day.ex.min > 0 ? <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: '#C77B4A', flex: 'none' }}>{day.ex.min} 分鐘</span> : undefined}
          />
          {day.ex.desc && <div style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{day.ex.desc}</div>}
          <CommentsThread key={`x${selected}`} {...commentProps(`ex:${selected}`, day.commentCounts.ex)} />
        </div>
      ),
    });
  }

  posts.sort((a, b) => {
    if (a.time && b.time) return b.time.localeCompare(a.time);
    if (a.time !== b.time) return a.time ? -1 : 1;
    return 0;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>{isToday ? '今日動態' : '當日動態'}</div>
        <div style={{ fontSize: 12, color: '#8A9284' }}>由新到舊・點「留言」可查看或回覆</div>
        <span style={{ flex: 1 }} />
        {canSummarize && (
          <button
            onClick={() => void runDaily()}
            disabled={dailyBusy}
            className="hv-cream"
            style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none', border: '1.5px solid #D9CEEA', borderRadius: 99, background: '#F6F3FB', color: '#7A5AB8', fontSize: 12.5, fontWeight: 700, padding: '6px 14px', cursor: dailyBusy ? 'default' : 'pointer', opacity: dailyBusy ? 0.65 : 1 }}
          >
            <span style={{ fontSize: 14 }}>✨</span>
            {dailyBusy ? 'AI 撰寫中…' : day.aiSummary ? '重新產生總評' : `AI ${isToday ? '今日' : '當日'}總評`}
          </button>
        )}
      </div>

      {dailyError && <div style={{ fontSize: 12.5, color: '#C0564A', padding: '0 2px' }}>{dailyError}</div>}

      {/* AI 今日總評：整天綜合評語（本人與營養師皆可見），置於動態最上方 */}
      {day.aiSummary && (
        <div style={{ ...postStyle, borderColor: '#E0D6F0', background: '#FBF9FE' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, flex: 'none', borderRadius: 12, background: '#EFE8FA', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>✨</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 900, color: '#2D3B2D' }}>AI 今日總評</div>
              <div style={{ fontSize: 11.5, color: '#8A9284' }}>{day.aiSummary.model}・{fmtCommentTime(day.aiSummary.createdAt)}</div>
            </div>
          </div>
          <div style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{day.aiSummary.body}</div>
          {aiEnabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => void voteDaily(1)}
                title="讚"
                style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${day.aiSummary.feedback === 1 ? '#4A7C59' : '#DDD8CA'}`, background: day.aiSummary.feedback === 1 ? '#E3EBD9' : '#fff', color: day.aiSummary.feedback === 1 ? '#3B6647' : '#8A9284', borderRadius: 99, padding: '3px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <span>👍</span>讚
              </button>
              <button
                onClick={() => void voteDaily(-1)}
                title="倒讚（下次重新產生會換個角度）"
                style={{ display: 'flex', alignItems: 'center', gap: 4, border: `1px solid ${day.aiSummary.feedback === -1 ? '#C0564A' : '#DDD8CA'}`, background: day.aiSummary.feedback === -1 ? '#F5E3DB' : '#fff', color: day.aiSummary.feedback === -1 ? '#A8433A' : '#8A9284', borderRadius: 99, padding: '3px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                <span>👎</span>倒讚
              </button>
            </div>
          )}
        </div>
      )}

      {empty && (
        <div style={{ ...postStyle, alignItems: 'center', color: '#8A9284', fontSize: 13.5, padding: '26px 16px' }}>
          這天還沒有任何紀錄，點右下「＋」開始記錄。
        </div>
      )}

      {posts.map((p) => p.node)}

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          caption={(url) => {
            const f = lightboxEntry ? photoFoodOf(lightboxEntry, url) : null;
            const summary = f ? foodSummary(f) : '';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#B8CDBB' }}>
                  這張照片的份數{f ? `・${kcalOfFood(f)} kcal` : ''}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{summary || '尚未記錄這張照片的份數'}</div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

import type { CSSProperties, ReactNode } from 'react';
import { api } from '../lib/api';
import { MEALS, dstr, entryHasData, goalsFor, kcalOfFood, sortEntriesNewestFirst } from '../lib/domain';
import { useStore } from '../store';
import { CommentsThread } from './CommentsThread';
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

  const entries = sortEntriesNewestFirst(day.entries.filter(entryHasData));
  const hasEx = (day.ex.min && +day.ex.min > 0) || day.ex.desc;
  const { water: waterGoal } = goalsFor(selected, goals);
  const isToday = selected === dstr(new Date());

  const commentProps = (target: CommentTarget, count: number) => ({
    count,
    load: () => api.getComments(target),
    post: (body: string) => api.postComment(target, body),
    remove: (id: number) => api.deleteComment(id),
  });

  const empty = entries.length === 0 && !hasEx && day.water <= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>{isToday ? '今日動態' : '當日動態'}</div>
        <div style={{ fontSize: 12, color: '#8A9284' }}>由新到舊・點「留言」可查看或回覆</div>
      </div>

      {empty && (
        <div style={{ ...postStyle, alignItems: 'center', color: '#8A9284', fontSize: 13.5, padding: '26px 16px' }}>
          這天還沒有任何紀錄，點右下「＋」開始記錄。
        </div>
      )}

      {entries.map((e) => {
        const m = MEALS.find((mm) => mm.k === e.meal) || MEALS[0];
        return (
          <div key={e.id} style={postStyle}>
            <PostHeader
              glyph={m.glyph}
              tint={m.tint}
              color={m.color}
              title={m.name}
              time={e.eatTime}
              right={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
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
                {e.photos.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" title="開啟原圖" style={{ position: 'relative', display: 'block' }}>
                    <div style={{ width: 76, height: 76, borderRadius: 12, border: '1px solid #E4DFD2', backgroundColor: '#F0EDE3', backgroundSize: 'cover', backgroundPosition: 'center', backgroundImage: `url('${url}')` }} />
                    <PhotoRatingBadge rating={e.ratings[url]} size={14} />
                  </a>
                ))}
              </div>
            )}
            <CommentsThread key={`e${e.id}`} {...commentProps(`entry:${e.id}`, e.commentCount)} />
          </div>
        );
      })}

      {day.water > 0 && (
        <div style={postStyle}>
          <PostHeader
            glyph="水"
            tint="#E5EBF1"
            color="#5B8DB8"
            title="喝水"
            time="當日累計"
            right={<span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: '#5B8DB8', flex: 'none' }}>{day.water} / {waterGoal} ml</span>}
          />
          <CommentsThread key={`w${selected}`} {...commentProps(`water:${selected}`, day.commentCounts.water)} />
        </div>
      )}

      {hasEx && (
        <div style={postStyle}>
          <PostHeader
            glyph="動"
            tint="#F3E7D8"
            color="#C77B4A"
            title="運動"
            time="當日紀錄"
            right={day.ex.min && +day.ex.min > 0 ? <span style={{ fontFamily: 'Outfit', fontSize: 14, fontWeight: 800, color: '#C77B4A', flex: 'none' }}>{day.ex.min} 分鐘</span> : undefined}
          />
          {day.ex.desc && <div style={{ fontSize: 13.5, color: '#4A5A4A', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{day.ex.desc}</div>}
          <CommentsThread key={`x${selected}`} {...commentProps(`ex:${selected}`, day.commentCounts.ex)} />
        </div>
      )}
    </div>
  );
}

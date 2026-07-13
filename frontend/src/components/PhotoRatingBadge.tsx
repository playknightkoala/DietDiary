import type { PhotoRating } from '../types';

export const RATING_DEFS: Record<PhotoRating, { name: string; color: string }> = {
  green: { name: '綠燈：均衡良好', color: '#3E9B4F' },
  yellow: { name: '黃燈：尚可，注意份量', color: '#E0A93E' },
  red: { name: '紅燈：需要改善', color: '#C0564A' },
};

export const RATING_KEYS: PhotoRating[] = ['green', 'yellow', 'red'];

// 照片角落的營養師評分燈號
export function PhotoRatingBadge({ rating, size = 16 }: { rating: PhotoRating | undefined; size?: number }) {
  if (!rating) return null;
  const def = RATING_DEFS[rating];
  return (
    <span
      title={`營養師評分 — ${def.name}`}
      style={{
        position: 'absolute', left: 4, bottom: 4, width: size, height: size, borderRadius: '50%',
        background: def.color, border: '2px solid #fff', boxShadow: '0 1px 4px rgba(45,59,45,.35)',
        display: 'block',
      }}
    />
  );
}

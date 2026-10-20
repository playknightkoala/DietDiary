import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { BodyTrendRow, DayData, Profile } from '../../types';
import { BodyOverviewView } from './BodyOverviewModal';

// 營養師頁的會員身體數據視窗：與會員端相同版面（當日數值、BMR／TDEE、歷程趨勢），唯讀（無「＋ 記錄」）
export function MemberBodyModal({
  memberId,
  date,
  day,
  profile,
  onClose,
}: {
  memberId: number;
  date: string;
  day: DayData;
  profile: Profile | null;
  onClose: () => void;
}) {
  const [trendRows, setTrendRows] = useState<BodyTrendRow[]>([]);

  // 開啟即載入該會員的歷程（失敗只顯示空圖，不擋視窗）
  useEffect(() => {
    let cancelled = false;
    api.proBodyTrend(memberId)
      .then(({ rows }) => { if (!cancelled) setTrendRows(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [memberId]);

  return (
    <BodyOverviewView
      dateLabel={date}
      body={day.body}
      bodyTime={day.bodyTime}
      profile={profile}
      trendRows={trendRows}
      onClose={onClose}
    />
  );
}

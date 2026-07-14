import { MEALS, fmtCommentTime } from '../../lib/domain';
import { useStore } from '../../store';
import type { NotificationItem } from '../../types';
import { CloseButton, ModalShell } from './ModalShell';

// 通知目標貼文的顯示名稱：如「7/13 早餐」「7/14 喝水」
function postLabel(n: NotificationItem): string {
  const [, m, d] = n.date.split('-').map(Number);
  const day = m && d ? `${m}/${d}` : n.date;
  if (n.target.startsWith('water:')) return `${day} 喝水`;
  if (n.target.startsWith('ex:')) return `${day} 運動`;
  const meal = MEALS.find((mm) => mm.k === n.meal);
  return `${day} ${meal ? meal.name : '飲食紀錄'}`;
}

const TYPE_DEFS = {
  comment: { glyph: '留', tint: '#E3EBD9', color: '#4A7C59', text: (label: string) => `你的「${label}」有新留言` },
  rating: { glyph: '評', tint: '#E5EBF1', color: '#5B8DB8', text: (label: string) => `營養師評分了「${label}」的照片` },
  food: { glyph: '份', tint: '#F3E7D8', color: '#C77B4A', text: (label: string) => `營養師調整了「${label}」的六大類份數` },
  post: { glyph: '新', tint: '#F6E5E9', color: '#B5537A', text: (label: string) => `「${label}」有新紀錄` },
} as const;

// 通知文字：memberId > 0 表示接收者為營養師（會員回覆／追蹤的會員發新貼文）
function itemText(n: NotificationItem): string {
  const label = postLabel(n);
  if (n.memberId > 0) {
    const name = n.memberName ?? '會員';
    if (n.type === 'post') return `${name} 新增了「${label}」`;
    return `${name} 回覆了「${label}」的留言`;
  }
  return TYPE_DEFS[n.type].text(label);
}

export function NotificationsModal() {
  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.unreadCount);
  const readNotification = useStore((s) => s.readNotification);
  const readAllNotifications = useStore((s) => s.readAllNotifications);
  const selectDate = useStore((s) => s.selectDate);
  const setView = useStore((s) => s.setView);
  const openProPost = useStore((s) => s.openProPost);
  const closeModal = useStore((s) => s.closeModal);

  // 點通知：標示已讀後跳轉——會員回覆通知跳到營養師頁該會員的貼文留言處，其餘跳到自己日記的該日
  const openItem = (n: NotificationItem) => {
    void readNotification(n.id);
    if (n.memberId > 0) {
      openProPost(n.memberId, n.date, n.target);
    } else {
      setView('diary');
      selectDate(n.date, true);
    }
  };

  return (
    <ModalShell maxWidth={440} cardStyle={{ maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '18px 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 900 }}>通知</div>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => void readAllNotifications()}
          disabled={unreadCount === 0}
          style={{ border: 'none', background: 'transparent', color: unreadCount > 0 ? '#5B8DB8' : '#B8BDB2', fontSize: 12.5, fontWeight: 700, cursor: unreadCount > 0 ? 'pointer' : 'default' }}
        >
          全部標示已讀
        </button>
        <CloseButton onClick={closeModal} />
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notifications.length === 0 && (
          <div style={{ textAlign: 'center', color: '#8A9284', fontSize: 13.5, padding: '30px 0' }}>目前沒有通知。</div>
        )}
        {notifications.map((n) => {
          const def = n.memberId > 0 && n.type !== 'post' ? TYPE_DEFS.comment : TYPE_DEFS[n.type];
          return (
            <button
              key={n.id}
              onClick={() => openItem(n)}
              className="hv-cream"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer',
                border: '1px solid #EEEAE0', borderRadius: 14, padding: '10px 12px',
                background: n.read ? '#FBFAF6' : '#FFF',
              }}
            >
              <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 11, background: def.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: def.color, fontWeight: 900 }}>{def.glyph}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13.5, color: '#2D3B2D', fontWeight: n.read ? 500 : 800, lineHeight: 1.5 }}>{itemText(n)}</span>
                <span style={{ fontSize: 11.5, color: '#8A9284' }}>{fmtCommentTime(n.createdAt)}</span>
              </div>
              {!n.read && <span style={{ width: 8, height: 8, flex: 'none', borderRadius: '50%', background: '#C0564A' }} />}
            </button>
          );
        })}
      </div>
    </ModalShell>
  );
}

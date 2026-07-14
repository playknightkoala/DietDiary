// 照片放大檢視（取代另開新視窗）：點背景或 ✕ 關閉
// zIndex 80：需蓋在一般彈窗（50）與指南（60）之上
export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,26,20,.85)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out' }}
    >
      <img
        src={url}
        alt=""
        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,.45)', animation: 'popIn .2s ease both' }}
      />
      <button
        onClick={onClose}
        title="關閉"
        style={{ position: 'fixed', top: 14, right: 14, width: 38, height: 38, border: 'none', borderRadius: 12, background: 'rgba(255,255,255,.16)', color: '#fff', fontSize: 17, cursor: 'pointer' }}
      >
        ✕
      </button>
    </div>
  );
}

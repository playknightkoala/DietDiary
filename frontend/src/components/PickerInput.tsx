import type { InputHTMLAttributes, MouseEvent } from 'react';

// 日期／時間輸入框：點擊任一處即彈出原生選擇器（不用點小圖示）
// showPicker 需要使用者手勢觸發；不支援的瀏覽器安靜退回預設行為
export function PickerInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const openPicker = (e: MouseEvent<HTMLInputElement>) => {
    const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
    try {
      el.showPicker?.();
    } catch {
      /* ignore */
    }
    props.onClick?.(e);
  };
  return <input {...props} onClick={openPicker} style={{ cursor: 'pointer', ...props.style }} />;
}

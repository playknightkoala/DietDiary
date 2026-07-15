declare const __APP_VERSION__: string;

// 這份前端建置的版號（編譯時由 vite 置換；來源 frontend/package.json）
export const APP_VERSION = __APP_VERSION__;

// 比較語意化版號（major.minor.patch）：a 大於 b 回傳正數
function cmp(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// 伺服器版號比目前這份前端「嚴格更新」→ 需要強制更新（相等或較舊都不觸發，避免重整迴圈）
export function isOutdated(serverVersion: string): boolean {
  return cmp(serverVersion, APP_VERSION) > 0;
}

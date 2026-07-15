import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 應用程式版號：來源為 backend/package.json（改版時請與 frontend/package.json 一起更新，
// 建議用 scripts/bump-version.mjs 一次改兩邊）。前端會輪詢 /api/version 比對，
// 伺服器版號較新時強制使用者更新。
const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
export const APP_VERSION: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

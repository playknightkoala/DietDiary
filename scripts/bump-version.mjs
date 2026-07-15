#!/usr/bin/env node
// 一次更新 frontend 與 backend 的版號，避免兩邊不一致造成強制更新迴圈。
// 用法（在專案根目錄執行）：node scripts/bump-version.mjs 1.0.1
import { readFileSync, writeFileSync } from 'node:fs';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) {
  console.error('用法: node scripts/bump-version.mjs <major.minor.patch>，例如 1.0.1');
  process.exit(1);
}

for (const f of ['frontend/package.json', 'backend/package.json']) {
  const pkg = JSON.parse(readFileSync(f, 'utf8'));
  pkg.version = v;
  writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`${f} -> ${v}`);
}

console.log('\n版號已更新。請重新建置並部署，兩邊才會同步生效：');
console.log('  docker compose up -d --build');

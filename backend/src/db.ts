import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/diet.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  approval_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS captchas (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS email_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS days (
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  water INTEGER NOT NULL DEFAULT 0,
  ex_min TEXT NOT NULL DEFAULT '',
  ex_desc TEXT NOT NULL DEFAULT '',
  body_weight TEXT NOT NULL DEFAULT '',
  body_fat TEXT NOT NULL DEFAULT '',
  body_waist TEXT NOT NULL DEFAULT '',
  body_muscle TEXT NOT NULL DEFAULT '',
  body_fatkg TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','night','snack')),
  desc TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  food TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date);

CREATE TABLE IF NOT EXISTS goals (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  vals TEXT NOT NULL,
  water INTEGER NOT NULL DEFAULT 2000
);
`);

// 舊資料庫沒有 status / approval_token 欄位：補上，且既有帳號一律視為已開通
const userCols = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
if (!userCols.includes('status')) {
  db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active'))`);
  db.exec(`UPDATE users SET status = 'active'`);
}
if (!userCols.includes('approval_token')) {
  db.exec(`ALTER TABLE users ADD COLUMN approval_token TEXT`);
}
const captchaCols = (db.pragma('table_info(captchas)') as { name: string }[]).map((c) => c.name);
if (!captchaCols.includes('verified')) {
  db.exec(`ALTER TABLE captchas ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`);
}

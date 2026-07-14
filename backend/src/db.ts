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
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','citizen','dietitian','admin')),
  nickname TEXT NOT NULL DEFAULT '',
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
  water_time TEXT NOT NULL DEFAULT '',
  ex_min TEXT NOT NULL DEFAULT '',
  ex_desc TEXT NOT NULL DEFAULT '',
  ex_time TEXT NOT NULL DEFAULT '',
  body_weight TEXT NOT NULL DEFAULT '',
  body_fat TEXT NOT NULL DEFAULT '',
  body_waist TEXT NOT NULL DEFAULT '',
  body_muscle TEXT NOT NULL DEFAULT '',
  body_fatkg TEXT NOT NULL DEFAULT '',
  body_time TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','night','snack')),
  desc TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  eat_time TEXT NOT NULL DEFAULT '',
  food TEXT NOT NULL DEFAULT '{}',
  photo_foods TEXT NOT NULL DEFAULT '{}',
  food_edited_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, date);

CREATE TABLE IF NOT EXISTS entry_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target TEXT NOT NULL,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entry_comments_target ON entry_comments(user_id, target);

CREATE TABLE IF NOT EXISTS photo_ratings (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  photo TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('green','yellow','red')),
  rated_by INTEGER,
  rated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entry_id, photo)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('comment','rating','food','post')),
  target TEXT NOT NULL,
  date TEXT NOT NULL,
  member_id INTEGER NOT NULL DEFAULT 0,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS follows (
  dietitian_id INTEGER NOT NULL REFERENCES users(id),
  member_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (dietitian_id, member_id)
);

CREATE TABLE IF NOT EXISTS member_aliases (
  dietitian_id INTEGER NOT NULL REFERENCES users(id),
  member_id INTEGER NOT NULL REFERENCES users(id),
  alias TEXT NOT NULL,
  PRIMARY KEY (dietitian_id, member_id)
);

CREATE TABLE IF NOT EXISTS goal_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  vals TEXT NOT NULL,
  water INTEGER NOT NULL DEFAULT 2000,
  set_by TEXT NOT NULL DEFAULT 'self' CHECK (set_by IN ('self','dietitian')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goal_periods_user ON goal_periods(user_id);
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
if (!userCols.includes('role')) {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','citizen','dietitian','admin'))`);
}

// 舊資料表的 role CHECK 不含 citizen（駒駒國民）：SQLite 無法改約束，須重建資料表搬移資料
const usersSql = (
  db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get() as { sql: string }
).sql;
if (!usersSql.includes('citizen')) {
  db.pragma('foreign_keys = OFF');
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','citizen','dietitian','admin')),
        approval_token TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, username, password_hash, status, role, approval_token, created_at)
        SELECT id, username, password_hash, status, role, approval_token, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  });
  rebuild();
  db.pragma('foreign_keys = ON');
}
// 暱稱欄位（於 citizen 重建之後檢查，確保新舊資料庫皆補上）
const userCols2 = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
if (!userCols2.includes('nickname')) {
  db.exec(`ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''`);
}

const captchaCols = (db.pragma('table_info(captchas)') as { name: string }[]).map((c) => c.name);
if (!captchaCols.includes('verified')) {
  db.exec(`ALTER TABLE captchas ADD COLUMN verified INTEGER NOT NULL DEFAULT 0`);
}

// 舊資料庫 entries 只有單張 photo：補 photos 欄位並把舊照片搬進陣列
const entryCols = (db.pragma('table_info(entries)') as { name: string }[]).map((c) => c.name);
if (!entryCols.includes('photos')) {
  db.exec(`ALTER TABLE entries ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'`);
}
if (!entryCols.includes('eat_time')) {
  db.exec(`ALTER TABLE entries ADD COLUMN eat_time TEXT NOT NULL DEFAULT ''`);
}
if (!entryCols.includes('food_edited_at')) {
  // 營養師調整份數的時間戳（0＝未被調整）
  db.exec(`ALTER TABLE entries ADD COLUMN food_edited_at INTEGER NOT NULL DEFAULT 0`);
}
if (!entryCols.includes('photo_foods')) {
  // 逐張照片的六大類份數（photo url → food JSON；有照片時 food 欄位存總和）
  db.exec(`ALTER TABLE entries ADD COLUMN photo_foods TEXT NOT NULL DEFAULT '{}'`);
}

// 喝水／運動／身體數據的紀錄時間
const dayCols = (db.pragma('table_info(days)') as { name: string }[]).map((c) => c.name);
for (const col of ['water_time', 'ex_time', 'body_time']) {
  if (!dayCols.includes(col)) {
    db.exec(`ALTER TABLE days ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
}
const legacyPhotos = db
  .prepare(`SELECT id, photo FROM entries WHERE photo != '' AND photos = '[]'`)
  .all() as { id: number; photo: string }[];
if (legacyPhotos.length) {
  const move = db.prepare(`UPDATE entries SET photos = ?, photo = '' WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const r of legacyPhotos) move.run(JSON.stringify([r.photo]), r.id);
  });
  tx();
}

// 通知的 member_id：接收者為營養師時，標記通知來自哪位會員的貼文（0＝自己的紀錄）
const notifCols = (db.pragma('table_info(notifications)') as { name: string }[]).map((c) => c.name);
if (!notifCols.includes('member_id')) {
  db.exec(`ALTER TABLE notifications ADD COLUMN member_id INTEGER NOT NULL DEFAULT 0`);
}

// 舊 notifications 的 type CHECK 不含 post（追蹤的會員發新貼文）：重建資料表搬移資料
const notifSql = (
  db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'`).get() as { sql: string }
).sql;
if (!notifSql.includes("'post'")) {
  db.pragma('foreign_keys = OFF');
  const rebuildNotif = db.transaction(() => {
    db.exec(`
      CREATE TABLE notifications_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN ('comment','rating','food','post')),
        target TEXT NOT NULL,
        date TEXT NOT NULL,
        member_id INTEGER NOT NULL DEFAULT 0,
        read INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      INSERT INTO notifications_new (id, user_id, type, target, date, member_id, read, created_at)
        SELECT id, user_id, type, target, date, member_id, read, created_at FROM notifications;
      DROP TABLE notifications;
      ALTER TABLE notifications_new RENAME TO notifications;
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
    `);
  });
  rebuildNotif();
  db.pragma('foreign_keys = ON');
}

// 舊資料庫的單筆 goals 資料表：搬進 goal_periods 後移除
const hasOldGoals = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goals'`)
  .get();
if (hasOldGoals) {
  db.exec(`
    INSERT INTO goal_periods (user_id, start, end, vals, water, set_by)
    SELECT user_id, start, end, vals, water, 'self' FROM goals;
    DROP TABLE goals;
  `);
}

// ADMIN_EMAIL 對應的帳號自動成為管理者（並確保已開通），作為後台的初始管理員
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
export function promoteAdminIfConfigured(username?: string) {
  if (!ADMIN_EMAIL) return;
  if (username && username.toLowerCase() !== ADMIN_EMAIL) return;
  db.prepare(
    `UPDATE users SET role = 'admin', status = 'active', approval_token = NULL WHERE lower(username) = ?`
  ).run(ADMIN_EMAIL);
}
promoteAdminIfConfigured();

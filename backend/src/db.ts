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
  last_seen_at INTEGER,
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

-- AI 今日總評：每位使用者每天一筆（重新產生會覆蓋），本人與營養師檢視當天時皆可見
CREATE TABLE IF NOT EXISTS daily_summaries (
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  body TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);

-- AI 評價：使用者對某則 AI 產出（評語／今日總評）按讚(1)或倒讚(-1)。
-- body 存下被評價當下的內容快照：讚過的當「好範例」、倒讚過的當「反例」，
-- 注入使用者往後每一次 AI 生成的提示，讓模型照他的偏好調整。
CREATE TABLE IF NOT EXISTS ai_feedback (
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,          -- 'comment' | 'daily'
  ref TEXT NOT NULL,           -- comment: 留言 id；daily: 日期
  vote INTEGER NOT NULL,       -- 1＝讚、-1＝倒讚
  body TEXT NOT NULL DEFAULT '', -- 被評價當下的 AI 內容快照
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);
`);

// ai_feedback.body（被評價內容快照）：舊資料表補欄位
const aiFbCols = (db.pragma('table_info(ai_feedback)') as { name: string }[]).map((c) => c.name);
if (!aiFbCols.includes('body')) {
  db.exec(`ALTER TABLE ai_feedback ADD COLUMN body TEXT NOT NULL DEFAULT ''`);
}

// 共用菜色知識庫（所有 AI 使用者共享；粒度＝一道菜一列）。
// 相似的敘述/照片併成同一列，food 為「社群共識份數」（併入時取平均），
// up/down 為全體對此菜份數估計的讚/倒讚累計。新照片來時查最相似的一列當估算依據。
db.exec(`
CREATE TABLE IF NOT EXISTS dish_kb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caption TEXT NOT NULL,          -- 代表性敘述
  food TEXT NOT NULL,             -- 六大類共識份數 JSON
  n INTEGER NOT NULL DEFAULT 1,   -- 併入次數（算共識平均用）
  text_vec BLOB,                  -- 敘述向量（Float32）
  image_vec BLOB,                 -- 圖片向量（Float32）
  up INTEGER NOT NULL DEFAULT 0,  -- 全體讚（份數估計可信）
  down INTEGER NOT NULL DEFAULT 0,-- 全體倒讚（份數估計踩雷）
  updated_at INTEGER NOT NULL
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
// 最後使用時間（epoch 毫秒；NULL＝從未登入使用過），供管理者後台顯示
if (!userCols2.includes('last_seen_at')) {
  db.exec(`ALTER TABLE users ADD COLUMN last_seen_at INTEGER`);
}
// AI 功能權限（0＝關閉、1＝開啟）：由管理者於後台逐一開放，非全體可用
if (!userCols2.includes('ai_enabled')) {
  db.exec(`ALTER TABLE users ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0`);
}

// entry_comments 增加 is_ai 標記（1＝AI 產生的評語）：顯示 AI 標籤、不可被當成本人留言編輯
const commentCols = (db.pragma('table_info(entry_comments)') as { name: string }[]).map((c) => c.name);
if (!commentCols.includes('is_ai')) {
  db.exec(`ALTER TABLE entry_comments ADD COLUMN is_ai INTEGER NOT NULL DEFAULT 0`);
}
// AI 評語記錄實際產生的模型（主模型壞掉退回備援時，讓使用者知道結果來自哪個模型）
if (!commentCols.includes('ai_model')) {
  db.exec(`ALTER TABLE entry_comments ADD COLUMN ai_model TEXT NOT NULL DEFAULT ''`);
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

// 逐筆喝水紀錄（一筆＝動態牆一則貼文；days.water / water_time 降為快取＝總和／最後時間）
db.exec(`
CREATE TABLE IF NOT EXISTS water_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  ml INTEGER NOT NULL,
  time TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, date);
`);

// 一次性搬遷：舊的當日累計（days.water）變成該天的一筆 log；
// 舊留言／通知的 water:<日期> 目標改掛到搬出來的那筆 log（water:<id>）。
// 搬遷後 days.water 由 log 加總維護，不會再出現「有累計但沒有 log」的狀態，故可安全重跑。
const migrateWater = db.transaction(() => {
  db.exec(`
    INSERT INTO water_logs (user_id, date, ml, time)
    SELECT d.user_id, d.date, d.water, d.water_time FROM days d
    WHERE d.water > 0
      AND NOT EXISTS (SELECT 1 FROM water_logs w WHERE w.user_id = d.user_id AND w.date = d.date);
    UPDATE entry_comments SET target = 'water:' || (
      SELECT MIN(w.id) FROM water_logs w
      WHERE w.user_id = entry_comments.user_id AND w.date = substr(entry_comments.target, 7)
    )
    WHERE target LIKE 'water:%-%'
      AND EXISTS (SELECT 1 FROM water_logs w WHERE w.user_id = entry_comments.user_id AND w.date = substr(entry_comments.target, 7));
    UPDATE notifications SET target = 'water:' || (
      SELECT MIN(w.id) FROM water_logs w
      WHERE w.user_id = CASE WHEN notifications.member_id > 0 THEN notifications.member_id ELSE notifications.user_id END
        AND w.date = substr(notifications.target, 7)
    )
    WHERE target LIKE 'water:%-%'
      AND EXISTS (
        SELECT 1 FROM water_logs w
        WHERE w.user_id = CASE WHEN notifications.member_id > 0 THEN notifications.member_id ELSE notifications.user_id END
          AND w.date = substr(notifications.target, 7)
      );
  `);
});
migrateWater();

// 逐筆運動紀錄（一筆＝動態牆一則貼文；days.ex_min / ex_desc / ex_time 降為快取＝總分鐘／敘述串接／最後時間）
db.exec(`
CREATE TABLE IF NOT EXISTS ex_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  min TEXT NOT NULL DEFAULT '',
  desc TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ex_logs_user_date ON ex_logs(user_id, date);
`);

// 一次性搬遷：舊的當日運動（days.ex_*）變成該天的一筆 log；
// 舊留言／通知的 ex:<日期> 目標改掛到搬出來的那筆 log（ex:<id>）。與喝水搬遷同一套邏輯，可安全重跑。
const migrateEx = db.transaction(() => {
  db.exec(`
    INSERT INTO ex_logs (user_id, date, min, desc, time)
    SELECT d.user_id, d.date, d.ex_min, d.ex_desc, d.ex_time FROM days d
    WHERE (d.ex_desc != '' OR (d.ex_min != '' AND CAST(d.ex_min AS REAL) > 0))
      AND NOT EXISTS (SELECT 1 FROM ex_logs x WHERE x.user_id = d.user_id AND x.date = d.date);
    UPDATE entry_comments SET target = 'ex:' || (
      SELECT MIN(x.id) FROM ex_logs x
      WHERE x.user_id = entry_comments.user_id AND x.date = substr(entry_comments.target, 4)
    )
    WHERE target LIKE 'ex:%-%'
      AND EXISTS (SELECT 1 FROM ex_logs x WHERE x.user_id = entry_comments.user_id AND x.date = substr(entry_comments.target, 4));
    UPDATE notifications SET target = 'ex:' || (
      SELECT MIN(x.id) FROM ex_logs x
      WHERE x.user_id = CASE WHEN notifications.member_id > 0 THEN notifications.member_id ELSE notifications.user_id END
        AND x.date = substr(notifications.target, 4)
    )
    WHERE target LIKE 'ex:%-%'
      AND EXISTS (
        SELECT 1 FROM ex_logs x
        WHERE x.user_id = CASE WHEN notifications.member_id > 0 THEN notifications.member_id ELSE notifications.user_id END
          AND x.date = substr(notifications.target, 4)
      );
  `);
});
migrateEx();

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

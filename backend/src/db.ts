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
  verified INTEGER NOT NULL DEFAULT 0,
  email TEXT
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
  custom_items TEXT NOT NULL DEFAULT '[]',
  photo_customs TEXT NOT NULL DEFAULT '{}',
  items TEXT NOT NULL DEFAULT '[]',
  orig_data TEXT NOT NULL DEFAULT '',
  food_edited_at INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
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

// KB 投票紀錄：每人對每道菜最多一票（防重送灌票），dish_kb.up/down 由此表的變化差額維護。
// dish_id 不設 FK：dish_kb 列會被合併刪除，殘票只是無效參照、不該擋刪除。
db.exec(`
CREATE TABLE IF NOT EXISTS kb_votes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  dish_id INTEGER NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (1, -1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, dish_id)
);
`);

// Tavily 網路搜尋（search.ts）：按月額度計數＋查詢結果快取。
// used 以「原子先扣後打」維護（檢查＋累加同一條 UPDATE），reconciled_at 為最近一次與官方 /usage 對帳的時間。
db.exec(`
CREATE TABLE IF NOT EXISTS search_usage (
  month TEXT PRIMARY KEY,                    -- 'YYYY-MM'
  used INTEGER NOT NULL DEFAULT 0,           -- 當月已扣 credits
  reconciled_at INTEGER NOT NULL DEFAULT 0   -- 最近對帳時間（epoch 毫秒）
);
CREATE TABLE IF NOT EXISTS search_cache (
  query TEXT PRIMARY KEY,        -- 正規化後的查詢字串
  result TEXT NOT NULL,          -- WebSearchResult JSON（不含 fromCache）
  created_at INTEGER NOT NULL    -- 寫入時間（epoch 毫秒；90 天後視為過期）
);
`);

// 全域設定 key-value（sugar_limit_g＝每日精緻糖門檻公克數；未設定時程式預設 25＝WHO 建議）。
db.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 早期開發版的 ng_keywords 把分類寫死成 enum CHECK；此功能從未釋出（只存在開發環境），
// 偵測到舊表就直接重建並清掉舊播種旗標，讓下方 v2 種子重播（新清單涵蓋舊清單全部內容）
const ngOldSql = (
  db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ng_keywords'`).get() as { sql: string } | undefined
)?.sql;
if (ngOldSql && ngOldSql.includes("'fried'")) {
  db.exec('DROP TABLE ng_keywords');
  db.prepare(`DELETE FROM app_settings WHERE key = 'ng_keywords_seeded'`).run();
}

// NG 加工食品分類與關鍵字（全域、管理員維護，ng.ts）。
// 分類是資料不是 enum（管理員可自行增刪改）；level 等級（extreme 極高／high 高／medium 中）
// 與前端 lib/ng.ts 的 NG_LEVEL_LABELS 是同步契約。keyword 存正規化形（NFKC＋小寫＋trim），
// 比對用「子字串包含」，UNIQUE 防重複；is_exclusion=1＝排除詞（命中字段先剔除再比對，不算 NG），
// 排除詞不屬於任何分類（category_id NULL）。刪分類時 FK 會擋下仍有關鍵字的分類。
db.exec(`
CREATE TABLE IF NOT EXISTS ng_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  level TEXT NOT NULL DEFAULT 'high' CHECK (level IN ('extreme','high','medium')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ng_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES ng_categories(id),
  is_exclusion INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// NG 分類＋關鍵字種子（v2）：只播一次（旗標與種子同一交易，中斷可重跑；管理員刪改後不會復活）
if (!db.prepare(`SELECT 1 FROM app_settings WHERE key = 'ng_seeded_v2'`).get()) {
  // [分類, 等級, 為什麼 NG, 關鍵字…]；關鍵字全域 UNIQUE，重複出現的品項只歸最具代表性的分類
  const seedCats: [string, string, string, string[]][] = [
    ['含糖手搖飲', 'extreme', '液體熱量＋糖，很不容易產生相應飽足感', ['珍珠奶茶', '黑糖鮮奶', '奶蓋茶', '楊枝甘露', '水果茶', '多多綠', '冬瓜茶']],
    ['含糖瓶裝飲料', 'extreme', '一瓶可能就多出數百 kcal，而且不太影響下一餐食量', ['可樂', '汽水', '果汁', '奶茶', '運動飲料', '能量飲', '加糖咖啡']],
    ['酒精', 'extreme', '酒精本身有熱量，又容易搭配炸物、宵夜', ['啤酒', '調酒', '梅酒', '威士忌', '燒酒']],
    ['炸物', 'extreme', '食材吸油後熱量密度大幅上升', ['鹹酥雞', '鹽酥雞', '雞排', '炸雞', '甜不辣', '薯條', '炸豆腐', '炸杏鮑菇', '地瓜球']],
    ['酥皮／糕餅', 'extreme', '「澱粉＋糖＋大量油脂」組合，非常容易吃進高熱量', ['蛋黃酥', '鳳梨酥', '太陽餅', '老婆餅', '奶油酥餅', '可頌', '丹麥麵包']],
    ['甜點', 'extreme', '糖＋脂肪、份量小但熱量高', ['蛋糕', '泡芙', '甜甜圈', '冰淇淋', '布丁', '提拉米蘇', '車輪餅']],
    ['零食', 'extreme', '飽足感低，很容易無意識一直吃', ['洋芋片', '蝦味先', '玉米濃湯棒', '餅乾', '威化餅', '巧克力', '糖果']],
    ['台式早餐高油組合', 'high', '油、醬料和精製澱粉容易疊加', ['鐵板麵', '薯餅蛋餅', '培根蛋餅', '炸雞堡', '蘿蔔糕煎蛋']],
    ['傳統飯糰', 'high', '糯米份量高，再加油條與肉鬆，熱量密度很高', ['飯糰', '油條']],
    ['滷肉飯／爌肉飯', 'high', '白飯本身不是問題，主要是大量肥肉、滷汁與份量', ['滷肉飯', '肉燥飯', '爌肉飯']],
    ['油飯／炒飯／炒麵', 'high', '最大問題是看不到的烹調油', ['油飯', '炒飯', '炒米粉', '炒麵']],
    ['乾拌麵', 'high', '麵＋芝麻醬／油蔥等脂肪，熱量容易很高', ['麻醬麵', '乾麵', '炸醬麵']],
    ['夜市小吃', 'high', '通常同時具備大量油脂、精製澱粉和醬料', ['蔥油餅', '蚵仔煎', '大腸包小腸', '棺材板', '臭豆腐']],
    ['火鍋加工料', 'high', '小小一顆但脂肪與熱量可能不低，且容易吃很多', ['貢丸', '魚餃', '蛋餃', '燕餃', '蟹味棒', '鑫鑫腸']],
    ['火鍋沾醬', 'high', '很典型的「看不到的熱量」，兩三匙就差很多', ['沙茶醬', '芝麻醬', '花生醬']],
    ['肥肉類', 'high', '蛋白質沒問題，問題在脂肪比例很高', ['五花肉', '三層肉', '臘肉', '肥牛']],
    ['加工肉品', 'high', '脂肪較高、容易搭配高熱量澱粉', ['熱狗', '香腸', '培根', '火腿', '午餐肉']],
    ['濃醬料理', 'high', '醬汁裡通常有大量油、奶油、糖', ['咖哩飯', '奶油義大利麵', '白醬', '焗烤', '三杯']],
    ['泡麵', 'high', '麵體與醬包油脂高，蛋白質與蔬菜少，飽足感不理想', ['泡麵']],
    ['花生／芝麻類甜品', 'high', '花生芝麻本身不是壞食物，但「脂肪＋糖」後熱量非常集中', ['花生湯', '芝麻糊', '花生糖', '芝麻糖']],
    ['麵包', 'medium', '不是所有麵包都 NG，主要看奶油、糖、餡料', ['奶酥', '菠蘿麵包', '紅豆麵包', '肉鬆麵包', '起司麵包']],
    ['水餃／鍋貼', 'medium', '可以吃，但一餐吃 15–20 顆很容易超量；鍋貼又多煎油', ['水餃', '鍋貼', '煎餃']],
    ['披薩／漢堡', 'medium', '起司、醬汁、肥肉與精製澱粉疊加', ['披薩', '漢堡']],
    ['勾芡料理', 'medium', '勾芡不是罪魁禍首，主要是容易搭配大量澱粉與油', ['羹麵', '肉羹', '酸辣湯', '燴飯']],
    ['果汁／果昔', 'medium', '就算不加糖，也比直接吃水果容易快速攝取大量糖與熱量', ['柳橙汁', '西瓜汁', '果昔']],
    ['高熱量健康食品', 'medium', '營養價值高，但並非「減肥吃多少都可以」', ['堅果', '酪梨', '起司']],
    ['全脂乳製品甜品', 'medium', '無糖牛奶不等於 NG，真正要注意的是額外糖和份量', ['調味優格', '優酪乳', '奶昔']],
  ];
  db.transaction(() => {
    const insCat = db.prepare('INSERT OR IGNORE INTO ng_categories (name, level, note) VALUES (?, ?, ?)');
    const getCat = db.prepare('SELECT id FROM ng_categories WHERE name = ?');
    const insKw = db.prepare('INSERT OR IGNORE INTO ng_keywords (keyword, category_id, is_exclusion) VALUES (?, ?, 0)');
    for (const [name, level, note, keywords] of seedCats) {
      insCat.run(name, level, note);
      const catId = (getCat.get(name) as { id: number }).id;
      for (const kw of keywords) insKw.run(kw, catId);
    }
    // 預設排除詞：黑巧克力不被「巧克力」誤判
    db.prepare('INSERT OR IGNORE INTO ng_keywords (keyword, category_id, is_exclusion) VALUES (?, NULL, 1)').run('黑巧克力');
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('ng_seeded_v2', '1')`).run();
  })();
}

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

// TDEE 基本資料：身高（cm）／出生年／生理性別／活動量，計算 BMR 與 TDEE 用。
// 存「出生年」而非年齡，年齡隨年份自動增加；''＝未設定（與 body 欄位同樣以 TEXT 空字串表示）。
// 逐欄檢查（不可整組共用第一欄當開關）：新增途中若中斷，重啟才補得齊剩餘欄位
if (!userCols2.includes('profile_height')) {
  db.exec(`ALTER TABLE users ADD COLUMN profile_height TEXT NOT NULL DEFAULT ''`);
}
if (!userCols2.includes('profile_birth_year')) {
  db.exec(`ALTER TABLE users ADD COLUMN profile_birth_year TEXT NOT NULL DEFAULT ''`);
}
if (!userCols2.includes('profile_gender')) {
  db.exec(`ALTER TABLE users ADD COLUMN profile_gender TEXT NOT NULL DEFAULT '' CHECK (profile_gender IN ('', 'male', 'female'))`);
}
if (!userCols2.includes('profile_activity')) {
  db.exec(`ALTER TABLE users ADD COLUMN profile_activity TEXT NOT NULL DEFAULT ''`);
}
// 體重目標：normal＝一般（TDEE 不調整）、cut＝減重（TDEE－goal_kcal）、gain＝增重（TDEE＋goal_kcal）
if (!userCols2.includes('profile_goal')) {
  db.exec(`ALTER TABLE users ADD COLUMN profile_goal TEXT NOT NULL DEFAULT 'normal' CHECK (profile_goal IN ('normal', 'cut', 'gain'))`);
}
if (!userCols2.includes('profile_goal_kcal')) {
  db.exec(`ALTER TABLE users ADD COLUMN profile_goal_kcal TEXT NOT NULL DEFAULT ''`);
}
// 介面自定義（主頁卡片順序與顯示；JSON 字串，''＝未設定）：跟帳號儲存，換裝置登入自動帶入
if (!userCols2.includes('ui_layout')) {
  db.exec(`ALTER TABLE users ADD COLUMN ui_layout TEXT NOT NULL DEFAULT ''`);
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
// 綁定「這張驗證碼首次寄送的 Email」：一張驗證碼只能寄給同一個 Email，堵住並行請求對多個 Email 濫發
if (!captchaCols.includes('email')) {
  db.exec(`ALTER TABLE captchas ADD COLUMN email TEXT`);
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
if (!entryCols.includes('custom_items')) {
  // 自定義熱量項目（v1 過渡欄位，已改存 photo_customs/items；保留欄位供舊庫遷移判斷）
  db.exec(`ALTER TABLE entries ADD COLUMN custom_items TEXT NOT NULL DEFAULT '[]'`);
}
if (!entryCols.includes('photo_customs')) {
  // 逐張照片的自定義熱量項目（photo url → CustomItem[]；與 photo_foods 平行、同步修剪）
  db.exec(`ALTER TABLE entries ADD COLUMN photo_customs TEXT NOT NULL DEFAULT '{}'`);
}
if (!entryCols.includes('items')) {
  // 無照片的食物項目頁（[{food, customItems}]，可與照片頁並存）；
  // 不變量：food 欄位 = photo_foods 各值加總 + items 各項 food 加總
  db.exec(`ALTER TABLE entries ADD COLUMN items TEXT NOT NULL DEFAULT '[]'`);
}
if (!entryCols.includes('revision')) {
  // 樂觀鎖版本號：每次內容更新 +1；PATCH 帶 expectedRevision 不符即回 409，
  // 防止兩台裝置同時開著編輯視窗時互相覆蓋（後存的整筆蓋掉先存的）
  db.exec(`ALTER TABLE entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`);
}
if (!entryCols.includes('orig_data')) {
  // 營養師調整前的會員原始資料快照（{photoFoods, photoCustoms, items, food} JSON；''＝未被調整）。
  // 營養師第一次實際改動份數或自定義時寫入、之後的調整不再覆蓋；會員自行再改份數時清除
  db.exec(`ALTER TABLE entries ADD COLUMN orig_data TEXT NOT NULL DEFAULT ''`);
}

// v1 過渡資料一次性遷移：per-entry custom_items → 有照片搬到第一張的 photo_customs、
// 無照片搬成單一 items 項（連同既有 food）。搬完清空 custom_items，重跑即 no-op。
{
  const legacyCustomRows = db
    .prepare(`SELECT id, photos, food, custom_items FROM entries WHERE custom_items != '[]'`)
    .all() as { id: number; photos: string; food: string; custom_items: string }[];
  if (legacyCustomRows.length) {
    const tx = db.transaction(() => {
      for (const r of legacyCustomRows) {
        let photos: string[] = [];
        try { photos = JSON.parse(r.photos) ?? []; } catch { /* 視為無照片 */ }
        if (photos.length) {
          db.prepare(`UPDATE entries SET photo_customs = ?, custom_items = '[]' WHERE id = ?`).run(
            JSON.stringify({ [photos[0]]: JSON.parse(r.custom_items) }),
            r.id
          );
        } else {
          let food = {};
          try { food = JSON.parse(r.food) ?? {}; } catch { /* 空 food */ }
          db.prepare(`UPDATE entries SET items = ?, custom_items = '[]' WHERE id = ?`).run(
            JSON.stringify([{ food, customItems: JSON.parse(r.custom_items) }]),
            r.id
          );
        }
      }
    });
    tx();
  }
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

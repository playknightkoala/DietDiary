export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'night' | 'snack';

export type FoodKey =
  | 'meatLow' | 'meatMed' | 'meatHigh' | 'meatXHigh'
  | 'veg' | 'grain' | 'oil' | 'fruit'
  | 'milkSkim' | 'milkLow' | 'milkFull';

export type Food = Record<FoodKey, number>;

// 營養師對單張照片的評分：綠燈（均衡）／黃燈（尚可）／紅燈（需改善）
export type PhotoRating = 'green' | 'yellow' | 'red';

export interface Entry {
  id: number;
  meal: MealKey;
  desc: string;
  photos: string[];
  // 以照片 URL 為 key 的營養師評分（未評分的照片不會出現）
  ratings: Partial<Record<string, PhotoRating>>;
  // 用餐時間 HH:MM，空字串＝未填
  eatTime: string;
  commentCount: number;
  // 有照片時為各照片份數的總和；無照片時為整筆的份數
  food: Food;
  // 逐張照片的份數（photo url → Food；尚未記錄的照片不會出現）
  photoFoods: Partial<Record<string, Food>>;
  // 營養師調整份數的時間戳（Unix ms，0＝未被調整）
  foodEditedAt: number;
}

// 從歷史加入：一張記過份數的照片＋其六大類份數（快速帶入用）
export interface HistoryItem {
  photo: string;
  food: Food;
  desc: string;
  meal: MealKey;
  date: string;
}

// 留言對象：某筆飲食（entry:<id>）、某筆喝水（water:<id>）或某筆運動（ex:<id>）
export type CommentTarget = `entry:${number}` | `water:${number}` | `ex:${number}`;

export interface EntryComment {
  id: number;
  body: string;
  createdAt: number; // Unix ms
  author: string;
  role: Role;
  mine: boolean;
  // true＝AI 產生的評語（顯示 AI 標籤；本人無法編輯，但可刪除自己貼文下的 AI 評語）
  ai: boolean;
  // AI 評語實際使用的模型（非 AI 留言為空字串）
  aiModel: string;
  // 擁有者對這則 AI 評語的評價（1＝讚、-1＝倒讚、0＝未評；非 AI 留言為 0）
  feedback: number;
}

export type BodyKey = 'weight' | 'fat' | 'waist' | 'muscle' | 'fatkg';

// AI 今日總評：整天的綜合評語（每天一份，重新產生會覆蓋；null＝尚未產生）
export interface DailySummary {
  body: string;
  model: string;
  createdAt: number; // Unix ms
  feedback: number; // 擁有者的評價（1＝讚、-1＝倒讚、0＝未評）
}

// 逐筆喝水紀錄（一筆＝動態牆一則貼文）
export interface WaterLog {
  id: number;
  ml: number;
  time: string; // HH:MM，空字串＝未填
  commentCount: number;
}

// 逐筆運動紀錄（一筆＝動態牆一則貼文）
export interface ExLog {
  id: number;
  min: string; // 分鐘（字串，空字串＝未填）
  desc: string;
  time: string; // HH:MM，空字串＝未填
  commentCount: number;
}

export interface DayData {
  water: number; // 當日累計（waterLogs 的總和）
  waterTime: string; // 最後一次喝水紀錄時間 HH:MM，空字串＝未填
  waterLogs: WaterLog[];
  exLogs: ExLog[];
  body: Record<BodyKey, string>;
  bodyTime: string;
  entries: Entry[];
  // AI 今日總評（尚未產生為 null）
  aiSummary: DailySummary | null;
}

export type GoalKey = 'meat' | 'veg' | 'grain' | 'oil' | 'fruit' | 'milk';

export interface Goal {
  id: number;
  start: string;
  end: string;
  vals: Record<GoalKey, number>;
  water: number;
  setBy: 'self' | 'dietitian';
}

// 建立／更新目標時送出的內容（不含 id / setBy）
export type GoalInput = Omit<Goal, 'id' | 'setBy'>;

export interface TrendPoint {
  date: string;
  value: number;
}

// citizen（駒駒國民）：權限與 member 完全相同，僅名稱不同
export type Role = 'member' | 'citizen' | 'dietitian' | 'admin';

export interface AdminUser {
  id: number;
  username: string;
  status: 'pending' | 'active';
  role: Role;
  // 是否已開放 AI 功能（由管理者逐一開關）
  aiEnabled: boolean;
  lastSeenAt: number | null;
  createdAt: string;
}

export interface MemberInfo {
  id: number;
  username: string;
  nickname: string;
  // 這位營養師替該會員取的私人暱稱（僅本人可見；未設定為 null）
  alias: string | null;
  // 這位營養師是否追蹤該會員（追蹤中的會員發新貼文會收到通知）
  followed: boolean;
}

// 通知：營養師留言／照片評分／調整份數（meal 為 entry 目標的餐別，紀錄已刪除時為 null）
// memberId > 0 表示是「會員回覆」通知（接收者為營養師），指向該會員的貼文
export type NotificationType = 'comment' | 'rating' | 'food' | 'post';

export interface NotificationItem {
  id: number;
  type: NotificationType;
  target: string;
  date: string;
  memberId: number;
  memberName: string | null;
  meal: MealKey | null;
  read: boolean;
  createdAt: number;
}

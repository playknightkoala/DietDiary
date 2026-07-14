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
  food: Food;
  // 營養師調整份數的時間戳（Unix ms，0＝未被調整）
  foodEditedAt: number;
}

// 留言對象：某筆飲食（entry:<id>）、某天的喝水（water:<date>）或運動（ex:<date>）
export type CommentTarget = `entry:${number}` | `water:${string}` | `ex:${string}`;

export interface EntryComment {
  id: number;
  body: string;
  createdAt: number; // Unix ms
  author: string;
  role: Role;
  mine: boolean;
}

export type BodyKey = 'weight' | 'fat' | 'waist' | 'muscle' | 'fatkg';

export interface DayData {
  water: number;
  waterTime: string; // 最後一次喝水紀錄時間 HH:MM，空字串＝未填
  ex: { min: string; desc: string };
  exTime: string;
  body: Record<BodyKey, string>;
  bodyTime: string;
  entries: Entry[];
  // 喝水／運動貼文的留言數
  commentCounts: { water: number; ex: number };
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
  createdAt: string;
}

export interface MemberInfo {
  id: number;
  username: string;
}

// 通知：營養師留言／照片評分／調整份數（meal 為 entry 目標的餐別，紀錄已刪除時為 null）
// memberId > 0 表示是「會員回覆」通知（接收者為營養師），指向該會員的貼文
export type NotificationType = 'comment' | 'rating' | 'food';

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

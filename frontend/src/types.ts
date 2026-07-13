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
  food: Food;
}

export type BodyKey = 'weight' | 'fat' | 'waist' | 'muscle' | 'fatkg';

export interface DayData {
  water: number;
  ex: { min: string; desc: string };
  body: Record<BodyKey, string>;
  entries: Entry[];
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

export type Role = 'member' | 'dietitian' | 'admin';

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

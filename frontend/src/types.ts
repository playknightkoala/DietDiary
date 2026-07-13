export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'night' | 'snack';

export type FoodKey =
  | 'meatLow' | 'meatMed' | 'meatHigh' | 'meatXHigh'
  | 'veg' | 'grain' | 'oil' | 'fruit'
  | 'milkSkim' | 'milkLow' | 'milkFull';

export type Food = Record<FoodKey, number>;

export interface Entry {
  id: number;
  meal: MealKey;
  desc: string;
  photo: string;
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

export interface Goals {
  start: string;
  end: string;
  vals: Record<GoalKey, number>;
  water: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

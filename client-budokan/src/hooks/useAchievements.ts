// Stub — Achievements Starknet (migration Solana)
export interface AchievementStatus {
  id: string;
  category: string;
  tier: number;
  icon: string;
  description: string;
  progress: number;
  target: number;
  xp: number;
  completed: boolean;
  claimed: boolean;
}

export const ACHIEVEMENT_CATEGORIES: string[] = [];

export const useAchievements = (_playerAddress?: string) => {
  return { achievements: [] as AchievementStatus[], isLoading: false };
};

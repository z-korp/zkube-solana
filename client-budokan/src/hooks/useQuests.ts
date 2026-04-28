// Stub — Quests Starknet (migration Solana)
export interface QuestStatus {
  id: string;
  type: string;
  intervalId: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  active: boolean;
}

export const useQuests = () => {
  return { quests: [] as QuestStatus[], isLoading: false };
};

export function groupQuests(quests: QuestStatus[]) {
  return {
    daily:    quests.filter((q) => q.type === "daily"),
    weekly:   quests.filter((q) => q.type === "weekly"),
    finisher: quests.filter((q) => q.type === "finisher"),
  };
}

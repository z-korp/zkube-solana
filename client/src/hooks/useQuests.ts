import { useMemo } from "react";

import { useProgress } from "@/contexts/progress";
import {
  getQuestIntervalId,
  QUEST_DEFS,
  type QuestDef,
  type QuestType,
} from "@/config/questDefs";
import type { QuestProgressView } from "@/chain/progressClient";

export interface QuestStatus extends QuestDef {
  index: number;
  blockSize: number | null;
  intervalId: number;
  progress: number;
  completed: boolean;
  active: boolean;
}

export function projectQuests(
  entries: readonly QuestProgressView[] | null,
  now = Math.floor(Date.now() / 1_000),
): QuestStatus[] {
  return QUEST_DEFS.map((definition, index) => {
    const value = entries?.[index];
    const blockSize = value?.blockSize ?? null;
    const target = value?.threshold ?? definition.target;
    return {
      ...definition,
      index,
      description: definition.description,
      target,
      blockSize,
      xpReward: value?.xpReward ?? definition.xpReward,
      intervalId: getQuestIntervalId(definition, now),
      progress: value?.progress ?? 0,
      completed: value?.completed ?? false,
      active: value?.active ?? false,
    };
  });
}

export const useQuests = () => {
  const controller = useProgress();
  const quests = useMemo<QuestStatus[]>(
    () =>
      projectQuests(
        controller.progress?.quests ?? null,
        Math.floor(Date.now() / 1_000),
      ),
    [controller.progress?.quests],
  );
  return {
    quests,
    isLoading: controller.loading,
    error: controller.error,
  };
};

export const groupQuests = (
  quests: QuestStatus[],
): Record<QuestType, QuestStatus[]> => ({
  daily: quests.filter((quest) => quest.type === "daily"),
  weekly: quests.filter((quest) => quest.type === "weekly"),
  finisher: quests.filter((quest) => quest.type === "finisher"),
});

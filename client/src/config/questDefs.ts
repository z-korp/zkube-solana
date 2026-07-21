const DAY_SECONDS = 86_400;
const WEEK_SECONDS = 604_800;
const MONDAY_OFFSET = 345_600;

const feltFromShortString = (value: string): bigint => {
  let result = 0n;
  for (let index = 0; index < value.length; index += 1) {
    result = (result << 8n) | BigInt(value.charCodeAt(index));
  }
  return result;
};

export type QuestType = "daily" | "weekly" | "finisher";

export interface QuestDef {
  id: bigint;
  shortId: string;
  name: string;
  description: string;
  target: number;
  xpReward: number;
  type: QuestType;
  icon: string;
  taskId: bigint;
  start: number;
  duration: number;
  interval: number;
}

function quest(
  shortId: string,
  name: string,
  description: string,
  target: number,
  xpReward: number,
  type: QuestType,
  icon: string,
): QuestDef {
  const weekly = type === "weekly";
  return {
    id: feltFromShortString(shortId),
    shortId,
    name,
    description,
    target,
    xpReward,
    type,
    icon,
    taskId: feltFromShortString(shortId.replace("QUEST_", "TASK_")),
    start: weekly ? MONDAY_OFFSET : 0,
    duration: weekly ? WEEK_SECONDS : DAY_SECONDS,
    interval: weekly ? WEEK_SECONDS : DAY_SECONDS,
  };
}

/** Exact display order for the program's 20 fixed quest-counter slots. */
export const QUEST_DEFS: QuestDef[] = [
  quest("QUEST_ARCADE_RUN", "Get Moving", "Finish an Arena or Practice run", 1, 100, "daily", "🎮"),
  quest("QUEST_DAILY_LINES", "Line Sweeper", "Clear 40 lines in Arena or Practice", 40, 100, "daily", "📏"),
  quest("QUEST_DAILY_BONUS", "Bonus User", "Use 3 bonuses in Arena or Practice", 3, 100, "daily", "🪄"),
  quest("QUEST_PRESSURE_FOUR", "Under Pressure", "Reach pressure tier 4", 1, 100, "daily", "🌡️"),
  quest("QUEST_DAILY_ENTRY", "Daily Player", "Enter today's ranked Daily", 1, 100, "daily", "🗓️"),
  quest("QUEST_RESERVED_D5", "Reserved", "Not selected", 1, 100, "daily", "·"),
  quest("QUEST_COMBO_THREE", "Combo Builder", "Hit a 3+ combo", 1, 100, "daily", "🔥"),
  quest("QUEST_BEAT_YDAY", "Beat Yesterday", "Beat your score from yesterday's Arena", 1, 100, "daily", "⏪"),
  quest("QUEST_DAILY_FINISHER", "Daily Finisher", "Complete all 3 active Daily quests", 3, 350, "finisher", "✅"),
  quest("QUEST_WEEKLY_DAYS", "Weekly Regular", "Play Arena or Practice on 5 different days", 5, 500, "weekly", "📆"),
  quest("QUEST_WEEKLY_LINES", "Weekly Sweeper", "Clear 300 lines in Arena or Practice", 300, 500, "weekly", "🏁"),
  quest("QUEST_RESERVED_W11", "Reserved", "Not selected", 3, 500, "weekly", "·"),
  quest("QUEST_WEEKLY_BONUS", "Bonus Specialist", "Use 25 bonuses this week", 25, 500, "weekly", "✨"),
  quest("QUEST_WEEKLY_RUNS", "Arcade Grinder", "Finish 15 Arena or Practice runs", 15, 500, "weekly", "🕹️"),
  quest("QUEST_FINISHERS", "Quest Streak", "Complete 3 Daily Finishers", 3, 500, "weekly", "🎯"),
  quest("QUEST_BIG_ACTION", "Single-turn Power", "Make one 4-line clear or five 3-line clears", 1, 500, "weekly", "⚡"),
  quest("QUEST_PRESSURE_SIX", "Deep Pressure", "Reach pressure tier 6", 6, 500, "weekly", "🌋"),
  quest("QUEST_RESERVED_W17", "Reserved", "Not selected", 2, 500, "weekly", "·"),
  quest("QUEST_PRACTICE_TOP", "Yesterday's Top 25", "Place in yesterday's hypothetical top 25 twice", 2, 500, "weekly", "🔭"),
  quest("QUEST_PERFECT_CLEAR", "Clean Slate", "Make 2 perfect clears", 2, 500, "weekly", "💎"),
];

export const getQuestIntervalId = (
  definition: QuestDef,
  nowSeconds: number,
): number => {
  if (nowSeconds < definition.start || definition.interval <= 0) return 0;
  return Math.floor((nowSeconds - definition.start) / definition.interval);
};

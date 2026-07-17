const DAY_SECONDS = 86_400;
const WEEK_SECONDS = 604_800;
const MONDAY_OFFSET = 345_600; // epoch day 0 = Thursday, +4 days = Monday

const feltFromShortString = (value: string): bigint => {
  let result = 0n;
  for (let i = 0; i < value.length; i++) {
    result = (result << 8n) | BigInt(value.charCodeAt(i));
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
  starReward: number;
  type: QuestType;
  icon: string;
  taskId: bigint;
  start: number;
  duration: number;
  interval: number;
}

export const QUEST_DEFS: QuestDef[] = [
  // Nine Daily quests are mixed into a deterministic three-quest selection.
  {
    id: feltFromShortString("QUEST_LINE_SWEEPER"),
    shortId: "QUEST_LINE_SWEEPER",
    name: "Line Sweeper",
    description: "Clear 20 lines",
    target: 20,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "📏",
    taskId: feltFromShortString("LINE_CLEAR"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_BONUS_USER"),
    shortId: "QUEST_BONUS_USER",
    name: "Bonus User",
    description: "Use 3 bonuses",
    target: 3,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "🪄",
    taskId: feltFromShortString("BONUS_USED"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_METER_MASTER"),
    shortId: "QUEST_METER_MASTER",
    name: "Meter Master",
    description: "Reach 10 on the Combo Meter",
    target: 1,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "💥",
    taskId: feltFromShortString("HIGH_COMBO"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_COMBO_METER"),
    shortId: "QUEST_COMBO_METER",
    name: "Combo Meter",
    description: "Add 3+ to the Combo Meter twice",
    target: 2,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "🔥",
    taskId: feltFromShortString("COMBO_3"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_DAILY_PLAYER"),
    shortId: "QUEST_DAILY_PLAYER",
    name: "Daily Player",
    description: "Play a daily challenge",
    target: 1,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "🗓️",
    taskId: feltFromShortString("DAILY_PLAY"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_LEVEL_CLEAR"),
    shortId: "QUEST_LEVEL_CLEAR",
    name: "Level Runner",
    description: "Complete or replay 2 campaign levels",
    target: 2,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "🏁",
    taskId: feltFromShortString("LEVEL_CLEAR"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_BIG_COMBO"),
    shortId: "QUEST_BIG_COMBO",
    name: "Big Combo",
    description: "Hit a 4+ combo",
    target: 1,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "⚡",
    taskId: feltFromShortString("COMBO_4"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_BLOCK_BREAKER"),
    shortId: "QUEST_BLOCK_BREAKER",
    name: "Block Breaker",
    description: "Destroy today's target blocks",
    target: 10,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "🧱",
    taskId: feltFromShortString("BLOCK_BREAK"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_COMBO_CHAIN"),
    shortId: "QUEST_COMBO_CHAIN",
    name: "Combo Chain",
    description: "Hit 2+ combo 5 times",
    target: 5,
    xpReward: 100,
    starReward: 0,
    type: "daily",
    icon: "🔗",
    taskId: feltFromShortString("COMBO_2"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  // ── Daily meta (start=0, duration=DAY, interval=DAY) ──
  {
    id: feltFromShortString("QUEST_DAILY_FINISHER"),
    shortId: "QUEST_DAILY_FINISHER",
    name: "Daily Finisher",
    description: "Complete 3 daily quests",
    target: 3,
    xpReward: 200,
    starReward: 2,
    type: "finisher",
    icon: "✅",
    taskId: feltFromShortString("DAILY_QUEST_DONE"),
    start: 0,
    duration: DAY_SECONDS,
    interval: DAY_SECONDS,
  },
  // ── Weekly (start=MONDAY_OFFSET, duration=WEEK, interval=WEEK) ──
  {
    id: feltFromShortString("QUEST_WEEKLY_GRINDER"),
    shortId: "QUEST_WEEKLY_GRINDER",
    name: "Weekly Grinder",
    description: "Clear 150 lines this week",
    target: 150,
    xpReward: 500,
    starReward: 5,
    type: "weekly",
    icon: "🏁",
    taskId: feltFromShortString("LINE_CLEAR"),
    start: MONDAY_OFFSET,
    duration: WEEK_SECONDS,
    interval: WEEK_SECONDS,
  },
  {
    id: feltFromShortString("QUEST_WEEKLY_EXPLORER"),
    shortId: "QUEST_WEEKLY_EXPLORER",
    name: "Weekly Explorer",
    description: "Play daily challenge 3 times",
    target: 3,
    xpReward: 500,
    starReward: 5,
    type: "weekly",
    icon: "🏆",
    taskId: feltFromShortString("DAILY_PLAY"),
    start: MONDAY_OFFSET,
    duration: WEEK_SECONDS,
    interval: WEEK_SECONDS,
  },
];

export const getQuestIntervalId = (
  quest: QuestDef,
  nowSeconds: number,
): number => {
  if (nowSeconds < quest.start || quest.interval <= 0) return 0;
  return Math.floor((nowSeconds - quest.start) / quest.interval);
};

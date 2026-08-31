import { appStorage, type StorageLike } from "@/platform/storage";

const LOCAL_STATE_KEY = "zkube:local-product:v1";
const LOCAL_STATE_VERSION = 1;

export interface LocalDailyAttemptState {
  readonly dayId: number;
  readonly realm: number;
  readonly objectiveKind: number;
  readonly objectiveValue: number;
  readonly dailyScore: number;
  readonly objectiveTotal: string;
  readonly finished: boolean;
}

export interface LocalProductState {
  readonly version: typeof LOCAL_STATE_VERSION;
  readonly name: string | null;
  readonly stars: number[];
  readonly dailyAttempt: LocalDailyAttemptState | null;
  readonly streak: number;
  readonly lastAttemptDayId: number | null;
  readonly bestDailyScore: number;
  readonly wornEmblem: number;
  readonly campaignOwned: boolean;
  readonly campaignPrice: string | null;
}

export function emptyLocalProductState(): LocalProductState {
  return {
    version: LOCAL_STATE_VERSION,
    name: null,
    stars: Array<number>(100).fill(0),
    dailyAttempt: null,
    streak: 0,
    lastAttemptDayId: null,
    bestDailyScore: 0,
    wornEmblem: 0,
    campaignOwned: false,
    campaignPrice: null,
  };
}

export function localProductStorage(
  storage: StorageLike | null | undefined = appStorage(),
) {
  let state = decodeLocalProductState(
    storage?.getItem(LOCAL_STATE_KEY) ?? null,
  );
  return {
    read: () => state,
    write: (update: (current: LocalProductState) => LocalProductState) => {
      state = decodeLocalProductState(JSON.stringify(update(state)));
      storage?.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
      return state;
    },
  };
}

export function decodeLocalProductState(
  value: string | null,
): LocalProductState {
  if (value === null) return emptyLocalProductState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return emptyLocalProductState();
  }
  if (!isRecord(parsed) || parsed.version !== LOCAL_STATE_VERSION) {
    return emptyLocalProductState();
  }
  const stars = Array.isArray(parsed.stars)
    ? parsed.stars.map(normalizeStars).slice(0, 100)
    : [];
  while (stars.length < 100) stars.push(0);
  return {
    version: LOCAL_STATE_VERSION,
    name: normalizeName(parsed.name),
    stars,
    dailyAttempt: decodeAttempt(parsed.dailyAttempt),
    streak: normalizeNonnegativeInteger(parsed.streak),
    lastAttemptDayId:
      parsed.lastAttemptDayId === null
        ? null
        : normalizeDayId(parsed.lastAttemptDayId),
    bestDailyScore: normalizeNonnegativeInteger(parsed.bestDailyScore),
    wornEmblem: Math.min(10, normalizeNonnegativeInteger(parsed.wornEmblem)),
    campaignOwned: parsed.campaignOwned === true,
    campaignPrice:
      typeof parsed.campaignPrice === "string" && parsed.campaignPrice.trim()
        ? parsed.campaignPrice.trim().slice(0, 40)
        : null,
  };
}

export function normalizeLocalName(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().slice(0, 24) : "";
  if (!normalized) throw new Error("Enter a name");
  return normalized;
}

function decodeAttempt(value: unknown): LocalDailyAttemptState | null {
  if (!isRecord(value)) return null;
  const objectiveTotal =
    typeof value.objectiveTotal === "string" &&
    /^\d+$/.test(value.objectiveTotal)
      ? value.objectiveTotal
      : "0";
  return {
    dayId: normalizeDayId(value.dayId),
    realm: Math.min(10, Math.max(1, normalizeNonnegativeInteger(value.realm))),
    objectiveKind: normalizeNonnegativeInteger(value.objectiveKind),
    objectiveValue: normalizeNonnegativeInteger(value.objectiveValue),
    dailyScore: normalizeNonnegativeInteger(value.dailyScore),
    objectiveTotal,
    finished: value.finished === true,
  };
}

function normalizeName(value: unknown): string | null {
  try {
    return normalizeLocalName(value);
  } catch {
    return null;
  }
}

function normalizeStars(value: unknown): number {
  return Math.min(3, normalizeNonnegativeInteger(value));
}

function normalizeDayId(value: unknown): number {
  return Math.min(0xffff_ffff, normalizeNonnegativeInteger(value));
}

function normalizeNonnegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

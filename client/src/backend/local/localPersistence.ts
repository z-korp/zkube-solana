import { appStorage, type StorageLike } from "@/platform/storage";

const LOCAL_STATE_KEY = "zkube:local-product:v1";
const LOCAL_STATE_VERSION = 1;

export interface LocalCampaignAction {
  kind: "Move" | "Bonus" | "Reroll" | "Finish";
  row: number;
  start: number;
  destination: number;
  reason: number;
}

export interface LocalCampaignRun {
  id: string;
  catalogVersion: number;
  realm: number;
  level: number;
  seed: number[];
  actions: LocalCampaignAction[];
}

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
  readonly campaignRun?: LocalCampaignRun;
  readonly campaignWritePending?: true;
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
  owner?: string,
) {
  if (owner !== undefined && !owner.trim()) throw new Error("A connected owner address is required");
  const key = owner === undefined ? LOCAL_STATE_KEY : `${LOCAL_STATE_KEY}:${owner}`;
  let state = decodeLocalProductState(
    storage?.getItem(key) ?? null,
  );
  return {
    read: () => state,
    write: (update: (current: LocalProductState) => LocalProductState) => {
      state = decodeLocalProductState(JSON.stringify(update(state)));
      storage?.setItem(key, JSON.stringify(state));
      return state;
    },
    writeCampaign: async (update: (current: LocalProductState) => LocalProductState) => {
      if (!storage) throw new Error("Campaign storage is unavailable");
      const next = decodeLocalProductState(JSON.stringify(update(state)));
      const encoded = JSON.stringify(next);
      if (storage.setItemDurable) await storage.setItemDurable(key, encoded);
      else storage.setItem(key, encoded);
      state = next;
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
    ...(parsed.campaignRun == null ? {} : { campaignRun: decodeCampaignRun(parsed.campaignRun) }),
    ...(parsed.campaignWritePending === true ? { campaignWritePending: true as const } : {}),
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

function decodeCampaignRun(value: unknown): LocalCampaignRun {
  const byte = (item: unknown): item is number => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255;
  if (!isRecord(value) || typeof value.id !== "string" || !/^[1-9][0-9]*$/.test(value.id) ||
      BigInt(value.id) > 0xffff_ffff_ffff_ffffn || !Number.isInteger(value.catalogVersion) ||
      !Number.isInteger(value.realm) || Number(value.realm) < 1 || Number(value.realm) > 10 ||
      !Number.isInteger(value.level) || Number(value.level) < 1 || Number(value.level) > 10 ||
      !Array.isArray(value.seed) || value.seed.length !== 32 || !value.seed.every(byte) ||
      !Array.isArray(value.actions) || value.actions.length > 65535 || !value.actions.every(action =>
        isRecord(action) && ["Move", "Bonus", "Reroll", "Finish"].includes(String(action.kind)) &&
        [action.row, action.start, action.destination, action.reason].every(byte))) {
    throw new Error("Saved Campaign run is malformed");
  }
  return { id: value.id, catalogVersion: Number(value.catalogVersion), realm: Number(value.realm), level: Number(value.level),
    seed: [...value.seed], actions: value.actions.map(action => ({ kind: action.kind, row: action.row,
      start: action.start, destination: action.destination, reason: action.reason })) };
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

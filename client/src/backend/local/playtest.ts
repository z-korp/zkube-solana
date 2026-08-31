import { currentDailyDayId } from "@/core/dailyRules";
import { DAILY_THEMES } from "@/core/dailyRules.generated";
import { appStorage } from "@/platform/storage";
import type { DailyContent } from "../views";

export const PLAYTEST_BUILD_SENTINEL = "zkube_owner_playtest_v1";
export const PLAYTEST_ACTIVE = import.meta.env.VITE_ZKUBE_PLAYTEST === "1";

const SETTINGS_KEY = "zkube:playtest:settings:v1";
const NAME_KEY = "zkube:playtest:name:v1";
const CHANGE_EVENT = "zkube:playtest-settings";
const DEFAULT_SEED_HEX = "5a".repeat(32);

export interface PlaytestSettings {
  readonly seedHex: string;
  readonly realm: number;
  readonly objectiveIndex: number;
}

const DEFAULT_SETTINGS: PlaytestSettings = {
  seedHex: DEFAULT_SEED_HEX,
  realm: 1,
  objectiveIndex: 0,
};

let snapshot = loadSettings();

export function playtestSettings(): PlaytestSettings {
  return snapshot;
}

export function updatePlaytestSettings(
  update: Partial<PlaytestSettings>,
): PlaytestSettings {
  const next = validateSettings({ ...snapshot, ...update });
  snapshot = next;
  try {
    appStorage()?.setItem(SETTINGS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // The in-memory owner build remains playable when storage is denied.
  }
  return next;
}

export function subscribePlaytestSettings(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function randomizePlaytestSeed(): PlaytestSettings {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return updatePlaytestSettings({ seedHex: encodeHex(seed) });
}

export function playtestSeed(): Uint8Array {
  return decodeSeed(snapshot.seedHex);
}

export function playtestToday(
  nowUnix = Math.floor(Date.now() / 1_000),
): DailyContent {
  const objective = DAILY_THEMES[snapshot.objectiveIndex] ?? DAILY_THEMES[0];
  const dayId = currentDailyDayId(nowUnix);
  return {
    dayId,
    realm: snapshot.realm,
    objective: { kind: objective.kind, value: objective.value },
    startingHeight: 0,
    opensAt: dayId * 86_400,
    freezesAt: (dayId + 1) * 86_400,
    suspended: false,
  };
}

export function readPlaytestName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const name = appStorage()?.getItem(NAME_KEY)?.trim() ?? "";
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export function storePlaytestName(name: string): string {
  const normalized = name.trim().slice(0, 24);
  if (!normalized) throw new Error("Enter a name");
  try {
    appStorage()?.setItem(NAME_KEY, normalized);
  } catch {
    // A storage-denied preview keeps the name for this mounted runtime.
  }
  return normalized;
}

function loadSettings(): PlaytestSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(
      appStorage()?.getItem(SETTINGS_KEY) ?? "null",
    ) as Partial<PlaytestSettings> | null;
    return validateSettings({ ...DEFAULT_SETTINGS, ...stored });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function validateSettings(settings: PlaytestSettings): PlaytestSettings {
  if (!/^[0-9a-f]{64}$/i.test(settings.seedHex)) {
    throw new Error("Row seed must be exactly 64 hexadecimal characters");
  }
  if (
    !Number.isInteger(settings.realm) ||
    settings.realm < 1 ||
    settings.realm > 10
  ) {
    throw new Error("Playtest realm must be between 1 and 10");
  }
  if (
    !Number.isInteger(settings.objectiveIndex) ||
    settings.objectiveIndex < 0 ||
    settings.objectiveIndex >= DAILY_THEMES.length
  ) {
    throw new Error("Playtest objective is outside the authored set");
  }
  return {
    seedHex: settings.seedHex.toLowerCase(),
    realm: settings.realm,
    objectiveIndex: settings.objectiveIndex,
  };
}

function decodeSeed(value: string): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

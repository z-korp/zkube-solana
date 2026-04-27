// Stub — useZoneProgress (migration Solana)
import { ZONE_EMOJIS, ZONE_NAMES, type ZoneProgressData } from "@/config/profileData";

void ZONE_EMOJIS;
void ZONE_NAMES;

export type { ZoneProgressData };

export const useZoneProgress = (
  _playerAddress: string | undefined,
  _zStarBalance: number,
): { zones: ZoneProgressData[]; totalStars: number; isLoading: boolean } => {
  return { zones: [], totalStars: 0, isLoading: false };
};

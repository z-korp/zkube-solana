import type { ComponentProps } from "react";

import PlaytestNameGate from "@/backend/local/PlaytestNameGate";
import {
  PageSurface as SolanaPageSurface,
  SettingsSurface as SolanaSettingsSurface,
} from "@/ui/pageSets/solana";

export function PageSurface(
  props: ComponentProps<typeof SolanaPageSurface>,
) {
  return <SolanaPageSurface {...props} />;
}

export function SettingsSurface() {
  return <SolanaSettingsSurface />;
}

export function DisconnectedSurface() {
  return <PlaytestNameGate />;
}

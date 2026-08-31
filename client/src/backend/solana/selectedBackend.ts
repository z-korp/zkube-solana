import type { BackendLayer } from "@/backend/runtime";
import {
  makeSolanaBackendLive,
  SOLANA_BACKEND_SENTINEL,
} from "./SolanaBackendLive";

export const SELECTED_BACKEND_SENTINEL = SOLANA_BACKEND_SENTINEL;
export const SELECTED_BUILD_SENTINEL: string | undefined = undefined;

export function makeSelectedBackend(): BackendLayer {
  return makeSolanaBackendLive();
}

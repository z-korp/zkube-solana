import { useMemo } from "react";

import { useConnectedPlayer } from "@/backend/client";

/** The exact connected Solana address; the application gate keeps this present. */
export default function useAccount(): { address: string } {
  const { publicKey } = useConnectedPlayer();
  return useMemo(() => ({ address: publicKey ?? "" }), [publicKey]);
}

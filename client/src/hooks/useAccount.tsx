import { useMemo } from "react";

import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";

/** The embedded identity as the app's account: always connected, no wallet. */
export default function useAccount(): { address: string } {
  const { publicKey } = useEmbeddedIdentity();
  return useMemo(() => ({ address: publicKey.toBase58() }), [publicKey]);
}

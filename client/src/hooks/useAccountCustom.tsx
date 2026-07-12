import { useMemo } from "react";

import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";

export interface EmbeddedAccountView {
  address: string;
}

const useAccountCustom = (): { account: EmbeddedAccountView } => {
  const { publicKey } = useEmbeddedIdentity();
  return useMemo(
    () => ({ account: { address: publicKey.toBase58() } }),
    [publicKey],
  );
};

export default useAccountCustom;

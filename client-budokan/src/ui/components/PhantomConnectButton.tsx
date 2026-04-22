import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";

/**
 * Bouton de connexion Phantom — même style que Connect (ArcadeButton)
 * mais en violet pour Solana
 */
export default function PhantomConnectButton() {
  const { connected, publicKey, select, connect, disconnect } = useWallet();

  const handleConnect = async () => {
    select("Phantom" as WalletName<"Phantom">);
    await connect();
  };

  if (connected && publicKey) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-purple-500/30 bg-purple-900/20 px-3 py-2.5">
        <div>
          <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-purple-400/70">
            Solana (Phantom)
          </p>
          <p className="font-sans text-sm font-semibold text-purple-200">
            {publicKey.toBase58().slice(0, 8)}...{publicKey.toBase58().slice(-6)}
          </p>
        </div>
        <button
          onClick={() => disconnect()}
          className="inline-flex items-center gap-1 rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-1.5 font-sans text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <ArcadeButton onClick={handleConnect} accentOverride="#9333ea">
      CONNECT PHANTOM
    </ArcadeButton>
  );
}

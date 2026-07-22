import React, { useState } from "react";
import { ChevronRight, Gamepad2 } from "lucide-react";
import { errorMessage, isWalletRejection } from "@/utils/errors";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Sheet from "@/ui/components/shared/Sheet";

interface ConnectCtaProps {
  /** Disconnected-state label; mirrors the original client's Connect. */
  label?: string;
  pendingLabel?: string;
}

/**
 * The one onboarding button, used by Home ("PLAY NOW") and Settings
 * ("CONNECT ACCOUNT"). One tap connects directly when a single compatible
 * wallet is installed, otherwise opens the wallet picker sheet; once a wallet
 * is connected the same tap enables (or renews) the device session, always
 * under the one label. Renders nothing when the player is fully ready.
 */
const ConnectCta: React.FC<ConnectCtaProps> = ({
  label = "CONNECT ACCOUNT",
  pendingLabel = "CONNECTING...",
}) => {
  const player = useConnectedPlayer();
  const [busyLocal, setBusyLocal] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const connected =
    player.connectionStatus === "connected" && player.publicKey !== null;
  const ready = connected && player.sessionStatus === "ready";
  const busy = busyLocal || player.connectionStatus === "connecting";
  const supportedConnectors = player.connectors.filter(
    (connector) => connector.supportsV0Signing,
  );

  if (ready) return null;

  const onboard = async (connectorId: string) => {
    setBusyLocal(true);
    setLocalError(null);
    try {
      await player.connectAndEnable(connectorId);
    } catch (cause) {
      setLocalError(userFacingError(cause));
    } finally {
      setBusyLocal(false);
    }
  };

  const handleTap = () => {
    if (connected) {
      const connectorId = player.connector?.id;
      if (connectorId) void onboard(connectorId);
      return;
    }
    if (player.connectors.length === 1 && supportedConnectors.length === 1) {
      void onboard(supportedConnectors[0].id);
      return;
    }
    setPickerOpen(true);
  };

  if (player.connectors.length === 0) {
    return (
      <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-center font-sans text-xs leading-5 text-amber-100">
        No compatible wallet was found. On Seeker, install and open Seed Vault
        Wallet. On desktop, install a Wallet Standard wallet such as Phantom.
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {localError && (
        <p
          role="alert"
          className="rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-center font-sans text-xs leading-5 text-red-100"
        >
          {localError}
        </p>
      )}
      <ArcadeButton disabled={busy} onClick={handleTap}>
        <Gamepad2 size={22} strokeWidth={2.5} />
        {busy ? (connected ? "Connecting…" : pendingLabel) : label}
      </ArcadeButton>
      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Choose a wallet"
      >
        <div className="flex flex-col gap-2 pb-2">
          {player.connectors.map((connector) => (
            <button
              key={connector.id}
              type="button"
              disabled={busy || !connector.supportsV0Signing}
              onClick={() => {
                setPickerOpen(false);
                void onboard(connector.id);
              }}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.12] bg-white/[0.06] px-4 py-3 text-left backdrop-blur-xl transition-colors hover:bg-white/[0.1] disabled:opacity-45"
            >
              {connector.icon ? (
                <img src={connector.icon} alt="" className="h-8 w-8 rounded-lg" />
              ) : (
                <Gamepad2 size={24} className="text-white/70" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-sm font-extrabold text-white">
                  {connector.name}
                </span>
                {!connector.supportsV0Signing && (
                  <span className="block font-sans text-[11px] font-semibold text-amber-200/80">
                    Versioned transactions unsupported
                  </span>
                )}
              </span>
              <ChevronRight size={16} className="text-white/40" />
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
};

function userFacingError(cause: unknown): string {
  if (isWalletRejection(cause)) {
    return "The wallet rejected the request. You can try again when ready.";
  }
  const message = errorMessage(cause);
  // Before initialization the protocol's config/session accounts don't exist
  // yet; surface that as a calm status rather than a raw RPC error.
  if (/does not exist or has no data|account does not exist/i.test(message)) {
    return "zKube isn't live";
  }
  return message;
}

export default ConnectCta;

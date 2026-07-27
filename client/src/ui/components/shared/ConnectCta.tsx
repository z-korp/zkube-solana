import React, { useMemo, useState, useSyncExternalStore } from "react";
import { ChevronRight, Download, Gamepad2 } from "lucide-react";
import {
  classifyWalletError,
  type WalletErrorClassification,
} from "@/utils/errors";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import {
  currentPlatformCapabilities,
  type PlatformKind,
} from "@/platform/capabilities";
import {
  installPromptAvailable,
  promptInstall,
  subscribeInstallPrompt,
} from "@/platform/installPrompt";
import {
  getWalletAvailabilityState,
  subscribeWalletAvailability,
} from "@/platform/walletStandard";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Sheet from "@/ui/components/shared/Sheet";
import WalletRecoveryPanel from "@/ui/components/shared/WalletRecoveryPanel";

interface ConnectCtaProps {
  /** Disconnected-state label; mirrors the original client's Connect. */
  label?: string;
  pendingLabel?: string;
}

const SEEKER_WALLET_HINT =
  "Seeker includes Seed Vault Wallet, and other installed compatible wallets may be used. Phantom and Solflare are optional.";

interface LocalWalletError {
  classification: WalletErrorClassification;
  connectorId: string;
}

/**
 * The one onboarding button, used by Home ("PLAY NOW") and Settings
 * ("CONNECT ACCOUNT"). One tap connects directly when a single compatible
 * wallet is installed, otherwise opens the wallet picker sheet; once a wallet
 * is connected the same tap enables (or renews) the device session, always
 * under the one label. Renders nothing when the player is fully ready.
 *
 * Guidance adapts to the classified platform: Android surfaces lead with
 * "Use Installed Wallet" (the Mobile Wallet Adapter connector), iOS and
 * unidentified browsers get honest no-wallet copy instead of a dead mobile
 * option, and an Android browser holding a captured `beforeinstallprompt`
 * offers PWA installation. Desktop discovery and the picker are unchanged.
 */
const ConnectCta: React.FC<ConnectCtaProps> = ({
  label = "CONNECT ACCOUNT",
  pendingLabel = "CONNECTING...",
}) => {
  const player = useConnectedPlayer();
  const [busyLocal, setBusyLocal] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localError, setLocalError] = useState<LocalWalletError | null>(null);
  const platform = useMemo(() => currentPlatformCapabilities().kind, []);
  const walletAvailability = useSyncExternalStore(
    subscribeWalletAvailability,
    getWalletAvailabilityState,
  );
  const installReady = useSyncExternalStore(
    subscribeInstallPrompt,
    installPromptAvailable,
  );

  const mobilePlatform =
    platform === "android-browser" ||
    platform === "android-pwa" ||
    platform === "twa";
  const connected =
    player.connectionStatus === "connected" && player.publicKey !== null;
  const ready = connected && player.sessionStatus === "ready";
  const busy = busyLocal || player.connectionStatus === "connecting";
  const supportedConnectors = player.connectors.filter(
    (connector) => connector.supportsV0Signing,
  );
  const mwaAvailable = player.connectors.some(
    (connector) => connector.kind === "mobile-wallet-adapter",
  );
  const availabilityError =
    walletAvailability.status === "unavailable"
      ? walletAvailability.error
      : null;
  const providerRecoveryError = player.error
    ? classifyWalletError(player.error)
    : null;
  const recoveryError =
    localError?.classification ??
    (connected && player.sessionStatus === "expired"
      ? classifyWalletError(
          player.error ??
            "The zKube device session expired. Renew it before continuing.",
        )
      : null) ??
    (!connected && providerRecoveryError?.kind === "account-mismatch"
      ? providerRecoveryError
      : null) ??
    (!connected && availabilityError
      ? classifyWalletError(availabilityError)
      : null);
  const retryConnectorId =
    localError?.connectorId ??
    (connected ? player.connector?.id : undefined) ??
    player.connectors.find(
      (connector) => connector.kind === "mobile-wallet-adapter",
    )?.id ??
    (supportedConnectors.length === 1 ? supportedConnectors[0]?.id : undefined);

  if (ready) return null;

  const onboard = async (connectorId: string) => {
    setBusyLocal(true);
    setLocalError(null);
    try {
      await player.connectAndEnable(connectorId);
    } catch (cause) {
      setLocalError({
        classification: classifyWalletError(cause),
        connectorId,
      });
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

  const handleRecoveryRetry = () => {
    setLocalError(null);
    const connector = player.connectors.find(
      (candidate) =>
        candidate.id === retryConnectorId && candidate.supportsV0Signing,
    );
    if (connector) {
      void onboard(connector.id);
      return;
    }
    setPickerOpen(true);
  };

  if (player.connectors.length === 0) {
    return (
      <p
        role="status"
        className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-center font-sans text-xs leading-5 text-amber-100"
      >
        {noWalletGuidance(platform)}
      </p>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {recoveryError && (
        <WalletRecoveryPanel
          error={recoveryError}
          platform={platform}
          busy={busy}
          onRetry={handleRecoveryRetry}
        />
      )}
      <ArcadeButton disabled={busy} onClick={handleTap}>
        <Gamepad2 size={22} strokeWidth={2.5} />
        {busy
          ? connected
            ? "Connecting…"
            : pendingLabel
          : !connected && mwaAvailable
            ? "Use Installed Wallet"
            : label}
      </ArcadeButton>
      {!connected && mobilePlatform && !recoveryError && (
        <p className="px-2 text-center font-sans text-[11px] leading-4 text-white/60">
          {SEEKER_WALLET_HINT}
        </p>
      )}
      {!connected && platform === "android-browser" && installReady && (
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="mx-auto inline-flex items-center gap-1 font-sans text-xs font-bold text-white/55 transition-colors hover:text-white/80"
        >
          <Download size={13} />
          Install zKube as an app
        </button>
      )}
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
                <img
                  src={connector.icon}
                  alt=""
                  className="h-8 w-8 rounded-lg"
                />
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
          {mobilePlatform && (
            <p className="pt-1 text-center font-sans text-[11px] leading-4 text-white/55">
              {SEEKER_WALLET_HINT}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
};

/**
 * Zero-connector copy per platform. Only Android Chrome, the installed PWA,
 * and desktop Wallet Standard are claimed surfaces; iOS, other Android
 * browsers, and unidentified runtimes get honest untested-surface guidance
 * instead of a compatibility claim.
 */
function noWalletGuidance(kind: PlatformKind): string {
  switch (kind) {
    case "desktop":
      return "No wallet extension was found. Install a Wallet Standard wallet such as Phantom or Solflare, then reload this page.";
    case "android-browser":
      return `No compatible wallet was found. ${SEEKER_WALLET_HINT} If connecting keeps failing in this browser, Android Chrome is the supported Android browser; desktop also works.`;
    case "android-pwa":
    case "twa":
      return `No compatible wallet was found. ${SEEKER_WALLET_HINT} Install or open one, then try again.`;
    case "ios":
      return "No wallet is available in this browser, and iOS isn't a supported zKube surface yet. Use Android Chrome or a desktop browser.";
    case "unknown":
      return "No compatible wallet was found, and this browser isn't a verified zKube surface. Use Android Chrome or a desktop browser with a Wallet Standard wallet such as Phantom or Solflare.";
  }
}

export default ConnectCta;

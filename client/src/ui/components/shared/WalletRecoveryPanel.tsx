import React, { useId } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import type { PlatformKind } from "@/platform/capabilities";
import type { WalletErrorClassification } from "@/utils/errors";

interface WalletRecoveryPanelProps {
  error: WalletErrorClassification;
  platform: PlatformKind;
  busy: boolean;
  onRetry: () => void;
}

interface RecoveryContent {
  title: string;
  cause: string;
  steps: readonly string[];
}

const WalletRecoveryPanel: React.FC<WalletRecoveryPanelProps> = ({
  error,
  platform,
  busy,
  onRetry,
}) => {
  const titleId = useId();
  const content = recoveryContent(error, platform);

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className="rounded-xl border border-amber-300/45 bg-[#150d02]/95 px-3 py-3 font-sans text-amber-50 shadow-[0_12px_34px_rgba(0,0,0,0.6)] backdrop-blur-md"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden="true"
          size={17}
          className="mt-0.5 shrink-0 text-amber-300"
        />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-extrabold text-amber-100">
            {content.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-amber-50/95">
            {content.cause}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-5 text-amber-50/90">
            {content.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            aria-label="Try wallet connection again"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-200/45 bg-amber-100/15 px-3 py-2 text-xs font-extrabold text-amber-50 transition-colors hover:bg-amber-100/25 disabled:opacity-45"
          >
            <RotateCcw aria-hidden="true" size={13} />
            {busy ? "Trying…" : "Try again"}
          </button>
          {/*
           * The dev capability panel is stripped from production builds, so a
           * failed physical-device connect would otherwise leave no trace of
           * which wallet error actually fired. Keep the underlying message and
           * pinned error code reachable here — collapsed, so normal players
           * never see it — as Gate G1 evidence.
           */}
          <details className="mt-2 text-[11px] leading-4 text-amber-100/70">
            <summary className="cursor-pointer font-bold text-amber-100/80">
              Details
            </summary>
            <p className="mt-1 break-words font-mono text-[10px] leading-4 text-amber-50/70">
              {error.kind}
              {error.sourceCode === undefined ? "" : ` · ${error.sourceCode}`}
              {" · "}
              {platform}
            </p>
            <p className="mt-1 break-words font-mono text-[10px] leading-4 text-amber-50/70">
              {error.message}
            </p>
          </details>
        </div>
      </div>
    </section>
  );
};

function recoveryContent(
  error: WalletErrorClassification,
  platform: PlatformKind,
): RecoveryContent {
  switch (error.kind) {
    case "local-network-access":
      return localNetworkRecovery(platform);
    case "association-failure":
      return {
        title: "Wallet handoff did not finish",
        cause:
          "The connection between Chrome and the wallet closed or timed out.",
        steps: [
          "Make sure an MWA-compatible wallet is installed, open, and unlocked.",
          "Return to Chrome and retry.",
        ],
      };
    case "wallet-not-found":
      return {
        title: "No compatible wallet answered",
        cause:
          "Seed Vault Wallet is built into Seeker. Other installed compatible wallets may also be used; Phantom and Solflare are optional.",
        steps: [
          "Open and unlock a compatible wallet.",
          "Return to zKube and retry.",
        ],
      };
    case "unsupported-sign-only-v0":
      return {
        title: "This wallet is not compatible",
        cause:
          "zKube requires sign-only versioned transaction support and cannot replace it with sign-and-send.",
        steps: [
          "Choose an installed wallet that supports sign-only v0 transactions.",
          "Return to zKube and retry with that wallet.",
        ],
      };
    case "account-mismatch":
      return {
        title: "Wallet account changed",
        cause:
          "The account returned by the wallet did not match the account zKube was connecting.",
        steps: [
          "Open the wallet and select the address you intend to use.",
          "Return to zKube and retry.",
        ],
      };
    case "session-expired":
      return {
        title: "Device session expired",
        cause:
          "Your wallet is still your identity, but this device needs a fresh zKube session approval.",
        steps: ["Unlock your wallet, then retry to renew the device session."],
      };
    case "insufficient-funds":
      return {
        title: "This wallet needs Devnet SOL",
        cause:
          "Your wallet is connected, but the address cannot cover the account rent, device fee allowance, and network fee that enabling a zKube device session pays.",
        steps: [
          "Fund the connected address with Devnet SOL at faucet.solana.com.",
          "Return to zKube and retry.",
        ],
      };
    case "user-rejection":
      return {
        title: "Request declined",
        cause: "Nothing was connected or approved.",
        steps: ["Retry when you are ready, then approve the wallet request."],
      };
    case "unknown":
      return unknownRecovery(error.message, platform);
  }
}

function localNetworkRecovery(platform: PlatformKind): RecoveryContent {
  const common = {
    title: "Allow local network access",
    cause:
      "This Android surface reported that the private local connection used to reach your wallet was denied.",
  } as const;
  if (platform === "twa") {
    return {
      ...common,
      steps: [
        "Open zKube's Android app or site permissions and allow Local network access if it is listed.",
        "If that permission is unavailable, open the same trusted HTTPS URL in Android Chrome and retry there.",
      ],
    };
  }
  if (platform === "android-pwa") {
    return {
      ...common,
      steps: [
        "Open the installed app's site settings in Chrome → Permissions → Local network access.",
        "Allow access for this site, return to zKube, then retry.",
      ],
    };
  }
  return {
    ...common,
    steps: [
      "In Android Chrome, open Site settings → Permissions → Local network access.",
      "Allow access for this site, return to zKube, then retry.",
    ],
  };
}

function unknownRecovery(
  message: string,
  platform: PlatformKind,
): RecoveryContent {
  if (/does not exist or has no data|account does not exist/i.test(message)) {
    return {
      title: "zKube isn't live",
      cause: "The required Devnet configuration is not available.",
      steps: ["Wait and retry later."],
    };
  }
  if (platform === "desktop") {
    return {
      title: "Wallet connection did not finish",
      cause: "The browser extension did not complete the request.",
      steps: [
        "Unlock your Wallet Standard extension, then retry.",
        "If it remains unavailable, try Phantom or Solflare on desktop.",
      ],
    };
  }
  if (platform === "ios") {
    return {
      title: "Connection unavailable",
      cause: "iOS is not a supported zKube surface yet.",
      steps: ["Use Android Chrome or a desktop Wallet Standard extension."],
    };
  }
  return {
    title: "Wallet connection did not finish",
    cause: "The browser and wallet did not complete the request.",
    steps: [
      "Open and unlock a compatible wallet.",
      "Return to Android Chrome and retry, or use a desktop browser.",
    ],
  };
}

export default WalletRecoveryPanel;

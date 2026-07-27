import { useEffect, useState } from "react";

import {
  currentPlatformCapabilities,
  type PlatformCapabilities,
} from "@/platform/capabilities";
import {
  describeWalletCapabilities,
  type WalletCapabilityDiagnostic,
} from "@/platform/walletDiagnostics";
import { walletRegistry } from "@/platform/walletStandard";

interface CapabilitySnapshot {
  platform: PlatformCapabilities;
  wallets: WalletCapabilityDiagnostic[];
}

export function CapabilityDiagnostics() {
  const [snapshot, setSnapshot] = useState(readCapabilitySnapshot);

  useEffect(() => {
    const registry = walletRegistry();
    const refresh = () => setSnapshot(readCapabilitySnapshot());
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    refresh();
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  return (
    <details className="fixed bottom-3 right-3 z-[100] max-h-[min(75vh,620px)] w-[min(calc(100vw-1.5rem),420px)] overflow-y-auto rounded-xl border border-cyan-300/25 bg-[#07101c]/95 text-white shadow-2xl backdrop-blur-xl">
      <summary className="cursor-pointer select-none px-3 py-2 font-sans text-xs font-bold uppercase tracking-[0.08em] text-cyan-100">
        Capability diagnostics
      </summary>
      <div className="space-y-3 border-t border-white/10 px-3 py-3 font-sans text-xs">
        <section aria-label="Platform capabilities">
          <h2 className="mb-1.5 font-bold text-white">Environment</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-white/70">
            <dt>Platform</dt>
            <dd className="text-right font-mono text-white">
              {snapshot.platform.kind}
            </dd>
            <dt>Standalone display</dt>
            <dd className="text-right font-mono text-white">
              {yesNo(snapshot.platform.displayModeStandalone)}
            </dd>
            <dt>Conservative TWA signal</dt>
            <dd className="text-right font-mono text-white">
              {yesNo(snapshot.platform.twaSignal)}
            </dd>
            <dt>MWA supported</dt>
            <dd className="text-right font-mono text-white">
              {yesNo(snapshot.platform.mobileWalletAdapterSupported)}
            </dd>
          </dl>
        </section>

        <section aria-label="Discovered Wallet Standard metadata">
          <h2 className="mb-1.5 font-bold text-white">
            Discovered wallets ({snapshot.wallets.length})
          </h2>
          {snapshot.wallets.length === 0 ? (
            <p className="text-white/55">No Wallet Standard wallets found.</p>
          ) : (
            <div className="space-y-2">
              {snapshot.wallets.map((wallet, index) => (
                <article
                  key={`${wallet.name}:${index}`}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5"
                >
                  <h3 className="font-bold text-cyan-100">{wallet.name}</h3>
                  <DiagnosticValue label="Chains" values={wallet.chains} />
                  <DiagnosticValue
                    label="Features"
                    values={wallet.featureKeys}
                  />
                  <DiagnosticFeature
                    label="Sign transaction"
                    present={wallet.signTransaction.present}
                    versions={
                      wallet.signTransaction.supportedTransactionVersions
                    }
                  />
                  <DiagnosticFeature
                    label="Sign and send"
                    present={wallet.signAndSendTransaction.present}
                    versions={
                      wallet.signAndSendTransaction.supportedTransactionVersions
                    }
                  />
                </article>
              ))}
            </div>
          )}
        </section>

        <p className="border-t border-white/10 pt-2 text-[10px] leading-4 text-white/45">
          Public capability metadata only. This panel never connects, signs, or
          sends.
        </p>
      </div>
    </details>
  );
}

function DiagnosticValue({
  label,
  values,
}: {
  label: string;
  values: readonly string[];
}) {
  return (
    <div className="mt-1">
      <span className="text-white/50">{label}: </span>
      <span className="break-words font-mono text-[10px] leading-4 text-white/80">
        {values.length > 0 ? values.join(", ") : "none"}
      </span>
    </div>
  );
}

function DiagnosticFeature({
  label,
  present,
  versions,
}: {
  label: string;
  present: boolean;
  versions: readonly string[];
}) {
  return (
    <div className="mt-1 text-white/70">
      <span>{label}: </span>
      <span className="font-mono text-[10px] text-white/90">
        {yesNo(present)}
        {present && versions.length > 0 ? ` (${versions.join(", ")})` : ""}
      </span>
    </div>
  );
}

function readCapabilitySnapshot(): CapabilitySnapshot {
  return {
    platform: currentPlatformCapabilities(),
    wallets: walletRegistry().get().map(describeWalletCapabilities),
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

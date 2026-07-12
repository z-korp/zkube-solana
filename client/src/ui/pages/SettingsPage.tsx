import React, { useMemo, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { motion } from "motion/react";
import { Check, ChevronLeft, Copy, Palette, ShieldCheck } from "lucide-react";

import {
  THEME_IDS,
  THEME_META,
  getThemeColors,
  type ThemeId,
} from "@/config/themes";
import { useCampaignController } from "@/contexts/campaign";
import { useMusicPlayer } from "@/contexts/hooks";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useNavigationStore } from "@/stores/navigationStore";
import AccountBadge from "@/ui/components/AccountBadge";
import PageHeader from "@/ui/components/shared/PageHeader";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import ImageAssets from "@/ui/theme/ImageAssets";
import { truncatePublicKey } from "@/utils/solanaDisplay";

const toPercent = (value: number): number => Math.round(value * 100);

const SettingsPage: React.FC = () => {
  const identity = useEmbeddedIdentity();
  const { campaign } = useCampaignController();
  const { themeTemplate, setThemeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const goBack = useNavigationStore((state) => state.goBack);
  const { musicVolume, effectsVolume, setMusicVolume, setEffectsVolume } =
    useMusicPlayer();
  const [copied, setCopied] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [restoreCode, setRestoreCode] = useState("");
  const [solDestination, setSolDestination] = useState("");
  const [solAmount, setSolAmount] = useState("");
  const [usdcDestination, setUsdcDestination] = useState("");
  const [usdcAmount, setUsdcAmount] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultStatus, setVaultStatus] = useState("");
  const address = identity.publicKey.toBase58();

  const unlockedThemes = useMemo(() => {
    const unlocked = new Set<ThemeId>(["theme-1"]);
    for (const map of campaign?.maps ?? []) {
      if (map.unlocked) unlocked.add(`theme-${map.mapId}` as ThemeId);
    }
    return THEME_IDS.filter((theme) => unlocked.has(theme));
  }, [campaign?.maps]);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setVaultStatus("Deposit address copied.");
      window.setTimeout(() => setCopied(false), 1_400);
    } catch (cause) {
      setCopied(false);
      setVaultStatus(errorMessage(cause));
    }
  };

  const handleWithdrawSol = async () => {
    const amount = Number(solAmount);
    if (!solDestination.trim() || !Number.isFinite(amount) || amount <= 0) {
      setVaultStatus("Enter a valid destination and SOL amount.");
      return;
    }
    if (
      !window.confirm(
        `Send ${amount} SOL from your zKube Vault to ${solDestination.trim()}?`,
      )
    ) {
      return;
    }

    setVaultBusy(true);
    try {
      const signature = await identity.withdrawSol(
        solDestination.trim(),
        Math.floor(amount * LAMPORTS_PER_SOL),
      );
      setSolAmount("");
      setVaultStatus(
        `SOL withdrawal confirmed: ${truncatePublicKey(signature)}`,
      );
    } catch (cause) {
      setVaultStatus(errorMessage(cause));
    } finally {
      setVaultBusy(false);
    }
  };

  const handleWithdrawUsdc = async () => {
    let amount: bigint;
    try {
      amount = parseUsdc(usdcAmount);
    } catch (cause) {
      setVaultStatus(errorMessage(cause));
      return;
    }
    if (!usdcDestination.trim()) {
      setVaultStatus("Enter a destination for the USDC withdrawal.");
      return;
    }
    if (
      !window.confirm(
        `Send ${formatUsdc(amount)} USDC from your zKube Vault to ${usdcDestination.trim()}?`,
      )
    ) {
      return;
    }

    setVaultBusy(true);
    try {
      const signature = await identity.withdrawUsdc(
        usdcDestination.trim(),
        amount,
      );
      setUsdcAmount("");
      setVaultStatus(
        `USDC withdrawal confirmed: ${truncatePublicKey(signature)}`,
      );
    } catch (cause) {
      setVaultStatus(errorMessage(cause));
    } finally {
      setVaultBusy(false);
    }
  };

  const handleRestore = () => {
    if (!restoreCode.trim()) {
      setVaultStatus("Paste a Recovery Code first.");
      return;
    }
    if (
      !window.confirm(
        "Replace this device's zKube identity with the supplied Recovery Code?",
      )
    ) {
      return;
    }

    try {
      const restored = identity.restore(restoreCode);
      setRestoreCode("");
      setVaultStatus(
        `Identity restored: ${truncatePublicKey(restored.toBase58())}`,
      );
    } catch (cause) {
      setVaultStatus(errorMessage(cause));
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <PageHeader
        title="Settings"
        leftSlot={
          <button
            onClick={goBack}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-lg backdrop-blur-md transition-all hover:bg-white/[0.08] active:scale-95"
            aria-label="Go Back"
          >
            <ChevronLeft size={20} className="text-white/80" />
          </button>
        }
      />

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-xl"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="text-lg">🎵</span>
              <h2
                className="font-display text-lg tracking-wide"
                style={{ color: colors.text }}
              >
                AUDIO
              </h2>
            </div>

            <div className="flex flex-col gap-3">
              <AudioSlider
                icon="🎵"
                value={musicVolume}
                color={colors.accent}
                label="Music volume"
                delay={0.1}
                onChange={setMusicVolume}
              />
              <AudioSlider
                icon="🔔"
                value={effectsVolume}
                color={colors.accent2}
                label="Effects volume"
                delay={0.15}
                onChange={setEffectsVolume}
              />
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.04 }}
            className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-xl"
          >
            <div className="mb-3 flex items-center gap-2">
              <Palette size={18} style={{ color: colors.accent }} />
              <h2
                className="font-display text-lg tracking-wide"
                style={{ color: colors.text }}
              >
                THEME
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              {unlockedThemes.map((themeId, index) => {
                const themeAssets = ImageAssets(themeId);
                const isSelected = themeTemplate === themeId;

                return (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      delay: 0.1 + index * 0.03,
                      type: "spring",
                      stiffness: 300,
                      damping: 24,
                    }}
                    key={themeId}
                    type="button"
                    whileTap={{ scale: 0.93 }}
                    onClick={() => setThemeTemplate(themeId)}
                    title={THEME_META[themeId].name}
                    className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border transition-colors ${
                      isSelected
                        ? "bg-white/10"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]"
                    }`}
                    style={{
                      borderColor: isSelected ? colors.accent : undefined,
                    }}
                  >
                    <img
                      src={themeAssets.themeIcon}
                      alt={THEME_META[themeId].name}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    {isSelected && (
                      <Check
                        size={14}
                        className="absolute bottom-1 right-1 drop-shadow-md"
                        style={{ color: colors.accent }}
                      />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.08 }}
            className="rounded-2xl border border-white/[0.12] bg-white/[0.08] p-4 backdrop-blur-xl"
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-sans text-base font-bold text-white">
                <ShieldCheck size={17} style={{ color: colors.accent }} />
                zKube Vault
              </h2>
              <AccountBadge />
            </div>
            <p className="mb-3 font-sans text-xs text-white/50">
              Your embedded Solana identity, deposits, recovery, and
              withdrawals.
            </p>

            <div className="space-y-3">
              <div className="rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2.5">
                <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-white/55">
                  Deposit address
                </p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="min-w-0 break-all font-mono text-xs font-semibold text-white/90">
                    {address}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyAddress()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.15] bg-white/[0.08] px-2.5 py-1.5 font-sans text-xs font-semibold text-white/80"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <VaultMetric
                  label="SOL balance"
                  value={
                    identity.balanceLamports === null
                      ? "—"
                      : (identity.balanceLamports / LAMPORTS_PER_SOL).toFixed(6)
                  }
                />
                <VaultMetric
                  label="USDC balance"
                  value={
                    identity.usdcBaseUnits === null
                      ? "—"
                      : formatUsdc(identity.usdcBaseUnits)
                  }
                />
              </div>

              <p className="font-sans text-xs leading-5 text-white/55">
                Copy this address to deposit from any Solana wallet or exchange.
                Gameplay fees are sponsored, so free play does not require SOL.
              </p>

              <div className="grid gap-2 sm:grid-cols-2">
                <VaultButton
                  onClick={() => void identity.refreshBalance()}
                  disabled={identity.balanceLoading}
                >
                  {identity.balanceLoading ? "Refreshing…" : "Refresh balances"}
                </VaultButton>
                <VaultButton
                  onClick={() => setShowRecovery((visible) => !visible)}
                >
                  {showRecovery ? "Hide Recovery Code" : "Export Recovery Code"}
                </VaultButton>
              </div>

              {showRecovery && (
                <div className="rounded-xl border border-amber-300/20 bg-amber-950/30 p-3">
                  <p className="mb-2 font-sans text-xs leading-5 text-amber-100/75">
                    This code controls your zKube identity and career. Store it
                    offline and never share it with support.
                  </p>
                  <code className="block break-all text-xs text-amber-100">
                    {identity.recoveryCode()}
                  </code>
                </div>
              )}

              <VaultForm title="Withdraw SOL">
                <input
                  value={solDestination}
                  onChange={(event) => setSolDestination(event.target.value)}
                  placeholder="Destination address"
                  aria-label="SOL destination address"
                  className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1 sm:col-span-2"
                />
                <input
                  value={solAmount}
                  onChange={(event) => setSolAmount(event.target.value)}
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="SOL"
                  aria-label="SOL amount"
                  className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1"
                />
                <VaultButton
                  onClick={() => void handleWithdrawSol()}
                  disabled={vaultBusy}
                >
                  {vaultBusy ? "Sending…" : "Withdraw SOL"}
                </VaultButton>
              </VaultForm>

              <VaultForm
                title="Withdraw USDC"
                description="The destination is a Solana owner address. Creating its token account requires a small SOL balance in the Vault."
              >
                <input
                  value={usdcDestination}
                  onChange={(event) => setUsdcDestination(event.target.value)}
                  placeholder="Destination owner address"
                  aria-label="USDC destination owner address"
                  className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1 sm:col-span-2"
                />
                <input
                  value={usdcAmount}
                  onChange={(event) => setUsdcAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="USDC"
                  aria-label="USDC amount"
                  className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1"
                />
                <VaultButton
                  onClick={() => void handleWithdrawUsdc()}
                  disabled={vaultBusy}
                >
                  {vaultBusy ? "Sending…" : "Withdraw USDC"}
                </VaultButton>
              </VaultForm>

              <details className="rounded-xl border border-white/[0.1] bg-white/[0.04] p-3">
                <summary className="cursor-pointer font-sans text-sm font-bold text-white/90">
                  Restore on this device
                </summary>
                <p className="my-2 font-sans text-xs text-white/50">
                  Restoring switches the app to the career controlled by that
                  Recovery Code.
                </p>
                <textarea
                  value={restoreCode}
                  onChange={(event) => setRestoreCode(event.target.value)}
                  placeholder="Paste all 32 Recovery Code groups"
                  aria-label="Recovery Code"
                  className="min-h-24 w-full rounded-xl bg-black/35 p-3 font-mono text-xs text-white outline-none ring-cyan-400 focus:ring-1"
                />
                <div className="mt-2">
                  <VaultButton onClick={handleRestore} disabled={vaultBusy}>
                    Restore identity
                  </VaultButton>
                </div>
              </details>

              {vaultStatus && (
                <p
                  role="status"
                  className="break-words text-center font-sans text-xs text-cyan-200"
                >
                  {vaultStatus}
                </p>
              )}
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
};

function AudioSlider({
  icon,
  value,
  color,
  label,
  delay,
  onChange,
}: {
  icon: string;
  value: number;
  color: string;
  label: string;
  delay: number;
  onChange: (value: number) => void;
}) {
  return (
    <motion.label
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 24 }}
      className="flex items-center gap-3"
    >
      <span className="shrink-0 text-base">{icon}</span>
      <span className="sr-only">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={toPercent(value)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-white/10"
        style={{ accentColor: color }}
      />
      <span
        className="w-8 text-right font-display text-lg tracking-wider"
        style={{ color }}
      >
        {toPercent(value)}
      </span>
    </motion.label>
  );
}

function VaultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2.5 text-center">
      <p className="font-display text-xl text-cyan-200">{value}</p>
      <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-white/55">
        {label}
      </p>
    </div>
  );
}

function VaultButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2.5 font-sans text-xs font-bold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function VaultForm({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.1] bg-white/[0.04] p-3">
      <h3 className="font-sans text-sm font-bold text-white/90">{title}</h3>
      {description && (
        <p className="mt-1 font-sans text-xs leading-5 text-white/45">
          {description}
        </p>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseUsdc(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(normalized)) {
    throw new Error("Enter a positive USDC amount with at most 6 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const baseUnits =
    BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (baseUnits <= 0n) throw new Error("USDC withdrawal must be positive.");
  return baseUnits;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default SettingsPage;

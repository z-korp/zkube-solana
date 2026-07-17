import React, { useEffect, useMemo, useRef, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { motion } from "motion/react";
import {
  Check,
  ChevronLeft,
  Copy,
  ExternalLink,
  Palette,
  UserRound,
} from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import {
  THEME_IDS,
  THEME_META,
  getThemeColors,
  type ThemeId,
} from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import { useMusicPlayer } from "@/contexts/hooks";
import { useNavigationStore } from "@/stores/navigationStore";
import ConnectCta from "@/ui/components/shared/ConnectCta";
import PageHeader from "@/ui/components/shared/PageHeader";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import ImageAssets from "@/ui/theme/ImageAssets";

const toPercent = (value: number): number => Math.round(value * 100);

const SettingsPage: React.FC = () => {
  const player = useConnectedPlayer();
  const { campaign } = useCampaign();
  const { themeTemplate, setThemeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const goBack = useNavigationStore((state) => state.goBack);
  const settingsFocus = useNavigationStore((state) => state.settingsFocus);
  const clearSettingsFocus = useNavigationStore(
    (state) => state.clearSettingsFocus,
  );
  const { musicVolume, effectsVolume, setMusicVolume, setEffectsVolume } =
    useMusicPlayer();
  const [copied, setCopied] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletStatus, setWalletStatus] = useState("");
  const walletRef = useRef<HTMLElement>(null);
  const address = player.publicKey?.toBase58() ?? "";

  useEffect(() => {
    if (settingsFocus !== "wallet") return;
    const frame = window.requestAnimationFrame(() => {
      walletRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      clearSettingsFocus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clearSettingsFocus, settingsFocus]);

  const unlockedThemes = useMemo(() => {
    const unlocked = new Set<ThemeId>(["theme-1"]);
    for (const map of campaign?.maps ?? []) {
      if (map.unlocked) unlocked.add(`theme-${map.mapId}` as ThemeId);
    }
    return THEME_IDS.filter((theme) => unlocked.has(theme));
  }, [campaign?.maps]);

  const runWalletAction = async (
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setWalletBusy(true);
    setWalletStatus("");
    try {
      await action();
      setWalletStatus(success);
    } catch (cause) {
      setWalletStatus(errorMessage(cause));
    } finally {
      setWalletBusy(false);
    }
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setWalletStatus("Wallet address copied.");
      window.setTimeout(() => setCopied(false), 1_400);
    } catch (cause) {
      setWalletStatus(errorMessage(cause));
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
              <h2 className="font-display text-lg tracking-wide" style={{ color: colors.text }}>
                AUDIO
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              <AudioSlider icon="🎵" value={musicVolume} color={colors.accent} label="Music volume" delay={0.1} onChange={setMusicVolume} />
              <AudioSlider icon="🔔" value={effectsVolume} color={colors.accent2} label="Effects volume" delay={0.15} onChange={setEffectsVolume} />
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
              <h2 className="font-display text-lg tracking-wide" style={{ color: colors.text }}>
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
                    transition={{ delay: 0.1 + index * 0.03, type: "spring", stiffness: 300, damping: 24 }}
                    key={themeId}
                    type="button"
                    whileTap={{ scale: 0.93 }}
                    onClick={() => setThemeTemplate(themeId)}
                    title={THEME_META[themeId].name}
                    className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border transition-colors ${isSelected ? "bg-white/10" : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]"}`}
                    style={{ borderColor: isSelected ? colors.accent : undefined }}
                  >
                    <img src={themeAssets.themeIcon} alt={THEME_META[themeId].name} className="h-full w-full object-cover" draggable={false} />
                    {isSelected && <Check size={14} className="absolute bottom-1 right-1 drop-shadow-md" style={{ color: colors.accent }} />}
                  </motion.button>
                );
              })}
            </div>
          </motion.section>

          <motion.section
            ref={walletRef}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.08 }}
            className="rounded-2xl border border-white/[0.12] bg-white/[0.08] p-4 backdrop-blur-xl"
          >
            <h3 className="mb-3 flex items-center gap-2 font-sans text-base font-bold text-white">
              <UserRound size={16} style={{ color: colors.accent }} />
              Account
            </h3>

            {player.publicKey ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/[0.1] bg-white/[0.05] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.1em] text-white/55">
                        {player.connector?.name ?? "Wallet Address"}
                      </p>
                      <p className="mt-1 break-all font-mono text-xs font-semibold text-white/90">{address}</p>
                    </div>
                    <button type="button" onClick={() => void handleCopyAddress()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.15] bg-white/[0.08] px-2.5 py-1.5 font-sans text-xs font-semibold text-white/80">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <WalletMetric label="Network" value="Devnet" />
                  <WalletMetric label="SOL" value={player.balanceLamports === null ? "—" : (player.balanceLamports / LAMPORTS_PER_SOL).toFixed(4)} />
                  <WalletMetric label="Session" value={sessionLabel(player.sessionStatus, player.session?.validUntil)} />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <WalletButton disabled={walletBusy || player.balanceLoading} onClick={() => void runWalletAction(player.refreshBalance, "Balances refreshed.")}>
                    {player.balanceLoading ? "Refreshing…" : "Refresh balances"}
                  </WalletButton>
                  <WalletButton disabled={walletBusy} onClick={() => void runWalletAction(player.sessionStatus === "missing" ? player.enable : player.renew, "zKube device session enabled.")}>
                    {player.sessionStatus === "missing" || player.sessionStatus === "checking" ? "Enable zKube" : "Renew session"}
                  </WalletButton>
                  <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2.5 font-sans text-xs font-bold text-cyan-100 transition-colors hover:bg-cyan-500/20 sm:col-span-2">
                    Devnet funding guidance <ExternalLink size={13} />
                  </a>
                </div>

                <button
                  type="button"
                  disabled={walletBusy}
                  onClick={() => void runWalletAction(player.disconnect, "Wallet disconnected.")}
                  className="w-full rounded-xl border border-red-400/35 bg-red-500/15 py-2.5 font-sans text-sm font-bold text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-40"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <ConnectCta />
            )}

            {(walletStatus || player.error) && (
              <p role="status" className="mt-3 break-words text-center font-sans text-xs text-cyan-200">
                {walletStatus || player.error}
              </p>
            )}
          </motion.section>
        </div>
      </div>
    </div>
  );
};

function AudioSlider({ icon, value, color, label, delay, onChange }: { icon: string; value: number; color: string; label: string; delay: number; onChange: (value: number) => void }) {
  return (
    <motion.label initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, type: "spring", stiffness: 300, damping: 24 }} className="flex items-center gap-3">
      <span className="shrink-0 text-base">{icon}</span>
      <span className="sr-only">{label}</span>
      <input type="range" min={0} max={100} step={1} value={toPercent(value)} onChange={(event) => onChange(Number(event.target.value) / 100)} className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-white/10" style={{ accentColor: color }} />
      <span className="w-8 text-right font-display text-lg tracking-wider" style={{ color }}>{toPercent(value)}</span>
    </motion.label>
  );
}

function WalletMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.1] bg-white/[0.05] px-2 py-2.5 text-center">
      <p className="truncate font-display text-base text-cyan-200" title={value}>{value}</p>
      <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.08em] text-white/55">{label}</p>
    </div>
  );
}

function WalletButton({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-3 py-2.5 font-sans text-xs font-bold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:opacity-40">
      {children}
    </button>
  );
}

function sessionLabel(status: string, validUntil?: number): string {
  if (status === "ready" && validUntil) {
    return new Date(validUntil * 1_000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (status === "checking") return "Checking";
  if (status === "expired") return "Expired";
  if (status === "needsRenewal") return "Renew required";
  return "Not enabled";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default SettingsPage;

import { useMemo, useState } from "react";
import { Check, Palette, Volume2 } from "lucide-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";
import { useRebootDaily } from "@/solana/reboot/useRebootDaily";
import { useRebootTreasury } from "@/solana/reboot/useRebootTreasury";
import RebootProgressPanel from "@/ui/components/reboot/RebootProgressPanel";
import { SOLANA_ENDPOINT, ZKUBE_PROGRAM_ID } from "@/solana/constants";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { useMusicPlayer } from "@/contexts/hooks";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import {
  THEME_IDS,
  THEME_META,
  getThemeColors,
  type ThemeId,
} from "@/config/themes";
import ImageAssets from "@/ui/theme/ImageAssets";

export type RebootInfoPageKind = "profile" | "rewards" | "ranks" | "settings";

export default function RebootInfoPage({ page }: { page: RebootInfoPageKind }) {
  if (page === "settings") return <Settings />;
  if (page === "profile") return <Profile />;
  if (page === "rewards") return <Rewards />;
  return <Ranks />;
}

function Profile() {
  const { campaign, loading, error } = useRebootCampaign();
  const unlocked = campaign?.maps.filter((map) => map.unlocked).length ?? 0;
  const cleared = campaign?.maps.filter((map) => map.cleared).length ?? 0;
  const perfected = campaign?.maps.filter((map) => map.perfected).length ?? 0;
  const levelStars =
    campaign?.maps.reduce(
      (total, map) =>
        total + map.levelStars.reduce((sum, value) => sum + value, 0),
      0,
    ) ?? 0;
  return (
    <Page title="Profile">
      {loading && <p className="text-white/50">Loading campaign account…</p>}
      {!loading && !campaign && (
        <p className="text-center text-white/55">
          Start free Map 1 to initialize your player profile.
        </p>
      )}
      {campaign && (
        <>
          <div className="grid w-full grid-cols-2 gap-3">
            <Metric
              label="Spendable Stars"
              value={campaign.starsBalance.toString()}
            />
            <Metric label="Level best Stars" value={levelStars.toString()} />
            <Metric label="Maps unlocked" value={`${unlocked}/10`} />
            <Metric
              label="Cleared · perfect"
              value={`${cleared} · ${perfected}`}
            />
          </div>
          <div className="flex w-full flex-col gap-2">
            {campaign.maps.map((map) => (
              <div
                key={map.mapId}
                className="flex items-center justify-between rounded-xl bg-white/[0.05] px-4 py-3 text-sm"
              >
                <span>Map {map.mapId}</span>
                <span className="text-white/45">
                  {map.unlocked
                    ? `${map.levelStars.reduce((sum, value) => sum + value, 0)}★`
                    : "Locked"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </Page>
  );
}

function Rewards() {
  return (
    <Page title="Rewards">
      <p className="text-center text-sm text-white/55">
        Achievements award non-spendable XP once. Three Daily quests rotate each
        UTC day, their finisher brings the Daily total to 5 Stars, and Weekly
        quests add up to 10 Stars.
      </p>
      <RebootProgressPanel expanded />
    </Page>
  );
}

function Ranks() {
  const { daily, loading, error } = useRebootDaily();
  return (
    <Page title="Daily Top 10">
      {loading && <p className="text-white/50">Loading today’s board…</p>}
      {!loading && !daily && (
        <p className="text-center text-white/55">
          Today’s challenge is not published yet.
        </p>
      )}
      <div className="flex w-full flex-col gap-2">
        {daily?.leaderboard.map((entry, index) => (
          <div
            key={entry.player.toBase58()}
            className="grid grid-cols-[2rem_1fr_auto] rounded-xl bg-white/[0.05] px-4 py-3 text-sm"
          >
            <strong>#{index + 1}</strong>
            <span className="truncate font-mono text-white/45">
              {shortKey(entry.player.toBase58())}
            </span>
            <strong>{entry.score}</strong>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </Page>
  );
}

function Settings() {
  const identity = useEmbeddedIdentity();
  const { treasury, loading, error } = useRebootTreasury();
  const { campaign } = useRebootCampaign();
  const { themeTemplate, setThemeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const {
    musicVolume,
    effectsVolume,
    setMusicVolume,
    setEffectsVolume,
  } = useMusicPlayer();
  const [showRecovery, setShowRecovery] = useState(false);
  const [restoreCode, setRestoreCode] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
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

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setVaultStatus("Deposit address copied.");
  };
  const withdraw = async () => {
    const sol = Number(amount);
    if (!destination || !Number.isFinite(sol) || sol <= 0) {
      setVaultStatus("Enter a valid destination and SOL amount.");
      return;
    }
    if (
      !window.confirm(
        `Send ${sol} SOL from your zKube Vault to ${destination}?`,
      )
    )
      return;
    setVaultBusy(true);
    try {
      const signature = await identity.withdrawSol(
        destination,
        Math.floor(sol * LAMPORTS_PER_SOL),
      );
      setVaultStatus(`Withdrawal confirmed: ${shortKey(signature)}`);
      setAmount("");
    } catch (cause) {
      setVaultStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setVaultBusy(false);
    }
  };
  const restore = () => {
    if (!restoreCode.trim()) return;
    if (
      !window.confirm(
        "Replace this device's zKube identity with the supplied Recovery Code?",
      )
    )
      return;
    try {
      const restored = identity.restore(restoreCode);
      setRestoreCode("");
      setVaultStatus(`Identity restored: ${shortKey(restored.toBase58())}`);
    } catch (cause) {
      setVaultStatus(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const withdrawUsdc = async () => {
    let baseUnits: bigint;
    try {
      baseUnits = parseUsdc(usdcAmount);
    } catch (cause) {
      setVaultStatus(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    if (!usdcDestination) {
      setVaultStatus("Enter a destination for the USDC withdrawal.");
      return;
    }
    if (
      !window.confirm(
        `Send ${formatUsdc(baseUnits)} USDC from your zKube Vault to ${usdcDestination}?`,
      )
    )
      return;
    setVaultBusy(true);
    try {
      const signature = await identity.withdrawUsdc(usdcDestination, baseUnits);
      setVaultStatus(`USDC withdrawal confirmed: ${shortKey(signature)}`);
      setUsdcAmount("");
    } catch (cause) {
      setVaultStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setVaultBusy(false);
    }
  };

  return (
    <Page title="Settings">
      <section className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-xl">
        <h2
          className="mb-4 flex items-center gap-2 text-lg font-black uppercase tracking-wide"
          style={{ color: colors.text }}
        >
          <Volume2 size={18} style={{ color: colors.accent }} /> Audio
        </h2>
        <div className="space-y-4">
          <AudioSlider
            label="Music"
            value={musicVolume}
            color={colors.accent}
            onChange={setMusicVolume}
          />
          <AudioSlider
            label="Effects"
            value={effectsVolume}
            color={colors.accent2}
            onChange={setEffectsVolume}
          />
        </div>
      </section>

      <section className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-xl">
        <h2
          className="mb-4 flex items-center gap-2 text-lg font-black uppercase tracking-wide"
          style={{ color: colors.text }}
        >
          <Palette size={18} style={{ color: colors.accent }} /> Theme
        </h2>
        <div className="flex flex-wrap gap-2">
          {unlockedThemes.map((themeId) => {
            const assets = ImageAssets(themeId);
            const selected = themeTemplate === themeId;
            return (
              <button
                key={themeId}
                type="button"
                onClick={() => setThemeTemplate(themeId)}
                title={THEME_META[themeId].name}
                className="relative h-14 w-14 overflow-hidden rounded-xl border bg-white/[0.03] transition hover:scale-105"
                style={{
                  borderColor: selected ? colors.accent : "rgba(255,255,255,.08)",
                }}
              >
                <img
                  src={assets.themeIcon}
                  alt={THEME_META[themeId].name}
                  className="h-full w-full object-cover"
                />
                {selected && (
                  <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full bg-black/70">
                    <Check size={13} style={{ color: colors.accent }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-white/40">
          Themes unlock with their matching campaign maps.
        </p>
      </section>

      <div className="w-full pt-2 text-left">
        <h2 className="text-2xl font-black">zKube Vault</h2>
        <p className="mt-1 text-xs text-white/45">
          Embedded identity, deposits, recovery, and withdrawals.
        </p>
      </div>
      <Info label="Deposit address" value={address} />
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric
          label="SOL balance"
          value={
            identity.balanceLamports === null
              ? "—"
              : (identity.balanceLamports / LAMPORTS_PER_SOL).toFixed(6)
          }
        />
        <Metric
          label="USDC balance"
          value={
            identity.usdcBaseUnits === null
              ? "—"
              : formatUsdc(identity.usdcBaseUnits)
          }
        />
        <Metric label="Gameplay fees" value="Sponsored" />
      </div>
      <p className="text-center text-xs leading-5 text-white/55">
        zKube created this identity on this device. No wallet extension is
        needed. Copy the address to top it up from any Solana wallet or exchange
        when a paid game needs USDC. Free gameplay can keep a zero SOL balance.
      </p>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
        <VaultButton onClick={() => void copyAddress()}>
          Copy deposit address
        </VaultButton>
        <VaultButton onClick={() => void identity.refreshBalance()}>
          {identity.balanceLoading ? "Refreshing…" : "Refresh balance"}
        </VaultButton>
        <VaultButton onClick={() => setShowRecovery((value) => !value)}>
          {showRecovery ? "Hide Recovery Code" : "Show Recovery Code"}
        </VaultButton>
      </div>
      {showRecovery && (
        <div className="w-full rounded-xl border border-amber-300/20 bg-amber-950/30 p-4">
          <p className="mb-3 text-xs leading-5 text-amber-100/75">
            This code controls the zKube identity and career. Store it offline;
            never share it with support or paste it into another website.
          </p>
          <code className="block break-all text-xs text-amber-100">
            {identity.recoveryCode()}
          </code>
        </div>
      )}
      <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <h2 className="font-black">Withdraw SOL</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
          <input
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Destination address"
            className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1"
          />
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            type="number"
            min="0"
            step="0.001"
            placeholder="SOL"
            className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1"
          />
          <VaultButton onClick={() => void withdraw()} disabled={vaultBusy}>
            {vaultBusy ? "Sending…" : "Withdraw"}
          </VaultButton>
        </div>
      </div>
      <div className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <h2 className="font-black">Withdraw USDC</h2>
        <p className="mt-1 text-xs text-white/45">
          The destination is a Solana owner address. The Vault pays any
          destination-token-account rent and therefore needs a small SOL
          balance.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
          <input
            value={usdcDestination}
            onChange={(event) => setUsdcDestination(event.target.value)}
            placeholder="Destination owner address"
            className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1"
          />
          <input
            value={usdcAmount}
            onChange={(event) => setUsdcAmount(event.target.value)}
            inputMode="decimal"
            placeholder="USDC"
            className="rounded-xl bg-black/35 px-3 py-3 text-xs text-white outline-none ring-cyan-400 focus:ring-1"
          />
          <VaultButton onClick={() => void withdrawUsdc()} disabled={vaultBusy}>
            {vaultBusy ? "Sending…" : "Withdraw"}
          </VaultButton>
        </div>
      </div>
      <details className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <summary className="cursor-pointer font-black">
          Restore on this device
        </summary>
        <p className="my-3 text-xs text-white/50">
          Restoring switches the app to the career controlled by that Recovery
          Code.
        </p>
        <textarea
          value={restoreCode}
          onChange={(event) => setRestoreCode(event.target.value)}
          placeholder="Paste all 32 Recovery Code groups"
          className="min-h-24 w-full rounded-xl bg-black/35 p-3 font-mono text-xs text-white outline-none ring-cyan-400 focus:ring-1"
        />
        <div className="mt-2">
          <VaultButton onClick={restore}>Restore identity</VaultButton>
        </div>
      </details>
      {vaultStatus && (
        <p role="status" className="text-center text-xs text-cyan-200">
          {vaultStatus}
        </p>
      )}
      <Info label="Solana RPC" value={SOLANA_ENDPOINT} />
      <Info label="zKube program" value={ZKUBE_PROGRAM_ID.toBase58()} />
      {loading && (
        <p className="text-xs text-white/45">
          Loading public treasury accounts…
        </p>
      )}
      {treasury && (
        <>
          <div className="grid w-full grid-cols-2 gap-3">
            <Metric
              label="Treasury USDC"
              value={formatUsdc(treasury.vaults.treasury.balance)}
            />
            <Metric
              label="Reward reserve"
              value={formatUsdc(treasury.vaults.reward.balance)}
            />
            <Metric
              label="Paymaster reserve"
              value={formatUsdc(treasury.vaults.paymaster.balance)}
            />
            <Metric
              label="Contest revenue"
              value={formatUsdc(treasury.vaults.payment.balance)}
            />
          </div>
          <Info
            label="Protocol status"
            value={treasury.paused ? "PAUSED" : "Active"}
          />
          <Info
            label="Governance delay · execution window"
            value={`${formatDuration(treasury.governanceDelaySeconds)} · ${formatDuration(treasury.governanceExecutionWindowSeconds)}`}
          />
          <Info
            label="Lifetime rake · map sales"
            value={`${formatUsdc(treasury.ledger.lifetimeRakeReceived)} · ${formatUsdc(treasury.ledger.lifetimeMapSales)} USDC`}
          />
          <Info
            label="Revenue routing"
            value={`${10_000 - treasury.revenueRewardBps} bps treasury · ${treasury.revenueRewardBps} bps rewards`}
          />
          <Info
            label="Forfeitures retained for rewards"
            value={`${formatUsdc(treasury.ledger.lifetimePrizesForfeitedToRewards)} USDC`}
          />
          <Info
            label="Realized yield · strategy principal"
            value={`${formatUsdc(treasury.ledger.realizedYield)} · ${formatUsdc(treasury.ledger.strategyPrincipal)} USDC`}
          />
          <Info
            label="Yield allocated · retained"
            value={`${formatUsdc(treasury.ledger.yieldAllocatedToRewards)} rewards · ${formatUsdc(treasury.ledger.yieldRetainedInTreasury)} treasury USDC`}
          />
          <Info
            label="Strategy deposited · repaid · losses"
            value={`${formatUsdc(treasury.ledger.lifetimeStrategyDeposited)} · ${formatUsdc(treasury.ledger.lifetimeStrategyPrincipalRepaid)} · ${formatUsdc(treasury.ledger.realizedStrategyLosses)} USDC`}
          />
          <Info
            label="Yield strategy status"
            value={
              treasury.yieldPolicy.emergencyExit
                ? "EMERGENCY EXIT"
                : treasury.yieldPolicy.depositsEnabled
                  ? "Deposits enabled"
                  : "Disabled"
            }
          />
          <Info
            label="Yield exposure · liquid reserve"
            value={`${treasury.yieldPolicy.maxExposureBps} bps max · ${treasury.yieldPolicy.minLiquidReserveBps} bps minimum`}
          />
          <Info
            label="Yield slippage · loss limits"
            value={`${treasury.yieldPolicy.maxSlippageBps} bps · ${treasury.yieldPolicy.maxLossBps} bps`}
          />
          <Info
            label="Realized-yield routing"
            value={`${treasury.yieldPolicy.yieldRewardBps} bps rewards · ${10_000 - treasury.yieldPolicy.yieldRewardBps} bps treasury`}
          />
          {treasury.yieldPolicy.configured && (
            <>
              <Info
                label="Yield adapter policy version"
                value={treasury.yieldPolicy.strategyVersion.toString()}
              />
              <Info
                label="Yield adapter"
                value={treasury.yieldPolicy.adapterProgram.toBase58()}
              />
              <Info
                label="Yield market · reserve"
                value={`${treasury.yieldPolicy.market.toBase58()} · ${treasury.yieldPolicy.reserve.toBase58()}`}
              />
            </>
          )}
        </>
      )}
      {error && <p className="text-xs text-red-300">{error}</p>}
      <p className="rounded-xl border border-emerald-300/15 bg-emerald-950/30 p-4 text-xs leading-5 text-emerald-100/70">
        Stars are program points, not a speculative token. Daily contest
        liabilities stay liquid in challenge-owned USDC vaults; treasury yield
        cannot use active prize principal.
      </p>
    </Page>
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
      disabled={disabled}
      onClick={onClick}
      className="rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3 text-xs font-black text-cyan-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function AudioSlider({
  label,
  value,
  color,
  onChange,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-white/70">
      <span className="w-16 font-bold">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-white/10"
        style={{ accentColor: color }}
      />
      <span className="w-10 text-right font-black" style={{ color }}>
        {Math.round(value * 100)}
      </span>
    </label>
  );
}

function Page({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-full bg-[#050812] px-5 pb-28 pt-14 text-white">
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5">
        <h1 className="text-3xl font-black">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
      <strong className="block text-2xl text-cyan-200">{value}</strong>
      <span className="text-[10px] uppercase text-white/40">{label}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-full rounded-xl bg-white/[0.05] p-4">
      <span className="block text-[10px] uppercase text-white/35">{label}</span>
      <span className="mt-1 block break-all font-mono text-xs text-white/70">
        {value}
      </span>
    </div>
  );
}

function shortKey(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
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

function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  return `${seconds}s`;
}

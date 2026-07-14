import { useEffect, useState } from "react";
import {
  ChevronLeft,
  Clock3,
  Loader2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import {
  StarShopQuoteChangedError,
  useShopController,
} from "@/chain/useShopController";
import type { StarPackQuote, StarShopView } from "@/chain/shopClient";
import { getThemeColors } from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import { useDaily } from "@/contexts/daily";
import { useProgress } from "@/contexts/progress";
import { useNavigationStore } from "@/stores/navigationStore";
import PageHeader from "@/ui/components/shared/PageHeader";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { formatUsdcBaseUnits, splitStarPurchase } from "@/utils/currency";

const ShopPage: React.FC = () => {
  const { themeTemplate } = useTheme();
  const colors = getThemeColors(themeTemplate);
  const player = useConnectedPlayer();
  const campaign = useCampaign();
  const progress = useProgress();
  const daily = useDaily();
  const controller = useShopController();
  const refreshShop = controller.refresh;
  const saleState = controller.shop;
  const shopOrigin = useNavigationStore((state) => state.shopOrigin);
  const navigate = useNavigationStore((state) => state.navigate);
  const goBack = useNavigationStore((state) => state.goBack);
  const openWalletSettings = useNavigationStore(
    (state) => state.openWalletSettings,
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!saleState?.saleEnabled) return;
    const now = BigInt(Math.floor(Date.now() / 1_000));
    const boundary = saleState.saleLive
      ? saleState.saleEndsAt
      : now < saleState.saleStartsAt
        ? saleState.saleStartsAt
        : null;
    if (boundary === null) return;
    const milliseconds = Number(
      (boundary - now) * 1_000n + 250n,
    );
    const timer = window.setTimeout(
      () => void refreshShop(),
      Math.min(Math.max(milliseconds, 250), 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [
    refreshShop,
    saleState?.saleEnabled,
    saleState?.saleEndsAt,
    saleState?.saleLive,
    saleState?.saleStartsAt,
  ]);

  const selectedPack =
    selectedIndex === null ? null : controller.shop?.packs[selectedIndex] ?? null;

  const openWallet = () => {
    setSelectedIndex(null);
    openWalletSettings("shop");
  };

  const handlePack = (pack: StarPackQuote) => {
    setStatus(null);
    if (
      !player.publicKey ||
      (player.usdcBaseUnits !== null &&
        player.usdcBaseUnits < pack.currentPrice)
    ) {
      openWallet();
      return;
    }
    setSelectedIndex(pack.index);
  };

  const confirmPurchase = async () => {
    if (!selectedPack) return;
    setStatus(null);
    try {
      const signature = await controller.purchase(selectedPack);
      await Promise.all([
        campaign.refresh(),
        progress.refresh(),
        daily.refresh(),
        player.refreshBalance(),
      ]);
      setSelectedIndex(null);
      setSuccess(
        `${selectedPack.stars.toString()} Stars added · ${shortSignature(signature)}`,
      );
    } catch (cause) {
      setStatus(
        cause instanceof StarShopQuoteChangedError
          ? cause.message
          : errorMessage(cause),
      );
    }
  };

  const returnFromShop = () => {
    navigate(shopOrigin === "daily" ? "daily" : "home");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <PageHeader
        title="Star Shop"
        leftSlot={
          shopOrigin ? (
            <button
              type="button"
              onClick={goBack}
              aria-label="Go back"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-lg backdrop-blur-md transition-all hover:bg-white/[0.08] active:scale-95"
            >
              <ChevronLeft size={20} className="text-white/80" />
            </button>
          ) : null
        }
      />

      <div className="mx-4 mb-4 mt-2 min-h-0 flex-1 overflow-y-auto hide-scrollbar">
        <div className="mx-auto flex max-w-[720px] flex-col gap-4">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-3xl border border-yellow-200/20 bg-gradient-to-br from-yellow-300/[0.14] via-white/[0.06] to-cyan-300/[0.08] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl"
          >
            <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-yellow-200/10 blur-3xl" />
            <div className="relative flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShoppingBag size={18} style={{ color: colors.accent2 }} />
                  <p className="font-sans text-xs font-extrabold uppercase tracking-[0.13em] text-white/60">
                    Your currency
                  </p>
                </div>
                <p className="mt-1 font-display text-4xl font-black text-yellow-200">
                  {controller.shop?.starsBalance.toString() ?? "—"}★
                </p>
                <p className="font-sans text-xs text-white/50">
                  Stars balance
                </p>
              </div>
              <div className="text-right">
                <span className="inline-flex rounded-full border border-cyan-200/20 bg-cyan-300/10 px-2.5 py-1 font-sans text-[10px] font-extrabold uppercase tracking-wide text-cyan-100">
                  Devnet · Test USDC
                </span>
                <p className="mt-3 font-sans text-lg font-black text-white">
                  {player.usdcBaseUnits === null
                    ? "—"
                    : formatUsdcBaseUnits(player.usdcBaseUnits)}{" "}
                  <span className="text-xs text-white/50">USDC</span>
                </p>
                <button
                  type="button"
                  onClick={openWallet}
                  className="mt-1 inline-flex items-center gap-1 font-sans text-xs font-bold text-cyan-200"
                >
                  <WalletCards size={13} /> Wallet &amp; funding
                </button>
              </div>
            </div>

            {controller.shop?.saleEnabled && (
              <SaleBanner shop={controller.shop} />
            )}
          </motion.section>

          {success && (
            <section
              role="status"
              className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-3 text-center"
            >
              <p className="font-sans text-sm font-bold text-emerald-100">
                {success}
              </p>
              {shopOrigin && (
                <button
                  type="button"
                  onClick={returnFromShop}
                  className="mt-2 rounded-xl bg-emerald-300 px-4 py-2 font-sans text-xs font-black text-emerald-950"
                >
                  {shopOrigin === "daily" ? "Return to Daily" : "Return Home"}
                </button>
              )}
            </section>
          )}

          {controller.loading && !controller.shop ? (
            <div className="flex items-center justify-center py-16 text-white/60">
              <Loader2 size={28} className="animate-spin" />
            </div>
          ) : controller.shop ? (
            <section>
              <div className="mb-3 flex items-end justify-between gap-3 px-1">
                <div>
                  <h2 className="font-display text-xl font-black text-white">
                    Choose a pack
                  </h2>
                  <p className="font-sans text-xs text-white/50">
                    One sponsored transaction. No SOL fee.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void controller.refresh()}
                  disabled={controller.loading}
                  className="font-sans text-xs font-bold text-white/55 disabled:opacity-40"
                >
                  {controller.loading ? "Refreshing…" : "Refresh prices"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {controller.shop.packs.map((pack) => (
                  <PackCard
                    key={pack.index}
                    pack={pack}
                    shop={controller.shop!}
                    usdcBalance={player.usdcBaseUnits}
                    connected={Boolean(player.publicKey)}
                    busy={controller.purchasingPack !== null}
                    paused={controller.shop!.protocolPaused}
                    accent={colors.accent2}
                    onSelect={() => handlePack(pack)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {(status || controller.error) && (
            <p
              role="alert"
              className="rounded-xl border border-red-300/20 bg-red-950/45 px-3 py-2 text-center font-sans text-xs text-red-200"
            >
              {status ?? controller.error}
            </p>
          )}

          <section className="rounded-2xl border border-white/[0.1] bg-white/[0.05] p-4 backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <ShieldCheck
                size={19}
                className="mt-0.5 shrink-0"
                style={{ color: colors.accent }}
              />
              <div className="font-sans text-xs leading-5 text-white/55">
                <p className="font-bold text-white/80">Know what you buy</p>
                <p>
                  Stars are bound to this connected Solana address. They cannot be transferred,
                  withdrawn, or redeemed for cash. Purchases use Devnet test USDC.
                </p>
                <p className="mt-1">
                  Each payment settles atomically: 10% team, 10% rewards reserve,
                  and 80% plus rounding dust to treasury.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {selectedPack && controller.shop && (
        <PurchaseConfirmation
          pack={selectedPack}
          shop={controller.shop}
          usdcBalance={player.usdcBaseUnits}
          busy={controller.purchasingPack === selectedPack.index}
          onClose={() => setSelectedIndex(null)}
          onFund={openWallet}
          onConfirm={() => void confirmPurchase()}
        />
      )}
    </div>
  );
};

function PackCard({
  pack,
  shop,
  usdcBalance,
  connected,
  busy,
  paused,
  accent,
  onSelect,
}: {
  pack: StarPackQuote;
  shop: StarShopView;
  usdcBalance: bigint | null;
  connected: boolean;
  busy: boolean;
  paused: boolean;
  accent: string;
  onSelect: () => void;
}) {
  const insufficient = usdcBalance !== null && usdcBalance < pack.currentPrice;
  const badge = pack.stars === 100n
    ? "Popular"
    : pack.stars === 1_000n
      ? "Best value"
      : null;
  const dailyEntries = shop.dailyEntryStars > 0n
    ? pack.stars / shop.dailyEntryStars
    : 0n;
  const zoneUnlocks = shop.zoneUnlockStars > 0n
    ? pack.stars / shop.zoneUnlockStars
    : 0n;
  const zonePower = zoneUnlocks > 0n
    ? `${zoneUnlocks.toString()} zone unlock${zoneUnlocks === 1n ? "" : "s"}`
    : shop.zoneUnlockStars > 0n
      ? `${pack.stars.toString()}/${shop.zoneUnlockStars.toString()} toward a zone`
      : "Campaign spending power";

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      disabled={!pack.enabled || busy || paused}
      className="relative min-h-[188px] overflow-hidden rounded-2xl border border-white/[0.13] bg-white/[0.07] p-3 text-left shadow-lg shadow-black/20 backdrop-blur-xl transition hover:bg-white/[0.11] disabled:opacity-45"
      aria-label={`${pack.stars.toString()} Stars for ${formatUsdcBaseUnits(pack.currentPrice)} USDC`}
    >
      {badge && (
        <span
          className="absolute right-2 top-2 rounded-full px-2 py-1 font-sans text-[9px] font-black uppercase tracking-wide text-slate-950"
          style={{ background: accent }}
        >
          {badge}
        </span>
      )}
      <Sparkles size={19} className="text-yellow-200" />
      <p className="mt-2 font-display text-3xl font-black text-yellow-200">
        {pack.stars.toString()}★
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-sans text-base font-black text-white">
          {formatUsdcBaseUnits(pack.currentPrice)} USDC
        </p>
        {pack.onSale && (
          <p className="font-sans text-xs font-bold text-white/35 line-through">
            {formatUsdcBaseUnits(pack.regularPrice)}
          </p>
        )}
      </div>
      {pack.onSale && (
        <p className="font-sans text-[10px] font-black uppercase text-emerald-300">
          Save {savingsPercent(pack)}%
        </p>
      )}
      <p className="mt-3 font-sans text-[11px] leading-4 text-white/52">
        {dailyEntries.toString()} Daily entr{dailyEntries === 1n ? "y" : "ies"}
        {" · "}{zonePower}
      </p>
      <p className="absolute bottom-3 left-3 font-sans text-xs font-extrabold" style={{ color: accent }}>
        {!pack.enabled
          ? "Unavailable"
          : paused
            ? "Shop paused"
            : !connected
              ? "Connect wallet"
              : usdcBalance === null
                ? "Checking wallet…"
              : insufficient
                ? "Funding guidance"
                : "Review purchase"}
      </p>
    </motion.button>
  );
}

function SaleBanner({ shop }: { shop: StarShopView }) {
  const now = BigInt(Math.floor(Date.now() / 1_000));
  if (!shop.saleLive && now >= shop.saleStartsAt) return null;
  const target = shop.saleLive ? shop.saleEndsAt : shop.saleStartsAt;
  const remaining = target > now ? target - now : 0n;
  return (
    <div className="relative mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200/20 bg-emerald-300/10 px-3 py-2">
      <p className="font-sans text-xs font-black uppercase tracking-wide text-emerald-100">
        {shop.saleLive ? "Star sale live" : "Star sale scheduled"}
      </p>
      <p className="inline-flex items-center gap-1 font-mono text-xs font-bold text-emerald-100">
        <Clock3 size={13} />
        {shop.saleLive ? "Ends" : "Starts"} in {formatDuration(remaining)}
      </p>
    </div>
  );
}

function PurchaseConfirmation({
  pack,
  shop,
  usdcBalance,
  busy,
  onClose,
  onFund,
  onConfirm,
}: {
  pack: StarPackQuote;
  shop: StarShopView;
  usdcBalance: bigint | null;
  busy: boolean;
  onClose: () => void;
  onFund: () => void;
  onConfirm: () => void;
}) {
  const split = splitStarPurchase(pack.currentPrice);
  const insufficient = usdcBalance !== null && usdcBalance < pack.currentPrice;
  const resultingUsdc = usdcBalance === null
    ? null
    : usdcBalance - pack.currentPrice;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center">
      <button
        type="button"
        aria-label="Close purchase confirmation"
        onClick={busy ? undefined : onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-md"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-title"
        className="relative w-full max-w-[520px] rounded-3xl border border-white/[0.16] bg-slate-950/95 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.7)]"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
          className="absolute right-4 top-4 text-white/50 disabled:opacity-30"
        >
          <X size={20} />
        </button>
        <p className="font-sans text-xs font-black uppercase tracking-[0.13em] text-yellow-200">
          Confirm purchase
        </p>
        <h2 id="purchase-title" className="mt-1 font-display text-3xl font-black text-white">
          {pack.stars.toString()} Stars
        </h2>
        {!shop.playerInitialized && (
          <p className="mt-2 rounded-xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 font-sans text-xs text-cyan-100">
            Your player profile and Map 1 access will be initialized atomically
            with this first purchase.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ConfirmMetric
            label="Stars"
            value={`${shop.starsBalance.toString()} → ${(shop.starsBalance + pack.stars).toString()}★`}
          />
          <ConfirmMetric
            label="Maximum charge"
            value={`${formatUsdcBaseUnits(pack.currentPrice)} USDC`}
          />
          <ConfirmMetric
            label="Wallet USDC"
            value={
              usdcBalance === null
                ? "—"
                : `${formatUsdcBaseUnits(usdcBalance)} → ${formatUsdcBaseUnits(resultingUsdc!)}`
            }
          />
          <ConfirmMetric
            label="Network fee"
            value="Sponsored · 0 SOL"
          />
        </div>

        <div className="mt-3 rounded-xl border border-white/[0.1] bg-white/[0.04] p-3 font-sans text-xs text-white/60">
          <p className="mb-2 font-bold text-white/85">Atomic payment split</p>
          <SplitRow label="Team · 10%" value={split.team} />
          <SplitRow label="Rewards · 10%" value={split.rewards} />
          <SplitRow label="Treasury · 80% + dust" value={split.treasury} />
        </div>

        <p className="mt-3 font-sans text-[11px] leading-4 text-white/45">
          The Shop re-checks the on-chain quote before submission. If a sale or
          pack changes, you will be asked to review the new price. Your wallet
          must approve this exact USDC purchase; a zKube session cannot spend USDC.
        </p>

        {insufficient ? (
          <button
            type="button"
            onClick={onFund}
            className="mt-4 w-full rounded-xl bg-cyan-300 py-3 font-sans text-sm font-black text-cyan-950"
          >
            Open wallet funding guidance
          </button>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || usdcBalance === null}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-300 py-3 font-sans text-sm font-black text-yellow-950 disabled:opacity-45"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy
              ? "Purchasing…"
              : `Approve ${formatUsdcBaseUnits(pack.currentPrice)} USDC in wallet`}
          </button>
        )}
      </section>
    </div>
  );
}

function ConfirmMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.1] bg-white/[0.05] p-3">
      <p className="font-sans text-[10px] font-bold uppercase tracking-wide text-white/40">
        {label}
      </p>
      <p className="mt-1 font-sans text-sm font-black text-white/90">{value}</p>
    </div>
  );
}

function SplitRow({ label, value }: { label: string; value: bigint }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span>{label}</span>
      <span className="font-bold text-white/80">
        {formatUsdcBaseUnits(value)} USDC
      </span>
    </div>
  );
}

function savingsPercent(pack: StarPackQuote): string {
  if (pack.regularPrice <= 0n || pack.currentPrice >= pack.regularPrice) return "0";
  return (((pack.regularPrice - pack.currentPrice) * 100n) / pack.regularPrice).toString();
}

function formatDuration(seconds: bigint): string {
  const days = seconds / 86_400n;
  const hours = (seconds % 86_400n) / 3_600n;
  const minutes = (seconds % 3_600n) / 60n;
  const secs = seconds % 60n;
  return days > 0n
    ? `${days}d ${hours.toString().padStart(2, "0")}h`
    : `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function shortSignature(signature: string): string {
  return signature.length > 12
    ? `${signature.slice(0, 6)}…${signature.slice(-4)}`
    : signature;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default ShopPage;

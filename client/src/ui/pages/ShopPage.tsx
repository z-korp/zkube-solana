import { useEffect, useState } from "react";
import { ChevronLeft, Clock3, Loader2, WalletCards } from "lucide-react";
import { motion } from "motion/react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import {
  StarShopQuoteChangedError,
  useShopController,
} from "@/chain/useShopController";
import type { StarPackQuote, StarShopView } from "@/chain/shopClient";
import { getThemeColors, getThemeId, getThemeImages } from "@/config/themes";
import { useCampaign } from "@/contexts/campaign";
import { useDaily } from "@/contexts/daily";
import { useProgress } from "@/contexts/progress";
import { useNavigationStore } from "@/stores/navigationStore";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import Card from "@/ui/components/shared/Card";
import EmptyState from "@/ui/components/shared/EmptyState";
import InfoSheet from "@/ui/components/shared/InfoSheet";
import PageHeader from "@/ui/components/shared/PageHeader";
import Sheet from "@/ui/components/shared/Sheet";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { formatSolLamports } from "@/utils/currency";

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
  // The smallest enabled pack sets the reference star rate; every other
  // pack's badge shows what buying bigger saves (live sales included, since
  // rates compare current prices).
  const basePack =
    controller.shop?.packs.reduce<StarPackQuote | null>(
      (best, candidate) =>
        candidate.enabled && (best === null || candidate.stars < best.stars)
          ? candidate
          : best,
      null,
    ) ?? null;

  const openWallet = () => {
    setSelectedIndex(null);
    openWalletSettings("shop");
  };

  const handlePack = (pack: StarPackQuote) => {
    setStatus(null);
    if (
      !player.publicKey ||
      (player.balanceLamports !== null &&
        BigInt(player.balanceLamports) < pack.currentPrice)
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
    navigate(shopOrigin === "ranks" ? "ranks" : "home");
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden pb-[100px] pt-12">
      <PageHeader
        title="Shop"
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
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card as="section" tone="raised" className="p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p
                    className="font-sans text-3xl font-black leading-none"
                    style={{ color: colors.accent2 }}
                  >
                    ★ {controller.shop?.starsBalance.toString() ?? "—"}
                  </p>
                  <p className="mt-1 font-sans text-[11px] font-semibold text-white/50">
                    Stars balance
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-sans text-lg font-black leading-none text-white">
                    {player.balanceLamports === null
                      ? "—"
                      : formatSolLamports(BigInt(player.balanceLamports))}{" "}
                    <span className="text-xs font-semibold text-white/50">
                      SOL
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={openWallet}
                    className="mt-1.5 inline-flex items-center gap-1 font-sans text-xs font-bold"
                    style={{ color: colors.accent }}
                  >
                    <WalletCards size={13} /> Wallet &amp; funding
                  </button>
                </div>
              </div>

              {controller.shop?.saleEnabled && (
                <SaleBanner shop={controller.shop} />
              )}
            </Card>
          </motion.div>

          {success && (
            <section
              role="status"
              className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-3 text-center"
            >
              <p className="font-sans text-sm font-bold text-emerald-100">
                {success}
              </p>
              {shopOrigin && (
                <ArcadeButton
                  onClick={returnFromShop}
                  accentOverride="#6ee7b7"
                  className="mt-2 !px-4 !py-2.5 !text-[13px]"
                >
                  {shopOrigin === "ranks" ? "Return to Arena" : "Return Home"}
                </ArcadeButton>
              )}
            </section>
          )}

          {controller.loading && !controller.shop ? (
            <EmptyState
              icon={<Loader2 size={28} className="animate-spin" />}
              title="Fetching live prices…"
            />
          ) : controller.shop ? (
            <section>
              <p className="mb-2 px-1 font-sans text-[11px] font-bold uppercase tracking-[0.15em] text-white/45">
                Star packs
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {controller.shop.packs.map((pack) => (
                  <PackCard
                    key={pack.index}
                    pack={pack}
                    savingsPct={bulkSavingsPercent(pack, basePack)}
                    connected={Boolean(player.publicKey)}
                    busy={controller.purchasingPack !== null}
                    paused={controller.shop!.protocolPaused}
                    accent={colors.accent2}
                    onSelect={() => handlePack(pack)}
                  />
                ))}
              </div>
            </section>
          ) : (
            <EmptyState
              title="Star Shop is unavailable"
              hint="The shop configuration could not be read. Pull to refresh or try again shortly."
            />
          )}

          {(status || controller.error) && (
            <p
              role="alert"
              className="rounded-xl border border-red-300/20 bg-red-950/45 px-3 py-2 text-center font-sans text-xs text-red-200"
            >
              {status ?? controller.error}
            </p>
          )}

          <div className="flex justify-center">
            <InfoSheet label="How the Shop works" title="How the Shop works">
              <p>
                Stars are bound to your connected Solana address — they cannot
                be transferred, withdrawn, or redeemed for fiat. Spend them on
                Daily Arena entries and zone unlocks.
              </p>
              <p>
                Purchases use Devnet test SOL and need one wallet approval for
                the exact amount shown; a zKube session can never spend SOL.
              </p>
              <p>
                Every payment settles atomically on-chain: 10% team, 10%
                rewards reserve, 80% plus rounding dust to treasury. Prices are
                re-checked against the live on-chain quote right before you
                sign.
              </p>
            </InfoSheet>
          </div>
        </div>
      </div>

      {selectedPack && controller.shop && (
        <PurchaseConfirmation
          pack={selectedPack}
          shop={controller.shop}
          savingsPct={bulkSavingsPercent(selectedPack, basePack)}
          solBalance={player.balanceLamports === null ? null : BigInt(player.balanceLamports)}
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
  savingsPct,
  connected,
  busy,
  paused,
  accent,
  onSelect,
}: {
  pack: StarPackQuote;
  savingsPct: number;
  connected: boolean;
  busy: boolean;
  paused: boolean;
  accent: string;
  onSelect: () => void;
}) {
  const badge = pack.stars === 100n
    ? "Popular"
    : pack.stars === 1_000n
      ? "Best value"
      : null;
  const blocked = !pack.enabled
    ? "Unavailable"
    : paused
      ? "Shop paused"
      : !connected
        ? "Connect wallet"
        : null;
  // Each pack borrows a zone's art — bigger packs wear deeper zones.
  const packTheme = getThemeId(Math.min(10, pack.index * 2 + 1));
  const packArt = getThemeImages(packTheme).background;

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onSelect}
      disabled={!pack.enabled || busy || paused}
      className="group relative overflow-hidden rounded-2xl border border-white/[0.14] shadow-lg shadow-black/30 transition disabled:opacity-45"
      aria-label={`${pack.stars.toString()} Stars for ${formatSolLamports(pack.currentPrice)} SOL`}
    >
      <img
        src={packArt}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/65 to-black/35" />
      {savingsPct > 0 && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-emerald-400 px-2 py-0.5 font-sans text-[10px] font-black text-emerald-950 shadow-[0_0_12px_rgba(52,211,153,0.6)]">
          −{savingsPct}%
        </span>
      )}
      {badge && (
        <span
          className="absolute right-2 top-2 z-10 rounded-full px-2 py-0.5 font-sans text-[9px] font-black uppercase tracking-wide text-slate-950"
          style={{ background: accent }}
        >
          {badge}
        </span>
      )}
      <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 px-3 py-7">
        <p className="font-display text-4xl font-black text-yellow-200 drop-shadow-[0_0_14px_rgba(250,204,21,0.45)]">
          {pack.stars.toString()}★
        </p>
        <div className="flex items-baseline gap-1.5">
          <p className="font-sans text-sm font-black text-white drop-shadow-md">
            {formatSolLamports(pack.currentPrice)} SOL
          </p>
          {pack.onSale && (
            <p className="font-sans text-[11px] font-bold text-white/45 line-through">
              {formatSolLamports(pack.regularPrice)}
            </p>
          )}
        </div>
        {blocked && (
          <p className="font-sans text-[10px] font-bold text-white/55">
            {blocked}
          </p>
        )}
      </div>
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
  solBalance,
  savingsPct,
  busy,
  onClose,
  onFund,
  onConfirm,
}: {
  pack: StarPackQuote;
  shop: StarShopView;
  solBalance: bigint | null;
  savingsPct: number;
  busy: boolean;
  onClose: () => void;
  onFund: () => void;
  onConfirm: () => void;
}) {
  const insufficient = solBalance !== null && solBalance < pack.currentPrice;
  const dailyEntries =
    shop.dailyEntryStars > 0n ? pack.stars / shop.dailyEntryStars : 0n;
  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      srTitle={`Buy ${pack.stars.toString()} Stars`}
    >
      <div className="flex flex-col gap-4 pb-1 pt-1">
        {/* What you GET, front and center. */}
        <div className="text-center">
          <p className="font-display text-5xl font-black text-yellow-200 drop-shadow-[0_0_18px_rgba(250,204,21,0.45)]">
            +{pack.stars.toString()}★
          </p>
          <div className="mt-2 flex items-center justify-center gap-2">
            <p className="font-sans text-lg font-black text-white">
              {formatSolLamports(pack.currentPrice)} SOL
            </p>
            {pack.onSale && (
              <p className="font-sans text-xs font-bold text-white/40 line-through">
                {formatSolLamports(pack.regularPrice)}
              </p>
            )}
            {savingsPct > 0 && (
              <span className="rounded-full bg-emerald-400 px-2 py-0.5 font-sans text-[10px] font-black text-emerald-950">
                −{savingsPct}%
              </span>
            )}
          </div>
          <p className="mt-1.5 font-sans text-xs font-semibold text-white/55">
            Balance after purchase:{" "}
            <span className="font-black text-yellow-200">
              ★ {(shop.starsBalance + pack.stars).toString()}
            </span>
          </p>
        </div>

        {!shop.playerInitialized && (
          <p className="rounded-xl border border-white/[0.14] bg-white/[0.06] px-3 py-2 text-center font-sans text-xs text-white/70">
            Your player profile and Map 1 access come free with this first
            purchase.
          </p>
        )}

        {insufficient ? (
          <ArcadeButton onClick={onFund}>
            Add SOL to your wallet
          </ArcadeButton>
        ) : (
          <ArcadeButton
            onClick={onConfirm}
            disabled={busy || solBalance === null}
            accentOverride="#fde047"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy
              ? "Purchasing…"
              : `Buy ${pack.stars.toString()}★ for ${formatSolLamports(pack.currentPrice)} SOL`}
          </ArcadeButton>
        )}

        {dailyEntries > 0n && (
          <p className="text-center font-sans text-xs font-semibold text-white/55">
            Worth{" "}
            <span className="font-black text-white/85">
              {dailyEntries.toString()}
            </span>{" "}
            Daily Arena entries
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Percent saved versus buying the same stars at the smallest pack's current
 * rate. Bulk pricing and live sales both flow through, since the comparison
 * uses current prices on both sides.
 */
function bulkSavingsPercent(
  pack: StarPackQuote,
  base: StarPackQuote | null,
): number {
  if (!base || base.index === pack.index) {
    // The reference pack can still be on sale — show its sale savings.
    if (
      pack.onSale &&
      pack.regularPrice > 0n &&
      pack.currentPrice < pack.regularPrice
    ) {
      return Number(
        ((pack.regularPrice - pack.currentPrice) * 100n) / pack.regularPrice,
      );
    }
    return 0;
  }
  if (base.currentPrice <= 0n || base.stars <= 0n || pack.stars <= 0n) {
    return 0;
  }
  const reference = base.currentPrice * pack.stars;
  if (reference <= 0n) return 0;
  const pct = 100n - (pack.currentPrice * base.stars * 100n) / reference;
  return pct > 0n ? Number(pct) : 0;
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

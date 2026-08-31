import { useEffect, useState } from "react";
import { motion } from "motion/react";

import {
  KREDIT_PACK_SIZES,
  kreditPackLamports,
  type KreditPackSize,
} from "@/config/kreditPacks";
import KreditCoin from "@/ui/components/economy/KreditCoin";
import SolMark from "@/ui/components/economy/SolMark";
import { MONEY_GOLD, mixHex } from "@/ui/components/economy/tokens";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import InfoSheet from "@/ui/components/shared/InfoSheet";
import Sheet from "@/ui/components/shared/Sheet";
import { formatSolBalanceLamports } from "@/utils/currency";
import { MONEY_SURFACE_SENTINEL } from "@/ui/moneySurface";

interface KreditShopSheetProps {
  open: boolean;
  onClose: () => void;
  /** Prepaid entries already owned. */
  balance: bigint;
  /** Protocol unit price; the program refuses any other. */
  unitLamports: bigint;
  /** Owner-signed purchase of exactly `kredits` entries. */
  onBuy: (kredits: KreditPackSize) => void;
  /** True while a purchase is being signed. */
  busy?: boolean;
}

/**
 * Coins drawn for a pack. Keyed to the pack's position rather than its count,
 * so every pack looks different from the one before it — twenty-five coins
 * would be a smear, and clamping the count made 5, 10 and 25 identical.
 */
const clusterFor = (index: number): number => Math.min(index + 1, 4);

/**
 * The Kredit shop. Every pack is the same Kredit at the same price — the
 * program pins the unit price, so a bulk discount is not expressible and the
 * shop never implies one. What a larger pack buys is fewer wallet approvals,
 * which is the only honest reason to offer one.
 */
const KreditShopSheet: React.FC<KreditShopSheetProps> = ({
  open,
  onClose,
  balance,
  unitLamports,
  onBuy,
  busy = false,
}) => {
  const [selected, setSelected] = useState<KreditPackSize>(
    KREDIT_PACK_SIZES[0],
  );

  // A re-opened shop always starts on the smallest pack.
  useEffect(() => {
    if (open) setSelected(KREDIT_PACK_SIZES[0]);
  }, [open]);

  const totalLamports = kreditPackLamports(selected, unitLamports);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      srTitle="Buy Kredits"
      dismissible={!busy}
    >
      <div
        className="flex flex-col gap-4 pt-1"
        data-zkube-money-surface={MONEY_SURFACE_SENTINEL}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[30px] leading-none text-white">
            Kredits
          </span>
          <span
            className="flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-black/40 px-3 py-1.5 font-mono text-[13px] font-bold tabular-nums"
            style={{ color: MONEY_GOLD }}
          >
            <KreditCoin size={16} />
            {balance.toString()}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {KREDIT_PACK_SIZES.map((kredits, packIndex) => {
            const active = kredits === selected;
            return (
              <motion.button
                key={kredits}
                type="button"
                disabled={busy}
                aria-pressed={active}
                onClick={() => setSelected(kredits)}
                whileTap={{ y: 3, boxShadow: "0 1px 0 #04070F" }}
                className="flex flex-col items-center gap-1.5 rounded-2xl px-3 py-3.5 disabled:opacity-60"
                style={{
                  background: active
                    ? `linear-gradient(160deg, ${mixHex(MONEY_GOLD, 255, 0.35)} 0%, ${MONEY_GOLD} 55%, ${mixHex(MONEY_GOLD, 0, 0.3)} 100%)`
                    : "linear-gradient(180deg, #101A2E 0%, #0A1120 100%)",
                  border: active
                    ? "1px solid rgba(255,255,255,0.28)"
                    : "1px solid rgba(255,255,255,0.10)",
                  boxShadow: active
                    ? `0 4px 0 ${mixHex(MONEY_GOLD, 0, 0.6)}, inset 0 2px 0 rgba(255,255,255,0.5)`
                    : "0 3px 0 #04070F, inset 0 1px 0 rgba(255,255,255,0.08)",
                }}
              >
                <span
                  className="flex h-[38px] items-end justify-center"
                  aria-hidden
                >
                  {Array.from({ length: clusterFor(packIndex) }, (_, index) => (
                    <span
                      key={index}
                      style={{ marginLeft: index === 0 ? 0 : -14 }}
                    >
                      <KreditCoin size={34} />
                    </span>
                  ))}
                </span>
                {/* Heavy sans, not the display serif: an etched face inside
                    chunky sticker furniture reads as ornament, not as a count. */}
                <span
                  className="font-sans text-[24px] font-black leading-none tabular-nums"
                  style={{ color: active ? "#241903" : "#FFFFFF" }}
                >
                  {kredits}
                </span>
                <span
                  className="flex items-center gap-1 font-mono text-[12px] font-bold tabular-nums"
                  style={{
                    color: active ? "#3A2C04" : MONEY_GOLD,
                  }}
                >
                  {formatSolBalanceLamports(
                    kreditPackLamports(kredits, unitLamports),
                  )}
                  <SolMark size={9} />
                </span>
              </motion.button>
            );
          })}
        </div>

        <InfoSheet title="How Kredits work">
          <p>
            Every Kredit costs the same {formatSolBalanceLamports(unitLamports)}{" "}
            SOL. A bigger pack is not cheaper — it is one wallet approval
            instead of several.
          </p>
          <p>
            Purchase sends 10% to the operator and holds the prepaid 90% for the
            following Daily. A Kredit is one-way: it buys entries and never
            converts back to SOL.
          </p>
        </InfoSheet>

        <ArcadeButton
          disabled={busy}
          onClick={() => onBuy(selected)}
          accentOverride={MONEY_GOLD}
        >
          {busy
            ? "Buying…"
            : `Buy ${selected} · ${formatSolBalanceLamports(totalLamports)} SOL`}
        </ArcadeButton>
      </div>
    </Sheet>
  );
};

export default KreditShopSheet;

import { motion } from "motion/react";

import { KreditCoin, SolMark } from "@/ui/components/economy";
import { MONEY_SURFACE_SENTINEL } from "@/ui/moneySurface";

interface EnterCoinKeyProps {
  /** The verb ("Play", "Resume run", "Get Kredits", …). */
  label: string;
  /**
   * The token this key moves, if any.
   *
   * `kredit` for a key that spends one to enter; `sol` only for collecting a
   * prize, which is the one action on this screen denominated in SOL. An entry
   * is never priced in SOL here — the SOL price of a Kredit belongs in the
   * shop, and pricing a key labelled "Play" in SOL conflated the two
   * currencies at the exact moment they matter most.
   */
  token?: "kredit" | "sol";
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * The pinned key: the insert-coin moment as a button. Same chunky gold recipe
 * as every key in the app.
 */
const EnterCoinKey: React.FC<EnterCoinKeyProps> = ({
  label,
  token,
  disabled = false,
  onClick,
}) => (
  <motion.button
    data-zkube-money-surface={MONEY_SURFACE_SENTINEL}
    type="button"
    whileTap={
      disabled
        ? undefined
        : {
            y: 4,
            boxShadow: "0 1px 0 #705C09, inset 0 2px 0 rgba(255,255,255,0.5)",
          }
    }
    disabled={disabled}
    onClick={onClick}
    className="flex w-full items-center justify-center gap-2.5 rounded-2xl px-4 py-3.5 font-sans text-[17px] font-extrabold uppercase tracking-[0.08em] text-[#241903] disabled:cursor-not-allowed disabled:opacity-55"
    style={{
      background:
        "linear-gradient(160deg, #FCE177 0%, #FACC15 55%, #B4930F 100%)",
      boxShadow:
        "0 5px 0 #705C09, 0 12px 26px -10px rgba(250,204,21,0.65), inset 0 2px 0 rgba(255,255,255,0.5)",
    }}
  >
    <span>{label}</span>
    {token === "kredit" && <KreditCoin size={24} />}
    {token === "sol" && <SolMark size={17} />}
  </motion.button>
);

export default EnterCoinKey;

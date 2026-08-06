import { motion } from "motion/react";

import { Coin } from "@/ui/components/economy";

interface EnterCoinKeyProps {
  /** The verb ("Enter", "Resume run", "Entries closed", …). */
  label: string;
  /** SOL entry price shown beside the coin; omit for non-entry verbs. */
  amountSol?: string | null;
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * The Arcade's pinned key: the insert-coin moment as a button. When it sells
 * an entry, the embossed SOL coin sits after the price as its unit — one
 * currency object, obeying the amount-then-mark rule. Other lifecycle verbs
 * render plain. Same chunky gold recipe as every key in the app.
 */
const EnterCoinKey: React.FC<EnterCoinKeyProps> = ({
  label,
  amountSol = null,
  disabled = false,
  onClick,
}) => (
  <motion.button
    type="button"
    whileTap={
      disabled
        ? undefined
        : { y: 4, boxShadow: "0 1px 0 #705C09, inset 0 2px 0 rgba(255,255,255,0.5)" }
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
    <span>
      {label}
      {amountSol !== null && ` ${amountSol}`}
    </span>
    {amountSol !== null && <Coin size={26} />}
  </motion.button>
);

export default EnterCoinKey;

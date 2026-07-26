import { motion, useReducedMotion } from "motion/react";

import { MONEY_GOLD } from "./tokens";

interface CoinProps {
  size?: number;
  className?: string;
  variant?: "static" | "spin";
  title?: string;
}

/**
 * Original zKube coin face. The isometric cube is a game mark, not a Solana
 * trademark; SOL denomination remains adjacent text wherever money is shown.
 */
const Coin: React.FC<CoinProps> = ({
  size = 40,
  className = "",
  variant = "static",
  title,
}) => {
  const reduceMotion = useReducedMotion();
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      {title && <title>{title}</title>}
      <defs>
        <radialGradient id="zkube-coin-face" cx="35%" cy="28%" r="72%">
          <stop offset="0" stopColor="#fff7ae" />
          <stop offset="0.4" stopColor={MONEY_GOLD} />
          <stop offset="1" stopColor="#a86105" />
        </radialGradient>
        <linearGradient id="zkube-coin-rim" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff4a3" />
          <stop offset="0.45" stopColor="#ca8a04" />
          <stop offset="1" stopColor="#713f12" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill="url(#zkube-coin-rim)" />
      <circle
        cx="32"
        cy="32"
        r="24.5"
        fill="url(#zkube-coin-face)"
        stroke="#6b3c08"
        strokeWidth="1.5"
      />
      <circle
        cx="32"
        cy="32"
        r="20.5"
        fill="none"
        stroke="#fff6a0"
        strokeOpacity="0.55"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <path d="m32 17 13 7.5-13 7.4-13-7.4Z" fill="#fff3a1" />
      <path d="m19 24.5 13 7.4v15L19 39.5Z" fill="#d89108" />
      <path d="m45 24.5-13 7.4v15l13-7.4Z" fill="#9a5805" />
      <path
        d="m32 17 13 7.5-13 7.4-13-7.4Zm0 14.9v15m-13-22.4v15L32 47l13-7.5v-15"
        fill="none"
        stroke="#4b2c08"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );

  return variant === "spin" && !reduceMotion ? (
    <motion.span
      className="inline-flex"
      animate={{ rotateY: [0, 180, 360] }}
      transition={{ duration: 0.9, ease: "easeOut" }}
    >
      {svg}
    </motion.span>
  ) : svg;
};

export default Coin;

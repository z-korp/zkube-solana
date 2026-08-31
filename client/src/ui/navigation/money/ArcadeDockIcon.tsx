import { useId } from "react";

import { SOL_LOGO_PATH } from "@/ui/components/economy/SolMark";
import { MONEY_SURFACE_SENTINEL } from "@/ui/moneySurface";

export default function ArcadeDockIcon({ size = 20 }: { size?: number }) {
  const mask = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      data-zkube-money-surface={MONEY_SURFACE_SENTINEL}
    >
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <g transform="translate(7.15 8.15) scale(0.096)">
            <path d={SOL_LOGO_PATH} fill="black" />
          </g>
        </mask>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="10.4"
        fill="currentColor"
        mask={`url(#${mask})`}
      />
    </svg>
  );
}

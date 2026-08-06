import { useId } from "react";

import { SOL_LOGO_PATH } from "@/ui/components/economy/SolMark";

/**
 * The dock's ink stamps (board 03, direction B): solid one-tint silhouettes in
 * currentColor — dim white at rest, dark ink on the gold key. Cutouts carry
 * the meaning: the arcade coin is stamped with the real SOL mark, the campaign
 * map with the winding trail and star, the profile shield with the emblem star.
 */

interface DockIconProps {
  size?: number;
}

function starPath(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.46;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${points.join(" L")} Z`;
}

const HOUSE_D =
  "M12 2.6 L21.8 10.9 V18.9 Q21.8 21 19.7 21 H4.3 Q2.2 21 2.2 18.9 V10.9 Z " +
  "M9.3 21 V14.8 Q9.3 13.2 10.9 13.2 H13.1 Q14.7 13.2 14.7 14.8 V21 Z";
const SHIELD_D =
  "M12 2.4 L20.4 5.5 V11.9 Q20.4 18.3 12 21.6 Q3.6 18.3 3.6 11.9 V5.5 Z";
const MAP_TRAIL_D =
  "M5.2 15.6 C7.4 11.2 10.2 16.4 12.6 11.8 C13.5 10.1 14.8 9.5 16.2 9.3";
const MAP_STAR = starPath(16.9, 8.6, 2.8);
const SHIELD_STAR = starPath(12, 11.6, 4.6);

export const DockHomeIcon: React.FC<DockIconProps> = ({ size = 20 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fillRule="evenodd" d={HOUSE_D} fill="currentColor" />
  </svg>
);

export const DockArcadeIcon: React.FC<DockIconProps> = ({ size = 20 }) => {
  const mask = useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <g transform="translate(7.15 8.15) scale(0.096)">
            <path d={SOL_LOGO_PATH} fill="black" />
          </g>
        </mask>
      </defs>
      <circle cx="12" cy="12" r="10.4" fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
};

export const DockCampaignIcon: React.FC<DockIconProps> = ({ size = 20 }) => {
  const mask = useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <path
            d={MAP_TRAIL_D}
            stroke="black"
            strokeWidth="1.7"
            strokeDasharray="2.4 2.1"
            fill="none"
            strokeLinecap="round"
          />
          <path d={MAP_STAR} fill="black" />
        </mask>
      </defs>
      <rect
        x="2.4"
        y="4.6"
        width="19.2"
        height="14.8"
        rx="2.6"
        fill="currentColor"
        mask={`url(#${mask})`}
      />
    </svg>
  );
};

export const DockProfileIcon: React.FC<DockIconProps> = ({ size = 20 }) => {
  const mask = useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <mask id={mask}>
          <rect width="24" height="24" fill="white" />
          <path d={SHIELD_STAR} fill="black" />
        </mask>
      </defs>
      <path d={SHIELD_D} fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
};

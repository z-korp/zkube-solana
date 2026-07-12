import { HUD_BAR } from "./chromeLayout";

const { viewBox, panel, sockets } = HUD_BAR;

export default function HudBarSvg({ starsEarned = 0, endless = false }: { starsEarned?: number; endless?: boolean }) {
  return (
    <svg
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      className="block h-auto w-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="zk-hud-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1e2e" />
          <stop offset="50%" stopColor="#0f1219" />
          <stop offset="100%" stopColor="#1a1e2e" />
        </linearGradient>
        <linearGradient id="zk-hud-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B7355" />
          <stop offset="45%" stopColor="#DFC088" />
          <stop offset="100%" stopColor="#6B5B3E" />
        </linearGradient>
        <radialGradient id="zk-hud-recess">
          <stop offset="0%" stopColor="#050710" />
          <stop offset="100%" stopColor="#141824" />
        </radialGradient>
        <filter id="zk-hud-shadow" x="-5%" y="-15%" width="110%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.6" />
        </filter>
      </defs>
      <rect
        x={panel.x}
        y={panel.y}
        width={panel.width}
        height={panel.height}
        rx={panel.rx}
        fill="url(#zk-hud-panel)"
        stroke="#C9A96E"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        filter="url(#zk-hud-shadow)"
      />
      <circle cx={sockets.guardian.cx} cy={sockets.guardian.cy} r={sockets.guardian.r + 5} fill="#0f1219" />
      <circle cx={sockets.guardian.cx} cy={sockets.guardian.cy} r={sockets.guardian.r + 3} fill="none" stroke="url(#zk-hud-ring)" strokeWidth="3" />
      <circle cx={sockets.guardian.cx} cy={sockets.guardian.cy} r={sockets.guardian.r} fill="url(#zk-hud-recess)" />
      <rect x={sockets.scoreBar.x} y={sockets.scoreBar.y} width={sockets.scoreBar.width} height={sockets.scoreBar.height} rx="5" fill="#060912" stroke="#1a1e2e" />
      <circle cx={sockets.moves.cx} cy={sockets.moves.cy} r={sockets.moves.r + 5} fill="#0f1219" />
      <circle cx={sockets.moves.cx} cy={sockets.moves.cy} r={sockets.moves.r + 3} fill="none" stroke="url(#zk-hud-ring)" strokeWidth="3" />
      <circle cx={sockets.moves.cx} cy={sockets.moves.cy} r={sockets.moves.r} fill="url(#zk-hud-recess)" />
      <text x="250" y="34" textAnchor="middle" fill="#FACC15" fontSize="20" fontWeight="bold">
        {endless ? "∞" : Array.from({ length: 3 }, (_, index) => index < starsEarned ? "★" : "☆").join(" ")}
      </text>
    </svg>
  );
}

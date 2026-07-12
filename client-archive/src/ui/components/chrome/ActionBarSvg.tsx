import { ACTION_BAR } from "./chromeLayout";

const { viewBox, sockets } = ACTION_BAR;

export default function ActionBarSvg() {
  return (
    <svg
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      className="block h-auto w-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="zk-action-panel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a1e2e" />
          <stop offset="50%" stopColor="#0f1219" />
          <stop offset="100%" stopColor="#1a1e2e" />
        </linearGradient>
        <linearGradient id="zk-action-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B7355" />
          <stop offset="45%" stopColor="#DFC088" />
          <stop offset="100%" stopColor="#6B5B3E" />
        </linearGradient>
        <radialGradient id="zk-action-recess">
          <stop offset="0%" stopColor="#050710" />
          <stop offset="100%" stopColor="#141824" />
        </radialGradient>
        <filter id="zk-action-shadow" x="-5%" y="-15%" width="110%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.6" />
        </filter>
      </defs>
      <rect
        x="20"
        y="10"
        width={viewBox.width - 40}
        height={viewBox.height - 20}
        rx="14"
        fill="url(#zk-action-panel)"
        stroke="#C9A96E"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        filter="url(#zk-action-shadow)"
      />
      {Object.values(sockets).map((socket, index) => (
        <g key={index}>
          <circle cx={socket.cx} cy={socket.cy} r={socket.r + 3} fill="none" stroke="url(#zk-action-ring)" strokeWidth="2.5" />
          <circle cx={socket.cx} cy={socket.cy} r={socket.r} fill="url(#zk-action-recess)" />
        </g>
      ))}
      <line x1="104" y1="50" x2="164" y2="50" stroke="#C9A96E" opacity="0.2" />
      <line x1="236" y1="50" x2="296" y2="50" stroke="#C9A96E" opacity="0.2" />
    </svg>
  );
}

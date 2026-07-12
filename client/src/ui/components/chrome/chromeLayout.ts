export const HUD_BAR = {
  viewBox: { width: 500, height: 152 },
  panel: { x: 76, y: 16, width: 348, height: 88, rx: 12 },
  sockets: {
    guardian: { cx: 76, cy: 60, r: 32 },
    stars: { x: 186, y: 22, width: 128, height: 22 },
    scoreBar: { x: 144, y: 48, width: 212, height: 20 },
    combo: { x: 218, y: 74, width: 64, height: 24 },
    moves: { cx: 424, cy: 60, r: 34 },
    constraint1: { cx: 160, cy: 110, r: 18 },
    constraint2: { cx: 340, cy: 110, r: 18 },
  },
} as const;

export const ACTION_BAR = {
  viewBox: { width: 400, height: 100 },
  sockets: {
    surrender: { cx: 72, cy: 50, r: 26 },
    bonus: { cx: 200, cy: 50, r: 30 },
    settings: { cx: 328, cy: 50, r: 26 },
  },
} as const;

interface CircleSocket {
  cx: number;
  cy: number;
  r: number;
}

interface RectSocket {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewBox {
  width: number;
  height: number;
}

export function circleToPercent(socket: CircleSocket, viewBox: ViewBox) {
  return {
    left: `${((socket.cx - socket.r) / viewBox.width) * 100}%`,
    top: `${((socket.cy - socket.r) / viewBox.height) * 100}%`,
    width: `${((socket.r * 2) / viewBox.width) * 100}%`,
    height: `${((socket.r * 2) / viewBox.height) * 100}%`,
  };
}

export function rectToPercent(socket: RectSocket, viewBox: ViewBox) {
  return {
    left: `${(socket.x / viewBox.width) * 100}%`,
    top: `${(socket.y / viewBox.height) * 100}%`,
    width: `${(socket.width / viewBox.width) * 100}%`,
    height: `${(socket.height / viewBox.height) * 100}%`,
  };
}

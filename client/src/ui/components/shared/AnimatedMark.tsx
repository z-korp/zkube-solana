import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
} from "react";
import { useReducedMotion } from "motion/react";

import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { cn } from "@/ui/utils";

import "./animatedMark.css";

/**
 * The zKube mark, revealed on the connect landing: the cube materializes,
 * the mark carves itself on top, then the completed mark detonates the cube
 * — flash, shards, sparks — and only the sign remains. Painted by the
 * active zone theme.
 *
 * Geometry is a true isometric cube (circumradius 38, center 50,50); the
 * mark is one six-point polyline on the inner radius 36 whose crossbar
 * passes exactly through the near corner (50,50) — a line no face contains.
 */

// Total polyline length is 216.2 units — animatedMark.css dashes it at 217.
const MARK = "18.82,32 50,14 81.18,32 18.82,68 50,86 81.18,68";

const T: Point = [50, 12];
const UR: Point = [82.91, 31];
const LR: Point = [82.91, 69];
const B: Point = [50, 88];
const LL: Point = [17.09, 69];
const UL: Point = [17.09, 31];
const M: Point = [50, 50];

type Point = readonly [number, number];
type Quad = readonly [Point, Point, Point, Point];

const midpoint = (a: Point, b: Point): Point => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
];

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const [px, py] of points) {
    x += px;
    y += py;
  }
  return [x / points.length, y / points.length];
}

/** Inset points toward their centroid so seams open between pieces. */
function insetPoints(points: readonly Point[], factor: number): Point[] {
  const [cx, cy] = centroid(points);
  return points.map(([x, y]) => [
    (x - cx) * factor + cx,
    (y - cy) * factor + cy,
  ]);
}

const toAttr = (points: readonly Point[]): string =>
  points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

/** Split a quad into four sub-quads — the detonation shards. */
function subQuads(quad: Quad): Quad[] {
  const [a, b, c, d] = quad;
  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const cd = midpoint(c, d);
  const da = midpoint(d, a);
  const center = centroid(quad);
  return [
    [a, ab, center, da],
    [ab, b, bc, center],
    [center, bc, c, cd],
    [da, center, cd, d],
  ];
}

/** Mix toward white/black; themes.ts keeps its own equivalents private. */
function mixHex(color: string, target: string, amount: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const from = channels(color);
  const to = channels(target);
  return (
    "#" +
    from
      .map((value, i) =>
        Math.round(value + (to[i] - value) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const lighten = (color: string, amount: number) =>
  mixHex(color, "#ffffff", amount);
const darken = (color: string, amount: number) =>
  mixHex(color, "#000000", amount);

const MARK_WIDTH = 11;
const KEYLINE_WIDTH = MARK_WIDTH + 3.2;
const BEVEL_WIDTH = MARK_WIDTH - 0.6;

/** Deterministic scatter vector for shard `index` around quad `quad`. */
function shardStyle(quad: Quad, index: number): CSSProperties {
  const [cx, cy] = centroid(quad);
  const dx = cx - 50;
  const dy = cy - 50;
  const len = Math.hypot(dx, dy) || 1;
  const dist = 55 + ((index * 7) % 22);
  const rot = ((index * 67) % 140) - 70;
  return {
    "--am-ex": `${((dx / len) * dist).toFixed(1)}px`,
    "--am-ey": `${((dy / len) * dist).toFixed(1)}px`,
    "--am-er": `${rot}deg`,
  } as CSSProperties;
}

const SHARD_REST: CSSProperties = {
  "--am-ex": "0px",
  "--am-ey": "0px",
  "--am-er": "0deg",
} as CSSProperties;

interface FaceProps {
  className: string;
  points: Quad;
  fill: string;
  edge: string;
  /** Offset into the shard sequence so scatter varies per face. */
  shardBase: number;
}

function Face({ className, points, fill, edge, shardBase }: FaceProps) {
  return (
    <g className={cn("am-face", className)}>
      {subQuads(points).map((quad, i) => (
        <polygon
          key={i}
          className="am-shard"
          points={toAttr(insetPoints(quad, 0.94))}
          fill={fill}
          stroke={fill}
          strokeWidth={3}
          strokeLinejoin="round"
          style={shardStyle(quad, shardBase + i)}
        />
      ))}
      <polygon
        className="am-shard"
        points={toAttr(insetPoints(points, 0.96))}
        fill="none"
        stroke={edge}
        strokeWidth={0.8}
        strokeLinejoin="round"
        opacity={0.7}
        style={SHARD_REST}
      />
    </g>
  );
}

// Spark ring geometry — deterministic; colors resolve against the theme.
const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 + 0.4;
  const dist = 62 + ((i * 13) % 26);
  return {
    radius: 1.6 + (i % 3) * 0.8,
    cream: i % 3 === 0,
    style: {
      "--am-ex": `${(Math.cos(angle) * dist).toFixed(1)}px`,
      "--am-ey": `${(Math.sin(angle) * dist).toFixed(1)}px`,
    } as CSSProperties,
  };
});

function MarkStroke({
  stroke,
  width,
  transform,
}: {
  stroke: string;
  width: number;
  transform?: string;
}) {
  return (
    <polyline
      className="am-draw"
      points={MARK}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      transform={transform}
    />
  );
}

interface AnimatedMarkProps {
  className?: string;
  /** Skip the reveal and render the settled mark immediately. */
  instant?: boolean;
  /** Fires once, when the reveal settles (immediately when skipped). */
  onSettled?: () => void;
}

export default function AnimatedMark({
  className,
  instant = false,
  onSettled,
}: AnimatedMarkProps) {
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const maskId = useId().replace(/:/g, "");
  const immediate = instant || Boolean(reduceMotion);

  const settledRef = useRef(false);
  const fireSettled = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSettled?.();
  }, [onSettled]);
  useEffect(() => {
    if (immediate) fireSettled();
  }, [immediate, fireSettled]);

  const faceTop = lighten(colors.background, 0.17);
  const faceLeft = lighten(colors.background, 0.08);
  const faceRight = lighten(colors.background, 0.12);
  const faceEdge = lighten(colors.background, 0.26);

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-5",
        immediate && "am-instant",
        className,
      )}
    >
      {/* viewBox is padded 25 units on every side so detonation shards fly
          without clipping; the wrapper is upsized to keep the mark's visual
          size (content occupies 2/3 of the box). */}
      <div
        className="am-glowwrap w-72 max-w-[80vw]"
        style={{ "--am-glow": `${colors.accent}66` } as CSSProperties}
      >
        <svg
          viewBox="-25 -25 150 150"
          className="block h-auto w-full"
          role="img"
          aria-label="zKube"
        >
          <g className="am-cube">
            <Face
              className="am-f1"
              points={[T, UR, M, UL]}
              fill={faceTop}
              edge={faceEdge}
              shardBase={0}
            />
            <Face
              className="am-f2"
              points={[UL, M, B, LL]}
              fill={faceLeft}
              edge={faceEdge}
              shardBase={4}
            />
            <Face
              className="am-f3"
              points={[M, UR, LR, B]}
              fill={faceRight}
              edge={faceEdge}
              shardBase={8}
            />
          </g>
          <circle
            className="am-flash"
            cx={50}
            cy={50}
            r={26}
            fill={lighten(colors.accent, 0.55)}
          />
          {SPARKS.map((spark, i) => (
            <circle
              key={i}
              className="am-spark"
              cx={50}
              cy={50}
              r={spark.radius}
              fill={spark.cream ? "#FFF4D7" : colors.accent}
              style={spark.style}
            />
          ))}
          <mask id={maskId}>
            <polyline
              points={MARK}
              fill="none"
              stroke="#fff"
              strokeWidth={MARK_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </mask>
          <MarkStroke
            stroke={darken(colors.background, 0.55)}
            width={KEYLINE_WIDTH}
          />
          <MarkStroke stroke={colors.accent} width={MARK_WIDTH} />
          <g mask={`url(#${maskId})`}>
            <MarkStroke
              stroke={darken(colors.accent, 0.3)}
              width={BEVEL_WIDTH}
              transform="translate(0,1.3)"
            />
            <MarkStroke
              stroke={lighten(colors.accent, 0.32)}
              width={BEVEL_WIDTH}
              transform="translate(0,-1.3)"
            />
            <MarkStroke stroke={colors.accent} width={BEVEL_WIDTH - 2.6} />
          </g>
        </svg>
      </div>
      <div
        className="am-wordmark font-display text-5xl leading-none"
        onAnimationEnd={(event) => {
          if (event.animationName === "am-word") fireSettled();
        }}
      >
        zKube
      </div>
    </div>
  );
}

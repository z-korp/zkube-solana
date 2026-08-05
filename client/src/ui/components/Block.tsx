import React, { useCallback, useEffect, useRef } from "react";
import type { OutcomeAnimation } from "./Grid";
import type { Block } from "@/types/types";

interface BlockProps {
  block: Block;
  gridSize: number;
  gridHeight?: number;
  isTxProcessing?: boolean;
  transitionDuration?: number;
  /**
   * True while the board is in a gravity/shift phase — the only time a block's
   * position change should tween. Passing this narrow boolean (instead of the
   * full GameState) means a non-gravity state change doesn't re-render all the
   * memoized blocks; they only re-render when the tween actually toggles.
   */
  isGravity?: boolean;
  isExploding?: boolean;
  /**
   * Delay before this block's clear vanish, matching the wipe's arrival at its
   * column so the row goes in sequence and its fragments take over on time.
   */
  explodeDelayMs?: number;
  /** Terminal board show this block takes part in (win/lose, see Grid). */
  outcome?: OutcomeAnimation | null;
  /** Stagger offset within the outcome show. */
  outcomeDelayMs?: number;
  /** Map of block width (1-4) → image URL */
  blockImages: Record<number, string>;
  onPointerDown?: (e: React.PointerEvent<SVGGElement>, block: Block) => void;
  onTransitionBlockStart?: (id: number) => void;
  onTransitionBlockEnd?: (id: number) => void;
}

const BlockContainer: React.FC<BlockProps> = ({
  block,
  gridSize,
  explodeDelayMs = 0,
  transitionDuration = 100,
  isTxProcessing = false,
  isGravity = false,
  isExploding = false,
  outcome = null,
  outcomeDelayMs = 0,
  blockImages,
  onPointerDown,
  onTransitionBlockStart,
  onTransitionBlockEnd,
}) => {
  const ref = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const onTransitionStart = (event: TransitionEvent) => {
      if (event.propertyName !== "transform") return;
      if (!isGravity) return;
      onTransitionBlockStart?.(block.id);
    };

    element.addEventListener("transitionstart", onTransitionStart);
    return () => {
      element?.removeEventListener("transitionstart", onTransitionStart);
    };
  }, [onTransitionBlockStart, isGravity, block.id]);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<SVGGElement>) => {
      if (e.propertyName !== "transform") return;
      onTransitionBlockEnd?.(block.id);
    },
    [onTransitionBlockEnd, block.id],
  );

  const x = block.x * gridSize;
  const y = block.y * gridSize;
  const w = block.width * gridSize;
  const h = gridSize;
  const imageUrl = blockImages[block.width] ?? "";

  return (
    <g
      ref={ref}
      className="svg-block"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: isGravity
          ? `transform ${transitionDuration / 1000}s linear`
          : "none",
        // Promote to a compositor layer only while it can move, so the fall
        // composites on the GPU instead of repainting the SVG each tick; drop
        // the layer at rest to avoid holding ~40 layers idle.
        willChange: isGravity ? "transform" : "auto",
        cursor: isTxProcessing ? "wait" : "grab",
      }}
      onPointerDown={(e) => onPointerDown?.(e, block)}
      onTransitionEnd={handleTransitionEnd}
    >
      {/* Inner group for explosion/outcome animations — doesn't conflict with
          the outer positioning translate */}
      <g
        className={
          isExploding
            ? "svg-block-exploding"
            : outcome === "win"
              ? "svg-block-detonate"
              : outcome === "lose-overflow"
                ? "svg-block-overflow"
                : outcome === "lose-sink"
                  ? "svg-block-sink"
                  : ""
        }
        style={{
          transformOrigin: `${w / 2}px ${h / 2}px`,
          ...(isExploding ? { animationDelay: `${explodeDelayMs}ms` } : {}),
          ...(outcome
            ? {
                animationDelay: `${outcomeDelayMs}ms`,
                // Eruption distances are per-block: each block must clear the
                // frame top from its own row, with deterministic drift/spin.
                ["--overflow-rise" as string]: `${-(block.y + 3) * gridSize}px`,
                ["--overflow-drift" as string]: `${((block.x % 3) - 1) * gridSize * 0.6}px`,
                ["--overflow-rot" as string]: `${((block.x * 13 + block.y * 7) % 30) - 15}deg`,
              }
            : {}),
        }}
      >
        <image
          href={imageUrl}
          x={0}
          y={0}
          width={w}
          height={h}
          preserveAspectRatio="none"
        />
      </g>
    </g>
  );
};

export default React.memo(BlockContainer);

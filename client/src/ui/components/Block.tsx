import React, { useCallback, useEffect, useRef } from "react";
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
  /** Map of block width (1-4) → image URL */
  blockImages: Record<number, string>;
  onPointerDown?: (
    e: React.PointerEvent<SVGGElement>,
    block: Block,
  ) => void;
  onTransitionBlockStart?: (id: number) => void;
  onTransitionBlockEnd?: (id: number) => void;
}

const BlockContainer: React.FC<BlockProps> = ({
  block,
  gridSize,
  transitionDuration = 100,
  isTxProcessing = false,
  isGravity = false,
  isExploding = false,
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
      {/* Inner group for explosion animation — doesn't conflict with outer translate */}
      <g
        className={isExploding ? "svg-block-exploding" : ""}
        style={{ transformOrigin: `${w / 2}px ${h / 2}px` }}
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

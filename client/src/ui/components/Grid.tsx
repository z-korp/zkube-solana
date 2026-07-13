/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import BlockContainer from "./Block";
import { GameState } from "@/enums/gameEnums";
import type { Block } from "@/types/types";
import {
  reconcileBlocksToGrid,
  removeCompleteRows,
  removeBlocksSameWidth,
  removeBlocksInRows,
  transformDataContractIntoBlock,
} from "@/utils/gridUtils";
import AnimatedText from "../elements/animatedText";
import { ComboMessages } from "@/enums/comboEnum";
import { motion } from "motion/react";
import { BonusType } from "@/chain/bonusTypes";
import { useMusicPlayer } from "@/contexts/hooks";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import { getThemeColors, getThemeImages, type ThemeId } from "@/config/themes";
import useGridAnimations from "@/hooks/useGridAnimations";
import { useMoveStore } from "@/stores/moveTxStore";
import { calculateFallDistance } from "@/utils/gridPhysics";
import useTransitionBlocks from "@/hooks/useTransitionBlocks";

export interface ReceiptProjection {
  blocks: number[][];
  nextRow: number[];
  over: boolean;
}

export interface GridProps {
  gameId: bigint;
  initialData: Block[];
  nextLineData: Block[];
  setNextLineHasBeenConsumed: React.Dispatch<React.SetStateAction<boolean>>;
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  bonus: BonusType;
  isTxProcessing: boolean;
  setIsTxProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  levelTransitionPending: boolean;
  onCascadeComplete?: () => void;
  onNextLineUpdate?: (nextRow: number[]) => void;
  onMove: (
    rowIndex: number,
    startIndex: number,
    finalIndex: number,
  ) => Promise<ReceiptProjection | void>;
  onBonus: (
    rowIndex: number,
    columnIndex: number,
  ) => Promise<ReceiptProjection | void>;
  onLocalGameOver?: () => void;
  themeId?: ThemeId;
}

const sameBlockGeometry = (a: Block[], b: Block[]): boolean => {
  if (a.length !== b.length) return false;
  const key = (blk: Block) => `${blk.x},${blk.y},${blk.width}`;
  const present = new Set(a.map(key));
  return b.every((blk) => present.has(key(blk)));
};

const Grid: React.FC<GridProps> = ({
  gameId,
  initialData,
  nextLineData,
  setNextLineHasBeenConsumed,
  gridHeight,
  gridWidth,
  gridSize,
  bonus,
  isTxProcessing,
  setIsTxProcessing,
  onCascadeComplete,
  onNextLineUpdate,
  onMove,
  onBonus,
  onLocalGameOver,
  themeId: themeIdOverride,
}) => {
  // ==================== Theme ====================
  const { themeTemplate } = useTheme();
  const activeThemeId = themeIdOverride ?? (themeTemplate as ThemeId);
  const themeColors = getThemeColors(activeThemeId);
  const themeImages = getThemeImages(activeThemeId);
  const blockImages = useMemo<Record<number, string>>(() => ({
    1: themeImages.block1,
    2: themeImages.block2,
    3: themeImages.block3,
    4: themeImages.block4,
  }), [themeImages]);

  // ==================== Refs ====================
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<Block | null>(null);
  const dragStartXRef = useRef(0);
  const initialXRef = useRef(0);
  const draggedXRef = useRef(0);
  const gameStateRef = useRef<GameState>(GameState.WAITING);
  const endDragRef = useRef<() => void>(() => undefined);

  // ==================== State ====================
  const [blocks, setBlocks] = useState<Block[]>(initialData);
  const [nextLine, setNextLine] = useState<Block[]>(nextLineData);
  const [saveGridStateblocks, setSaveGridStateblocks] = useState<Block[]>(initialData);
  const [isMoving, setIsMoving] = useState(true);
  const [currentMove, setcurrentMove] = useState<{
    rowIndex: number;
    startX: number;
    finalX: number;
  } | null>(null);
  const [gameState, setGameState] = useState<GameState>(GameState.WAITING);
  // 0 = safe, 1 = warning (row 1 occupied), 2 = critical (row 0 occupied)
  const [dangerLevel, setDangerLevel] = useState(0);
  const [lineExplodedCount, setLineExplodedCount] = useState(0);
  const [blockBonus, setBlockBonus] = useState<Block | null>(null);
  const [explodingRows, setExplodingRows] = useState<Set<number>>(new Set());
  const { playExplode, playSwipe, playSfx } = useMusicPlayer();

  // ==================== Custom Hooks ====================
  const queue = useMoveStore((state) => state.queue);
  const isQueueProcessing = useMoveStore((state) => state.isQueueProcessing);
  const { shouldBounce, animateText, resetAnimateText, setAnimateText } =
    useGridAnimations(lineExplodedCount);
  const {
    isTransitioning,
    handleTransitionBlockStart,
    handleTransitionBlockEnd,
  } = useTransitionBlocks();

  const queueForGame = useMemo(
    () => queue.filter((item) => item.gameId === gameId),
    [queue, gameId],
  );
  const nextQueuedMove = useMemo(
    () => queueForGame.find((item) => item.status === "queued"),
    [queueForGame],
  );

  // ==================== Constants ====================
  const gravitySpeed = 100;
  // Longer than the 100ms tick on purpose: the overlapping transitions blend
  // into a smooth continuous glide (a tick-matched 100ms is crisp but steppy).
  // The overlap is cheap now that falling blocks are GPU-promoted (Block.tsx).
  const transitionDuration = 300;

  // SVG dimensions
  const svgW = gridWidth * gridSize;
  const svgH = gridHeight * gridSize;
  // Frame padding
  const framePad = 9;
  const frameW = svgW + framePad * 2;
  const frameH = svgH + framePad * 2;
  // Total perimeter for stroke-dasharray
  const framePerimeter = 2 * (svgW + framePad * 2 - 16) + 2 * (svgH + framePad * 2 - 16); // approximate for rounded rect

  const resetDragRefs = useCallback(() => {
    draggingRef.current = null;
    dragStartXRef.current = 0;
    initialXRef.current = 0;
    draggedXRef.current = 0;
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // =================== Receipt-based sync (authoritative chain projections for moves/bonuses) ===================
  const pendingReceiptRef = useRef<ReceiptProjection | null>(null);

  const applyReceipt = (parsed: ReceiptProjection) => {
    const newNextLine = transformDataContractIntoBlock([parsed.nextRow]);
    // Update refs immediately (for pointer handler, before React re-renders)
    gameStateRef.current = GameState.WAITING;
    const authoritative = transformDataContractIntoBlock(parsed.blocks);
    setSaveGridStateblocks(authoritative);
    // The board is ALWAYS the chain's. reconcileBlocksToGrid rebuilds the board
    // from the authoritative grid but reuses existing block ids (matched by
    // column + width) so blocks that persisted animate to their new positions
    // and the freshly inserted floor row rises in — the client never computes
    // the resulting board, it only tweens toward the chain's. This makes the
    // visible board provably equal to the chain board, so the next drag can
    // never send coordinates the program rejects (InvalidMove / 6002).
    setBlocks((prev) => reconcileBlocksToGrid(prev, parsed.blocks));
    setNextLine(newNextLine);
    setGameState(GameState.WAITING);
    // Update the preview in GameBoard with the receipt's next line
    onNextLineUpdate?.(parsed.nextRow);
    setNextLineHasBeenConsumed(false);
    pendingReceiptRef.current = null;
    isTxProcessingRef.current = false;
    setIsTxProcessing(false);
  };

  // Recompute danger level whenever blocks change (covers initial load + chain sync + gravity)
  useEffect(() => {
    const hasCritical = blocks.some((b) => b.y === 0);
    const hasWarning = blocks.some((b) => b.y === 1);
    setDangerLevel(hasCritical ? 2 : hasWarning ? 1 : 0);
  }, [blocks]);

  // Idle-state resync from authoritative props. The receipt path covers the
  // normal move flow; this covers out-of-band chain updates reaching a
  // persistent Grid (e.g. a move whose VRF wait timed out client-side but
  // executed on-chain — the rollback restores a pre-move board that nothing
  // else would ever correct).
  useEffect(() => {
    if (gameStateRef.current !== GameState.WAITING) return;
    if (draggingRef.current) return;
    if (useMoveStore.getState().queue.some((m) => m.gameId === gameId)) return;
    setBlocks((prev) =>
      sameBlockGeometry(prev, initialData) ? prev : initialData,
    );
    setNextLine((prev) =>
      sameBlockGeometry(prev, nextLineData) ? prev : nextLineData,
    );
    setSaveGridStateblocks(initialData);
  }, [initialData, nextLineData, gameId]);

  // =================== DRAG & DROP ===================
  //
  // Convert screen clientX → grid cell X using SVG's getScreenCTM().
  // This handles all viewBox scaling automatically.

  // Mutable refs for stable callbacks
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const bonusRef = useRef(bonus);
  bonusRef.current = bonus;
  const isTxProcessingRef = useRef(isTxProcessing);
  isTxProcessingRef.current = isTxProcessing;

  /** Convert screen clientX to grid cell units (0-based, fractional) */
  const clientXToCellX = useCallback((clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const ctm = svg.getScreenCTM();
    if (!ctm) return 0;
    // Convert screen px → SVG viewBox units, subtract frame padding, divide by cell size
    const svgX = (clientX - ctm.e) / ctm.a;
    return (svgX - framePad) / gridSize;
  }, [framePad, gridSize]);

  /** Check if moving a block from initialX to newX is blocked by another block in the same row */
  const checkBlocked = useCallback((initialX: number, newX: number, y: number, width: number, blockId: number): boolean => {
    const currentBlocks = blocksRef.current;
    const rowBlocks = currentBlocks.filter(b => b.y === y);

    if (newX > initialX) {
      // Moving right: check if any block sits between old right edge and new right edge
      for (const b of rowBlocks) {
        if (b.id !== blockId && b.x >= initialX + width && b.x < newX + width) return true;
      }
    } else {
      // Moving left: check if any block's right edge is past our new left edge
      for (const b of rowBlocks) {
        if (b.id !== blockId && b.x + b.width > newX && b.x <= initialX) return true;
      }
    }
    return false;
  }, []);

  const onDragMove = useCallback((clientX: number) => {
    const dragging = draggingRef.current;
    if (!dragging) return;
    if (gameStateRef.current !== GameState.DRAGGING) return;

    const cellX = clientXToCellX(clientX);
    const delta = cellX - dragStartXRef.current;
    const newX = initialXRef.current + delta;
    const bounded = Math.max(0, Math.min(gridWidth - dragging.width, newX));

    if (!checkBlocked(initialXRef.current, bounded, dragging.y, dragging.width, dragging.id)) {
      draggedXRef.current = bounded;
      setBlocks((prev) =>
        prev.map((b) => b.id === dragging.id ? { ...b, x: bounded } : b),
      );
    }
  }, [clientXToCellX, gridWidth, checkBlocked]);

  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;

  const onDragStart = useCallback((clientX: number, block: Block) => {
    draggingRef.current = block;
    dragStartXRef.current = clientXToCellX(clientX);
    initialXRef.current = block.x;
    draggedXRef.current = block.x;
    gameStateRef.current = GameState.DRAGGING;
    setGameState(GameState.DRAGGING);
  }, [clientXToCellX]);

  const onDragEnd = useCallback(() => {
    const dragging = draggingRef.current;
    if (!dragging) return;

    if (gameStateRef.current !== GameState.DRAGGING) {
      resetDragRefs();
      return;
    }

    const startX = initialXRef.current;
    const finalX = Math.round(draggedXRef.current);
    const hasMoved = Math.trunc(finalX) !== Math.trunc(startX);

    setBlocks((prev) =>
      prev.map((b) => b.id === dragging.id ? { ...b, x: hasMoved ? finalX : startX } : b),
    );

    if (hasMoved) {
      setcurrentMove({ rowIndex: dragging.y, startX, finalX });
      setIsMoving(true);
      gameStateRef.current = GameState.GRAVITY;
      setGameState(GameState.GRAVITY);
    } else {
      setcurrentMove(null);
      setIsMoving(false);
      gameStateRef.current = GameState.WAITING;
      setGameState(GameState.WAITING);
    }

    resetDragRefs();
  }, [resetDragRefs]);

  const handlePointerDown = useCallback((e: React.PointerEvent<SVGGElement>, block: Block) => {
    if (gameStateRef.current !== GameState.WAITING || isTxProcessingRef.current) return;

    const currentBonus = bonusRef.current;
    const currentBlocks = blocksRef.current;

    // Grid bonuses: Hammer, Totem, Wave
    if (currentBonus === BonusType.Hammer) {
      setBlockBonus(block);
      setBlocks(currentBlocks.filter((b) => !(b.x === block.x && b.y === block.y)));
    } else if (currentBonus === BonusType.Totem) {
      setBlockBonus(block);
      setBlocks(removeBlocksSameWidth(block, currentBlocks));
    } else if (currentBonus === BonusType.Wave) {
      setBlockBonus(block);
      const rows: number[] = [block.y];
      setBlocks(removeBlocksInRows(rows, currentBlocks));
    }

    if (currentBonus === BonusType.Hammer || currentBonus === BonusType.Totem || currentBonus === BonusType.Wave) {
      setIsTxProcessing(true);
      setIsMoving(true);
      setGameState(GameState.GRAVITY_BONUS);
      return;
    }

    onDragStart(e.clientX, block);
  }, [onDragStart, setIsTxProcessing]);

  // Stable callback refs — identity never changes so Block's React.memo works.
  const handlePointerDownRef = useRef(handlePointerDown);
  handlePointerDownRef.current = handlePointerDown;
  const stablePointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, block: Block) => handlePointerDownRef.current(e, block), [],
  );

  const handleTransitionStartRef = useRef(handleTransitionBlockStart);
  handleTransitionStartRef.current = handleTransitionBlockStart;
  const stableTransitionStart = useCallback((id: number) => handleTransitionStartRef.current(id), []);

  const handleTransitionEndRef = useRef(handleTransitionBlockEnd);
  handleTransitionEndRef.current = handleTransitionBlockEnd;
  const stableTransitionEnd = useCallback((id: number) => handleTransitionEndRef.current(id), []);

  // Document-level listeners for move and end (works outside SVG bounds)
  useEffect(() => {
    const move = (e: PointerEvent) => onDragMoveRef.current(e.clientX);
    const end = () => endDragRef.current();
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };
  }, []);

  useEffect(() => {
    endDragRef.current = onDragEnd;
  }, [onDragEnd]);

  // =================== TX HELPERS ===================

  // A move/bonus that failed to confirm most often TIMED OUT while the move
  // actually executed on-chain (full VRF round-trip). Snapping to a local
  // pre-move snapshot would show a stale, wrong board. Instead just unlock and
  // let the idle-resync effect pull the authoritative board — which reflects
  // reality whether the action landed or genuinely failed.
  const recoverMoveFailure = useCallback(
    (message: string) => {
      setLineExplodedCount(0);
      setcurrentMove(null);
      resetDragRefs();
      setIsMoving(false);
      setExplodingRows(new Set());
      setBlockBonus(null);
      gameStateRef.current = GameState.WAITING;
      setGameState(GameState.WAITING);
      setIsTxProcessing(false);
      isTxProcessingRef.current = false;
      toast.error(message);
    },
    [resetDragRefs, setIsTxProcessing],
  );

  const triggerLocalGameOver = useCallback(() => {
    pendingReceiptRef.current = null;
    useMoveStore.getState().clearQueueForGame(gameId);
    setcurrentMove(null);
    setIsMoving(false);
    gameStateRef.current = GameState.CASCADE_COMPLETE;
    setGameState(GameState.CASCADE_COMPLETE);
    isTxProcessingRef.current = false;
    setIsTxProcessing(false);
    onLocalGameOver?.();
  }, [gameId, onLocalGameOver, setIsTxProcessing]);

  // =================== MOVE TX ===================

  const sendMoveTX = useCallback(
    async (rowIndex: number, startColIndex: number, finalColIndex: number) => {
      if (startColIndex === finalColIndex) return;
      playSwipe();
      useMoveStore.getState().enqueueMove({
        gameId,
        rowIndex: gridHeight - 1 - rowIndex,
        startIndex: Math.trunc(startColIndex),
        finalIndex: Math.trunc(finalColIndex),
      });
    },
    [gameId, gridHeight, playSwipe],
  );

  // Unmount-only flag. The drain effect's own cleanup fires on every dep
  // change (markSubmitting mutates the queue synchronously), so an
  // effect-scoped `cancelled` flag is already true by the time the tx
  // settles — the failure branch must key off real unmount instead.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!nextQueuedMove || isQueueProcessing) return;

    const processQueuedMove = async () => {
      const store = useMoveStore.getState();
      const stillQueued = store.queue.some(
        (item) => item.id === nextQueuedMove.id && item.status === "queued",
      );
      if (!stillQueued || store.isQueueProcessing) return;
      store.setQueueProcessing(true);
      store.markSubmitting(nextQueuedMove.id);

      try {
        const solanaState = await onMove(
          nextQueuedMove.rowIndex,
          nextQueuedMove.startIndex,
          nextQueuedMove.finalIndex,
        );
        store.markConfirmed(nextQueuedMove.id);
        if (solanaState) {
          if (gameStateRef.current === GameState.CASCADE_COMPLETE) {
            applyReceipt(solanaState);
            onCascadeComplete?.();
          } else {
            pendingReceiptRef.current = solanaState;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Move transaction failed.";
        store.markFailed(nextQueuedMove.id, message);
        store.clearQueueForGame(gameId);
        if (!unmountedRef.current) {
          recoverMoveFailure("Move failed to confirm — syncing with the chain…");
        }
      } finally {
        store.setQueueProcessing(false);
      }
    };

    processQueuedMove();
  }, [nextQueuedMove, isQueueProcessing, gameId, resetDragRefs, setIsTxProcessing]);

  useEffect(() => {
    if (currentMove) {
      const { rowIndex, startX, finalX } = currentMove;
      sendMoveTX(rowIndex, startX, finalX);
    }
  }, [currentMove]);

  // =================== BONUS TX ===================

  const fireBonusTx = useCallback(
    async (block: Block) => {
      try {
        const state = await onBonus(gridHeight - 1 - block.y, block.x);
        if (state) {
          if (gameStateRef.current === GameState.CASCADE_COMPLETE) {
            applyReceipt(state);
            onCascadeComplete?.();
          } else pendingReceiptRef.current = state;
        }
        playSfx("bonus-activate");
      } catch {
        recoverMoveFailure("Bonus failed to confirm — syncing with the chain…");
      }
    },
    [gridHeight, onBonus, playSfx, saveGridStateblocks, nextLineData, setIsTxProcessing],
  );

  // =================== GAME LOGIC ===================

  const applyGravity = () => {
    setBlocks((prevBlocks) => {
      let anyChanged = false;
      const newBlocks = prevBlocks.map((block) => {
        const fallDistance = calculateFallDistance(block, prevBlocks, gridHeight);
        if (fallDistance > 0) {
          anyChanged = true;
          return { ...block, y: block.y + 1 };
        }
        return block;
      });
      setIsMoving(anyChanged);
      return anyChanged ? newBlocks : prevBlocks;
    });
  };

  const explosionAnimDuration = 250;

  const clearCompleteLine = (newGravityState: GameState, newStateOnComplete: GameState) => {
    const { updatedBlocks, completeRows } = removeCompleteRows(blocks, gridWidth, gridHeight);

    if (updatedBlocks.length < blocks.length) {
      playExplode();
      setLineExplodedCount(lineExplodedCount + completeRows.length);
      setExplodingRows(new Set(completeRows));

      setTimeout(() => {
        setExplodingRows(new Set());
        setBlocks(updatedBlocks);
        setIsMoving(true);
        setGameState(newGravityState);
      }, explosionAnimDuration);
    } else {
      setGameState(newStateOnComplete);
    }
  };

  // STATE MACHINE
  useEffect(() => {
    let rafId: number | null = null;
    const applyGravityWithRAF = () => {
      // Start from now so the first tick waits gravitySpeed ms —
      // this gives CSS transitions time to start and fire transitionstart
      // events before we check isTransitioning.
      let lastTick = performance.now();
      const step = (timestamp: number) => {
        if (timestamp - lastTick >= gravitySpeed) {
          lastTick = timestamp;
          applyGravity();
        }
        rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    };

    switch (gameState) {
      case GameState.GRAVITY:
      case GameState.GRAVITY2:
      case GameState.GRAVITY_BONUS:
        if (!isMoving && !isTransitioning) {
          switch (gameState) {
            case GameState.GRAVITY: setGameState(GameState.LINE_CLEAR); break;
            case GameState.GRAVITY2: setGameState(GameState.LINE_CLEAR2); break;
            case GameState.GRAVITY_BONUS: setGameState(GameState.LINE_CLEAR_BONUS); break;
          }
        } else {
          applyGravityWithRAF();
        }
        break;

      case GameState.ADD_LINE:
        if (isTransitioning) break;
        if (!currentMove) {
          setIsMoving(false);
          setGameState(GameState.WAITING);
          break;
        }
        {
          const { startX, finalX } = currentMove;
          if (startX === finalX) {
            setcurrentMove(null);
            setIsMoving(false);
            setGameState(GameState.WAITING);
            break;
          }
          // Grid full after shift? (any block at y=0 would go to y=-1)
          if (blocks.some(b => b.y === 0)) {
            if (onLocalGameOver) {
              triggerLocalGameOver();
              break;
            }
            setGameState(GameState.UPDATE_AFTER_MOVE);
            break;
          }
          // No next line available (e.g. remount while the VRF row was in
          // flight) — skip the insert; the receipt will reconcile the board.
          if (nextLine.length === 0) {
            setGameState(GameState.UPDATE_AFTER_MOVE);
            break;
          }
          // Phase 1: Place next-line blocks off-screen (y=gridHeight, clipped by SVG)
          setBlocks(prev => [
            ...prev,
            ...nextLine.map(b => ({ ...b, y: gridHeight })),
          ]);
          setNextLineHasBeenConsumed(true);
          setGameState(GameState.ADD_LINE_SHIFT);
        }
        break;

      case GameState.ADD_LINE_SHIFT:
        {
          const needsShift = blocks.some(b => b.y >= gridHeight);
          if (needsShift) {
            // Phase 2: Shift ALL blocks up by 1 — CSS transitions animate the push.
            // Go straight to GRAVITY2 so gravity applies concurrently with the
            // shift animation (blocks settle while sliding up).
            setBlocks(prev => prev.map(b => ({ ...b, y: b.y - 1 })));
            setIsMoving(true);
            setGameState(GameState.GRAVITY2);
          } else {
            // Nothing was inserted — without this escape the machine parks
            // here forever (input stays locked).
            setIsMoving(false);
            setGameState(GameState.UPDATE_AFTER_MOVE);
          }
        }
        break;

      case GameState.LINE_CLEAR:
        // Once the swipe settles, animate the next-row insertion locally
        // (ADD_LINE → ADD_LINE_SHIFT → GRAVITY2 → LINE_CLEAR2): the new floor
        // row rises in and the stack shifts up, all tweened. The engine now
        // matches the client, so this local cascade reaches the same board the
        // chain does — applyReceipt's reconcileBlocksToGrid is then a visual
        // no-op safety net (any rare residual diff self-corrects there while
        // input is still locked, so it can never produce an InvalidMove/6002).
        clearCompleteLine(GameState.GRAVITY, GameState.ADD_LINE);
        break;
      case GameState.LINE_CLEAR2:
        clearCompleteLine(GameState.GRAVITY2, GameState.UPDATE_AFTER_MOVE);
        break;
      case GameState.LINE_CLEAR_BONUS:
        clearCompleteLine(GameState.GRAVITY_BONUS, GameState.UPDATE_AFTER_BONUS);
        break;

      case GameState.UPDATE_AFTER_BONUS:
      case GameState.UPDATE_AFTER_MOVE:
        {
          if (lineExplodedCount > 1) {
            setAnimateText(Object.values(ComboMessages)[lineExplodedCount]);
          }
          setLineExplodedCount(0);

          if (gameState === GameState.UPDATE_AFTER_BONUS) {
            fireBonusTx(blockBonus as Block);
            setBlockBonus(null);
            setIsTxProcessing(true);
            gameStateRef.current = GameState.CASCADE_COMPLETE;
            setGameState(GameState.CASCADE_COMPLETE);
          } else if (gameState === GameState.UPDATE_AFTER_MOVE) {
            setcurrentMove(null);
            // Check if receipt already arrived while cascade was playing
            if (pendingReceiptRef.current) {
              applyReceipt(pendingReceiptRef.current);
              onCascadeComplete?.();
            } else {
              setIsTxProcessing(true);
              gameStateRef.current = GameState.CASCADE_COMPLETE;
              setGameState(GameState.CASCADE_COMPLETE);
            }
          }
        }
        break;
      case GameState.CASCADE_COMPLETE:
        if (pendingReceiptRef.current) {
          applyReceipt(pendingReceiptRef.current);
          onCascadeComplete?.();
        }
        break;
      default:
        break;
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [gameState, isMoving, isTransitioning, onLocalGameOver, triggerLocalGameOver]);

  // =================== RENDER ===================

  // Shared across all blocks — the only phases where a position change tweens.
  const blocksAreFalling =
    gameState === GameState.GRAVITY ||
    gameState === GameState.GRAVITY2 ||
    gameState === GameState.GRAVITY_BONUS ||
    gameState === GameState.ADD_LINE_SHIFT;

  return (
    <motion.div
      animate={shouldBounce ? { scale: [1, 1.1, 1, 1.1, 1] } : {}}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="relative"
      style={{ width: frameW, height: frameH }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${frameW} ${frameH}`}
        width={frameW}
        height={frameH}
        className="touch-none"
        style={{ cursor: isTxProcessing ? "wait" : "default" }}
      >
        <defs>
          {/* Frame border gradient */}
          <linearGradient id="gf-border" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C9A96E" stopOpacity="0.5" />
            <stop offset="20%" stopColor="#8B7355" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#6B5B3E" stopOpacity="0.2" />
            <stop offset="80%" stopColor="#8B7355" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#C9A96E" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="gf-inner" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.06" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.06" />
          </linearGradient>
          <filter id="gf-shadow" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.4" />
          </filter>
          {/* Clip grid area so blocks sliding in/out are hidden beyond edges */}
          <clipPath id="grid-clip">
            <rect x={0} y={0} width={svgW} height={svgH} />
          </clipPath>
        </defs>

        {/* ─── Frame border ─── */}
        <rect
          x={1} y={1}
          width={frameW - 2} height={frameH - 2}
          rx={8} ry={8}
          fill="none" stroke="url(#gf-border)" strokeWidth={2}
          filter="url(#gf-shadow)"
        />
        <rect
          x={3} y={3}
          width={frameW - 6} height={frameH - 6}
          rx={6} ry={6}
          fill="none" stroke="url(#gf-inner)" strokeWidth={1}
        />

        {/* ─── Loading animation (rotating sweep, like old conic-gradient) ─── */}
        {isTxProcessing && (
          <rect
            x={1} y={1}
            width={frameW - 2} height={frameH - 2}
            rx={8} ry={8}
            fill="none"
            stroke={themeColors.accent}
            strokeWidth={5}
            strokeDasharray={`${framePerimeter * 0.15} ${framePerimeter * 0.85}`}
            className="svg-loading-border"
            strokeLinecap="round"
            style={{ ["--perimeter" as string]: framePerimeter }}
          />
        )}

        {/* ─── Danger border pulse + grid overlay ─── */}
        {dangerLevel > 0 && (
          <>
            <rect
              x={1} y={1}
              width={frameW - 2} height={frameH - 2}
              rx={8} ry={8}
              fill="none"
              stroke={dangerLevel === 2 ? "rgb(209, 18, 28)" : "rgb(255, 100, 80)"}
              strokeWidth={dangerLevel === 2 ? 4 : 3}
              className={dangerLevel === 2 ? "svg-danger-border-critical" : "svg-danger-border-warning"}
            />
            <rect
              x={1} y={1}
              width={frameW - 2} height={frameH - 2}
              rx={8} ry={8}
              fill={dangerLevel === 2 ? "rgb(209, 18, 28)" : "rgb(255, 100, 80)"}
              stroke="none"
              className={dangerLevel === 2 ? "svg-danger-fill-critical" : "svg-danger-fill-warning"}
              pointerEvents="none"
            />
          </>
        )}

        {/* ─── Grid area (offset by frame padding, clipped for push animation) ─── */}
        <g transform={`translate(${framePad}, ${framePad})`} clipPath="url(#grid-clip)">
          {/* Grid lines */}
          {Array.from({ length: gridWidth + 1 }, (_, i) => (
            <line
              key={`v${i}`}
              x1={i * gridSize} y1={0}
              x2={i * gridSize} y2={svgH}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1}
            />
          ))}
          {Array.from({ length: gridHeight + 1 }, (_, i) => (
            <line
              key={`h${i}`}
              x1={0} y1={i * gridSize}
              x2={svgW} y2={i * gridSize}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1}
            />
          ))}


          {/* Blocks */}
          {blocks.map((block) => (
            <BlockContainer
              key={block.id}
              block={block}
              gridSize={gridSize}
              gridHeight={gridHeight}
              isTxProcessing={isTxProcessing}
              transitionDuration={transitionDuration}
              isGravity={blocksAreFalling}
              isExploding={explodingRows.has(block.y)}
              blockImages={blockImages}
              onPointerDown={stablePointerDown}
              onTransitionBlockStart={stableTransitionStart}
              onTransitionBlockEnd={stableTransitionEnd}
            />
          ))}
        </g>
      </svg>

      {/* Combo text overlay (HTML — complex text effects) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
        <AnimatedText textEnum={animateText} reset={resetAnimateText} />
      </div>
    </motion.div>
  );
};

export default Grid;

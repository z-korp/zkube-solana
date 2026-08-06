import React, { type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useDragControls } from "motion/react";

import { cn } from "@/ui/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name when the sheet renders its own visual header. */
  srTitle?: string;
  /** When false, backdrop tap, Escape, and the drag handle no longer dismiss. */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Mobile-first bottom sheet: slides up from the bottom edge on phones and
 * centers as a dialog on md+. Portals to document.body so it is immune to the
 * PageNavigator slide transform (a `fixed` overlay rendered inside the page
 * subtree would move with the page while a transition is in flight).
 */
const Sheet: React.FC<SheetProps> = ({
  open,
  onClose,
  title,
  srTitle,
  dismissible = true,
  children,
  className,
}) => {
  const dragControls = useDragControls();

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={
            dismissible ? undefined : (event) => event.preventDefault()
          }
          onPointerDownOutside={
            dismissible ? undefined : (event) => event.preventDefault()
          }
          onInteractOutside={
            dismissible ? undefined : (event) => event.preventDefault()
          }
          className={cn(
            "fixed inset-x-0 bottom-0 z-[1000] mx-auto w-full max-w-[560px] rounded-t-3xl border border-white/[0.16] bg-slate-950/95 shadow-[0_-24px_60px_rgba(0,0,0,0.55)] outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom",
            "md:inset-x-auto md:bottom-auto md:left-[50%] md:top-[50%] md:max-w-[480px] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-3xl",
            "md:data-[state=open]:zoom-in-95 md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%] md:data-[state=closed]:zoom-out-95 md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%]",
            className,
          )}
        >
          <motion.div
            drag={dismissible ? "y" : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (dismissible && (info.offset.y > 90 || info.velocity.y > 500)) {
                onClose();
              }
            }}
            className="flex max-h-[min(80vh,640px)] flex-col"
          >
            <button
              type="button"
              aria-label="Close"
              disabled={!dismissible}
              onPointerDown={(event) => {
                if (dismissible) dragControls.start(event);
              }}
              onClick={() => {
                if (dismissible) onClose();
              }}
              className="flex w-full touch-none items-center justify-center pb-2 pt-3"
            >
              <span className="h-1.5 w-10 rounded-full bg-white/25" />
            </button>
            {title !== undefined ? (
              <DialogPrimitive.Title className="px-5 pb-3 text-center font-display text-xl font-bold tracking-wide text-white">
                {title}
              </DialogPrimitive.Title>
            ) : (
              <DialogPrimitive.Title className="sr-only">
                {srTitle ?? "Sheet"}
              </DialogPrimitive.Title>
            )}
            <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6">
              {children}
            </div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default Sheet;

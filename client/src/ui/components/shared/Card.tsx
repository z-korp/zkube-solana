import React, { forwardRef } from "react";

import { cn } from "@/ui/utils";

type CardTone = "default" | "raised" | "subtle";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  as?: "div" | "section";
}

const TONE_CLASSES: Record<CardTone, string> = {
  default: "border-white/[0.1] bg-white/[0.05]",
  raised: "border-white/[0.16] bg-white/[0.1] shadow-lg shadow-black/20",
  subtle: "border-white/[0.08] bg-white/[0.04]",
};

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ tone = "default", as: Tag = "div", className, ...props }, ref) => (
    <Tag
      ref={ref}
      className={cn(
        "rounded-2xl border backdrop-blur-xl",
        TONE_CLASSES[tone],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export default Card;

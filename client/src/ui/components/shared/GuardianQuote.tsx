import type { useGuardianTalk } from "@/ui/components/shared/useGuardianTalk";

type Talk = ReturnType<typeof useGuardianTalk>;

/** The bouncing typewriter caret shown while a guardian line is typing. */
export const TalkCaret: React.FC<{ talk: Talk }> = ({ talk }) =>
  talk.typing ? (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-yellow-400 align-middle"
    />
  ) : null;

interface GuardianQuoteProps {
  talk: Talk;
  className?: string;
  /** Wrap the line in typographic quotes (the dialog-panel convention). */
  quoted?: boolean;
}

/**
 * A typed guardian line: pre-sliced text from useGuardianTalk, the shared
 * caret, and tap-to-skip while typing. Reserve line height via className
 * (min-h-…) so the panel doesn't reflow as text arrives.
 */
const GuardianQuote: React.FC<GuardianQuoteProps> = ({
  talk,
  className,
  quoted = false,
}) => (
  <p className={className} onClick={talk.typing ? talk.skip : undefined}>
    {quoted ? <>&quot;{talk.text}&quot;</> : talk.text}
    <TalkCaret talk={talk} />
  </p>
);

export default GuardianQuote;

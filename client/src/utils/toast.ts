import { toast } from "sonner";

const shortenSignature = (signature: string): string =>
  signature.length > 12
    ? `${signature.slice(0, 4)}…${signature.slice(-4)}`
    : signature;

export const isMdOrLarger = (): boolean =>
  window.matchMedia("(min-width: 768px)").matches;

export const isSmallHeight = (): boolean =>
  window.matchMedia("(max-height: 768px)").matches;

export const getUrl = (signature: string): string =>
  `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;

export const getToastAction = (signature: string) => ({
  label: "View",
  onClick: () => window.open(getUrl(signature), "_blank", "noopener,noreferrer"),
});

export const getToastPlacement = ():
  | "top-center"
  | "bottom-center"
  | "bottom-right" =>
  isMdOrLarger() ? "bottom-right" : "bottom-center";

export function extractErrorMessages(errorString: string): string[] {
  const matches = errorString.match(/Error message:(.*?)(?=\n|$)/gs);
  return matches
    ? matches.map((match) => match.replace("Error message:", "").trim())
    : [errorString.trim()];
}

export const extractedMessage = (message: string): string => {
  const errorMessages = extractErrorMessages(message);
  return errorMessages[0] || message;
};

interface ShowToastOptions {
  message: string;
  txHash?: string;
  description?: string;
  type?: "loading" | "success" | "error";
  toastId?: string;
  durationMs?: number;
}

export const showToast = ({
  message,
  txHash,
  description,
  type = "loading",
  toastId = "transaction-toast",
  durationMs,
}: ShowToastOptions): void => {
  const options = {
    id: toastId,
    description: description ?? (txHash ? shortenSignature(txHash) : undefined),
    action: txHash ? getToastAction(txHash) : undefined,
    position: getToastPlacement(),
    duration: durationMs,
  };

  if (type === "success") toast.success(message, options);
  else if (type === "error") toast.error(message, options);
  else toast.loading(message, { ...options, duration: durationMs ?? 5000 });
};

export const normalizeErrorMessage = (raw: string): string => {
  const message = extractedMessage(raw).trim();
  if (!message) return "Something went wrong.";

  const lower = message.toLowerCase();
  if (
    lower.includes("user aborted") ||
    lower.includes("user rejected") ||
    lower.includes("transaction rejected") ||
    lower.includes("request rejected")
  ) {
    return "Transaction cancelled.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Transaction timed out. Network may be slow.";
  }
  if (lower.includes("insufficient") && lower.includes("balance")) {
    return "Insufficient balance for this action.";
  }
  return message;
};

export const deriveUserFacingErrorMessage = (
  error: unknown,
  fallback = "Transaction failed.",
): string => {
  if (error instanceof Error) {
    return normalizeErrorMessage(error.message || fallback);
  }
  if (typeof error === "string") return normalizeErrorMessage(error);
  if (error && typeof error === "object" && "message" in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return normalizeErrorMessage(maybeMessage);
  }
  return fallback;
};

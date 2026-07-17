import { toast } from "sonner";

import { truncatePublicKey } from "./solanaDisplay";

const isMdOrLarger = (): boolean =>
  window.matchMedia("(min-width: 768px)").matches;

const getUrl = (signature: string): string =>
  `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;

const getToastAction = (signature: string) => ({
  label: "View",
  onClick: () => window.open(getUrl(signature), "_blank", "noopener,noreferrer"),
});

export const getToastPlacement = ():
  | "top-center"
  | "bottom-center"
  | "bottom-right" =>
  isMdOrLarger() ? "bottom-right" : "bottom-center";

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
    description: description ?? (txHash ? truncatePublicKey(txHash) : undefined),
    action: txHash ? getToastAction(txHash) : undefined,
    position: getToastPlacement(),
    duration: durationMs,
  };

  if (type === "success") toast.success(message, options);
  else if (type === "error") toast.error(message, options);
  else toast.loading(message, { ...options, duration: durationMs ?? 5000 });
};

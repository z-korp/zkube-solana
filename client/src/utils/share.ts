/**
 * "Share a win" helper. Prefers the Web Share API so mobile players get the
 * native share sheet, and otherwise copies the same content to the clipboard
 * so it can be pasted anywhere. Pure client, no backend, no analytics — the
 * caller supplies fully-formed honest content.
 */
export type ShareOutcome = "shared" | "copied" | "cancelled" | "unavailable";

export interface ShareContent {
  /** Human-readable line describing the win. Always present. */
  text: string;
  /** Optional spectator deep-link the app already resolves via `?player=`. */
  url?: string;
}

/**
 * Share via `navigator.share` when available; otherwise fall back to
 * `navigator.clipboard.writeText`. Returns which path ran so the caller can
 * show a brief "Copied!" confirmation only when the clipboard path was used.
 * A dismissed native sheet is reported as `"cancelled"`, never a failure.
 */
export async function shareOrCopyWin(
  content: ShareContent,
): Promise<ShareOutcome> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const { text, url } = content;

  if (nav && typeof nav.share === "function") {
    try {
      await nav.share(url ? { text, url } : { text });
      return "shared";
    } catch (error) {
      // The player dismissing the native sheet is not a failure — stay quiet.
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Any other Web Share failure falls through to the clipboard path.
    }
  }

  if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
    await nav.clipboard.writeText(url ? `${text}\n${url}` : text);
    return "copied";
  }

  return "unavailable";
}

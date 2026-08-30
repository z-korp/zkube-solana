/**
 * DEV-ONLY wallet-bypass flag.
 *
 * SAFETY: the entire harness is gated on `import.meta.env.DEV`, which Vite
 * statically replaces with the literal `false` in a production `vite build`.
 * Every consumer guards with `import.meta.env.DEV && DEV_BYPASS_ACTIVE`, so in
 * production the branch folds to `false`, the guarded code (and this module,
 * plus everything under `src/dev/`) is dead-code-eliminated, and there is no
 * runtime path — query param or localStorage — that can activate the bypass.
 *
 * Opt-in on the dev server by appending `?dev=1` to the URL. The choice is
 * persisted to localStorage under `zkube:dev-bypass` and honoured on later
 * loads; `?dev=0` clears it. Without the opt-in the dev server behaves exactly
 * like production and shows the real ConnectScreen.
 */
const DEV_BYPASS_STORAGE_KEY = "zkube:dev-bypass";

function resolveDevBypass(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flag = new URLSearchParams(window.location.search).get("dev");
    if (flag === "1") {
      window.localStorage.setItem(DEV_BYPASS_STORAGE_KEY, "1");
      return true;
    }
    if (flag === "0") {
      window.localStorage.removeItem(DEV_BYPASS_STORAGE_KEY);
      return false;
    }
    return window.localStorage.getItem(DEV_BYPASS_STORAGE_KEY) === "1";
  } catch {
    // A sandboxed / storage-denied context is never a reason to bypass.
    return false;
  }
}

/**
 * True only on the dev server AND with the explicit opt-in present. Evaluated
 * once at module load; the leading `import.meta.env.DEV` short-circuits so the
 * runtime resolver never runs — and this constant folds to `false` — in a
 * production build.
 */
export const DEV_BYPASS_ACTIVE: boolean =
  import.meta.env.DEV && resolveDevBypass();

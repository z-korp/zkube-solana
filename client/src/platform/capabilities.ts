export type PlatformKind =
  | "desktop"
  | "android-browser"
  | "android-pwa"
  | "twa"
  | "ios"
  | "unknown";

export interface PlatformEnvironment {
  userAgent: string;
  navigatorPlatform: string;
  maxTouchPoints: number;
  secureContext: boolean;
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
  referrer: string;
}

export type MobileWalletAdapterSupportReason =
  | "available"
  | "not-android"
  | "insecure-context"
  | "unsupported-android-webview";

export interface PlatformCapabilities {
  kind: PlatformKind;
  secureContext: boolean;
  displayModeStandalone: boolean;
  twaSignal: boolean;
  androidWebView: boolean;
  solanaMobileWebShell: boolean;
  mobileWalletAdapterSupported: boolean;
  mobileWalletAdapterSupportReason: MobileWalletAdapterSupportReason;
}

const ANDROID_APP_REFERRER = /^android-app:\/\/[a-z0-9_.]+\/?$/i;
// Keep these predicates aligned with wallet-standard-mobile@0.5.3. That
// package silently declines local MWA registration in a generic Android
// WebView, but explicitly permits Solana Mobile WebShell.
const ANDROID_WEBVIEW =
  /(WebView|Version\/.+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+)|; wv\).+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+))/i;
const SOLANA_MOBILE_WEB_SHELL = "Solana Mobile Web Shell";

/**
 * Classifies only observable browser capabilities. TWA detection deliberately
 * requires Android, standalone display mode, and an android-app referrer so a
 * normal Android browser or installed PWA is never promoted on user agent
 * alone.
 */
export function classifyPlatform(
  environment: PlatformEnvironment,
): PlatformKind {
  const android = /Android/i.test(environment.userAgent);
  if (android) {
    if (hasConservativeTwaSignal(environment)) return "twa";
    return environment.displayModeStandalone
      ? "android-pwa"
      : "android-browser";
  }

  if (
    /iPad|iPhone|iPod/i.test(environment.userAgent) ||
    (environment.navigatorPlatform === "MacIntel" &&
      environment.maxTouchPoints > 1)
  ) {
    return "ios";
  }

  if (/Windows NT|Macintosh|CrOS|X11|Linux/i.test(environment.userAgent)) {
    return "desktop";
  }

  return "unknown";
}

export function hasConservativeTwaSignal(
  environment: PlatformEnvironment,
): boolean {
  return (
    /Android/i.test(environment.userAgent) &&
    environment.displayModeStandalone &&
    ANDROID_APP_REFERRER.test(environment.referrer)
  );
}

export function mobileWalletAdapterSupportReason(
  environment: PlatformEnvironment,
): MobileWalletAdapterSupportReason {
  if (!/Android/i.test(environment.userAgent)) return "not-android";
  if (!environment.secureContext) return "insecure-context";
  if (
    isAndroidWebView(environment.userAgent) &&
    !isSolanaMobileWebShell(environment.userAgent)
  ) {
    return "unsupported-android-webview";
  }
  return "available";
}

export function isAndroidWebView(userAgent: string): boolean {
  return /Android/i.test(userAgent) && ANDROID_WEBVIEW.test(userAgent);
}

export function isSolanaMobileWebShell(userAgent: string): boolean {
  return userAgent.includes(SOLANA_MOBILE_WEB_SHELL);
}

export function platformCapabilities(
  environment: PlatformEnvironment,
): PlatformCapabilities {
  const kind = classifyPlatform(environment);
  const supportReason = mobileWalletAdapterSupportReason(environment);
  return {
    kind,
    secureContext: environment.secureContext,
    displayModeStandalone: environment.displayModeStandalone,
    twaSignal: hasConservativeTwaSignal(environment),
    androidWebView: isAndroidWebView(environment.userAgent),
    solanaMobileWebShell: isSolanaMobileWebShell(environment.userAgent),
    mobileWalletAdapterSupported: supportReason === "available",
    mobileWalletAdapterSupportReason: supportReason,
  };
}

export function readPlatformEnvironment(): PlatformEnvironment {
  const browserNavigator =
    typeof navigator === "undefined" ? undefined : navigator;
  const browserWindow = typeof window === "undefined" ? undefined : window;
  const standaloneNavigator = browserNavigator as
    | (Navigator & { standalone?: boolean })
    | undefined;

  return {
    userAgent: browserNavigator?.userAgent ?? "",
    navigatorPlatform: browserNavigator?.platform ?? "",
    maxTouchPoints: browserNavigator?.maxTouchPoints ?? 0,
    secureContext: browserWindow?.isSecureContext === true,
    displayModeStandalone:
      browserWindow?.matchMedia?.("(display-mode: standalone)").matches ??
      false,
    navigatorStandalone: standaloneNavigator?.standalone === true,
    referrer: typeof document === "undefined" ? "" : document.referrer,
  };
}

export function currentPlatformCapabilities(): PlatformCapabilities {
  return platformCapabilities(readPlatformEnvironment());
}

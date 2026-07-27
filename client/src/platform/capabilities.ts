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
  displayModeStandalone: boolean;
  navigatorStandalone: boolean;
  referrer: string;
}

export interface PlatformCapabilities {
  kind: PlatformKind;
  displayModeStandalone: boolean;
  twaSignal: boolean;
  mobileWalletAdapterSupported: boolean;
}

const ANDROID_APP_REFERRER = /^android-app:\/\/[a-z0-9_.]+\/?$/i;

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

export function supportsMobileWalletAdapter(kind: PlatformKind): boolean {
  return kind === "android-browser" || kind === "android-pwa" || kind === "twa";
}

export function platformCapabilities(
  environment: PlatformEnvironment,
): PlatformCapabilities {
  const kind = classifyPlatform(environment);
  return {
    kind,
    displayModeStandalone: environment.displayModeStandalone,
    twaSignal: hasConservativeTwaSignal(environment),
    mobileWalletAdapterSupported: supportsMobileWalletAdapter(kind),
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

// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  classifyPlatform,
  hasConservativeTwaSignal,
  isAndroidWebView,
  isSolanaMobileWebShell,
  mobileWalletAdapterSupportReason,
  platformCapabilities,
  type PlatformEnvironment,
} from "./capabilities";

const CHROME_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
const FIREFOX_ANDROID =
  "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007; wv) AppleWebKit/537.36 Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36";
const SOLANA_MOBILE_WEB_SHELL = `${ANDROID_WEBVIEW} Solana Mobile Web Shell`;

function environment(
  overrides: Partial<PlatformEnvironment> = {},
): PlatformEnvironment {
  return {
    userAgent: CHROME_DESKTOP,
    navigatorPlatform: "Win32",
    maxTouchPoints: 0,
    secureContext: true,
    displayModeStandalone: false,
    navigatorStandalone: false,
    referrer: "",
    ...overrides,
  };
}

describe("platform capability classification", () => {
  it("keeps desktop Wallet Standard outside Mobile Wallet Adapter", () => {
    const capabilities = platformCapabilities(environment());

    expect(capabilities).toEqual({
      kind: "desktop",
      secureContext: true,
      displayModeStandalone: false,
      twaSignal: false,
      androidWebView: false,
      solanaMobileWebShell: false,
      mobileWalletAdapterSupported: false,
      mobileWalletAdapterSupportReason: "not-android",
    });
  });

  it("supports MWA in an Android browser", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: CHROME_ANDROID,
        navigatorPlatform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    );

    expect(capabilities.kind).toBe("android-browser");
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
    expect(capabilities.mobileWalletAdapterSupportReason).toBe("available");
  });

  it("keeps browser-brand classification separate from the pinned MWA gate", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: FIREFOX_ANDROID,
        navigatorPlatform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    );

    expect(capabilities.kind).toBe("android-browser");
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
  });

  it("classifies standalone Android as an installed PWA", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: CHROME_ANDROID,
        displayModeStandalone: true,
      }),
    );

    expect(capabilities.kind).toBe("android-pwa");
    expect(capabilities.displayModeStandalone).toBe(true);
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
  });

  it("blocks an insecure Android origin before the package can silently no-op", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: CHROME_ANDROID,
        secureContext: false,
      }),
    );

    expect(capabilities.kind).toBe("android-browser");
    expect(capabilities.secureContext).toBe(false);
    expect(capabilities.mobileWalletAdapterSupported).toBe(false);
    expect(capabilities.mobileWalletAdapterSupportReason).toBe(
      "insecure-context",
    );
  });

  it("blocks generic Android WebViews using the pinned package predicate", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: ANDROID_WEBVIEW,
        displayModeStandalone: true,
      }),
    );

    expect(isAndroidWebView(ANDROID_WEBVIEW)).toBe(true);
    expect(capabilities.kind).toBe("android-pwa");
    expect(capabilities.androidWebView).toBe(true);
    expect(capabilities.solanaMobileWebShell).toBe(false);
    expect(capabilities.mobileWalletAdapterSupported).toBe(false);
    expect(capabilities.mobileWalletAdapterSupportReason).toBe(
      "unsupported-android-webview",
    );
  });

  it("permits the Solana Mobile WebShell exception used by the pinned package", () => {
    const capabilities = platformCapabilities(
      environment({
        userAgent: SOLANA_MOBILE_WEB_SHELL,
        displayModeStandalone: true,
      }),
    );

    expect(isSolanaMobileWebShell(SOLANA_MOBILE_WEB_SHELL)).toBe(true);
    expect(capabilities.androidWebView).toBe(true);
    expect(capabilities.solanaMobileWebShell).toBe(true);
    expect(capabilities.mobileWalletAdapterSupported).toBe(true);
    expect(capabilities.mobileWalletAdapterSupportReason).toBe("available");
  });

  it("requires a standalone android-app referrer for the TWA signal", () => {
    const installedPwa = environment({
      userAgent: CHROME_ANDROID,
      displayModeStandalone: true,
      referrer: "https://zkube.gg/",
    });
    const twa = environment({
      userAgent: CHROME_ANDROID,
      displayModeStandalone: true,
      referrer: "android-app://gg.zkube.app/",
    });

    expect(hasConservativeTwaSignal(installedPwa)).toBe(false);
    expect(classifyPlatform(installedPwa)).toBe("android-pwa");
    expect(hasConservativeTwaSignal(twa)).toBe(true);
    expect(classifyPlatform(twa)).toBe("twa");
    expect(platformCapabilities(twa).mobileWalletAdapterSupported).toBe(true);
  });

  it("classifies iPhone and touch-based iPadOS without enabling MWA", () => {
    const iphone = environment({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      navigatorPlatform: "iPhone",
      maxTouchPoints: 5,
      navigatorStandalone: true,
    });
    const ipad = environment({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      navigatorPlatform: "MacIntel",
      maxTouchPoints: 5,
    });

    expect(classifyPlatform(iphone)).toBe("ios");
    expect(classifyPlatform(ipad)).toBe("ios");
    expect(mobileWalletAdapterSupportReason(iphone)).toBe("not-android");
  });

  it("uses unknown for environments without a supported platform signal", () => {
    expect(
      classifyPlatform(
        environment({
          userAgent: "custom-runtime/1.0",
          navigatorPlatform: "",
        }),
      ),
    ).toBe("unknown");
  });
});

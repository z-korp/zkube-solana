import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

const NATIVE_RESUME_EVENT = "zkube:native-resume";
const NATIVE_URL_EVENT = "zkube:native-url";
let initialized = false;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initializeNativeShell(): Promise<void> {
  if (!isNativePlatform() || initialized) return;
  initialized = true;
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) window.dispatchEvent(new Event(NATIVE_RESUME_EVENT));
  });
  await App.addListener("appUrlOpen", ({ url }) => {
    window.dispatchEvent(
      new CustomEvent<string>(NATIVE_URL_EVENT, { detail: url }),
    );
  });
  await Promise.all([
    StatusBar.setStyle({ style: Style.Dark }),
    StatusBar.setBackgroundColor({ color: "#080414" }),
  ]);
  await SplashScreen.hide();
}

export function subscribeNativeResume(listener: () => void): () => void {
  if (!isNativePlatform()) return () => undefined;
  window.addEventListener(NATIVE_RESUME_EVENT, listener);
  return () => window.removeEventListener(NATIVE_RESUME_EVENT, listener);
}

export function subscribeNativeUrl(
  listener: (url: string) => void,
): () => void {
  if (!isNativePlatform()) return () => undefined;
  const handle = (event: Event) => {
    listener((event as CustomEvent<string>).detail);
  };
  window.addEventListener(NATIVE_URL_EVENT, handle);
  return () => window.removeEventListener(NATIVE_URL_EVENT, handle);
}

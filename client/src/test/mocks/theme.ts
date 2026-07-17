/**
 * Shared vi.mock factory for "@/ui/elements/theme-provider/hooks".
 *
 * Usage (vi.mock factories are hoisted, so load this via dynamic import):
 *
 *   vi.mock("@/ui/elements/theme-provider/hooks", async () =>
 *     (await import("@/test/mocks/theme")).themeHooksMock());
 *
 * `useThemeColors` is backed by the real palette table so component tests
 * render genuine theme colors. Pass `setThemeTemplate` when the suite spies
 * on template switches; it is omitted otherwise to match the historical
 * minimal mock shape.
 */
export async function themeHooksMock(
  template = "theme-1",
  setThemeTemplate?: (template: string) => void,
) {
  const { getThemeColors } = await import("@/config/themes");
  const theme = setThemeTemplate
    ? { themeTemplate: template, setThemeTemplate }
    : { themeTemplate: template };
  return {
    useTheme: () => theme,
    useThemeColors: () => getThemeColors(template),
  };
}

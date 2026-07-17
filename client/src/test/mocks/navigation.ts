/**
 * Shared vi.mock factory for "@/stores/navigationStore".
 *
 * Reproduces the selector-passthrough shape every suite uses:
 *   useNavigationStore: (selector) => selector(state)
 *
 * Pass a plain state object when the suite mutates a stable object in place,
 * or a getter when the state is rebuilt from reassigned fixture fields so
 * each selector call observes the latest values.
 *
 *   vi.mock("@/stores/navigationStore", async () =>
 *     (await import("@/test/mocks/navigation")).navigationStoreMock(
 *       () => ({ navigate: fixtures.navigate }),
 *     ));
 */
export function navigationStoreMock<S>(state: S | (() => S)) {
  const resolveState = (): S =>
    typeof state === "function" ? (state as () => S)() : state;
  return {
    useNavigationStore: <T>(selector: (current: S) => T): T =>
      selector(resolveState()),
  };
}

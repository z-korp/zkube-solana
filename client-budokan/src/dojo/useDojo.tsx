// ── Stub useDojo (migration Solana) ──────────────────────────────────────────
// Toutes les propriétés de setup retournent des no-ops ou des objets vides
// afin que les composants qui déstructurent contractComponents / systemCalls
// ne crashent pas avant d'être migrés vers useSolanaGame.

const noop = async () => ({ events: [] });

const systemCallsStub: Record<string, any> = new Proxy({}, {
  get: () => noop,
});

const contractComponentsStub: Record<string, any> = new Proxy({}, {
  get: (_target, prop) => {
    // Return a dummy component-like object so Has() / getComponentValue() don't throw
    return { id: String(prop), schema: {} };
  },
});

const clientModelsStub: Record<string, any> = new Proxy({}, {
  get: (_target, prop) => {
    if (prop === "models" || prop === "classes") {
      return new Proxy({}, { get: () => ({ id: "stub", schema: {} }) });
    }
    return {};
  },
});

export const useDojo = () => {
  return {
    setup: {
      systemCalls: systemCallsStub,
      contractComponents: contractComponentsStub,
      clientModels: clientModelsStub,
      client: {},
    } as any,
  };
};

// Stub — useMutatorDef (migration Solana)
export interface MutatorDefData {
  mutatorId: number;
  name: string;
  description: string;
}

export function useMutatorDef(_mutatorId: number): {
  data: MutatorDefData | undefined;
  isLoading: boolean;
} {
  return { data: undefined, isLoading: false };
}

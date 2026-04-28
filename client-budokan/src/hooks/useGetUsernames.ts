// Stub — useGetUsernames (migration Solana, Cartridge Controller supprimé)

export function normalizeAddress(address: string): string {
  return address.replace(/^0x0+/, "0x").toLowerCase();
}

export const useGetUsernames = (_addresses: string[]) => {
  return {
    usernames: undefined as Map<string, string> | undefined,
    refetch: async () => {},
  };
};

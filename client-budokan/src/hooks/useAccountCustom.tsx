// Migration Solana — useAccountCustom retourne null (plus de compte Starknet)
// Les composants qui utilisent `account` afficheront un état déconnecté.
// TODO: migrer les usages vers useWallet() de @solana/wallet-adapter-react

const useAccountCustom = () => {
  return { account: null };
};

export default useAccountCustom;

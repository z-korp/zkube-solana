import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  exportRecoveryCode,
  importRecoveryCode,
  loadOrCreateEmbeddedIdentity,
} from "./embeddedIdentity";
import {
  EmbeddedIdentityContext,
  type EmbeddedIdentityValue,
} from "./embeddedIdentityContext";
import { SessionWallet } from "./sessionWallet";
import { CANONICAL_DEVNET_USDC_MINT } from "../constants";
import { useSolanaConnection } from "../connectionContext";

export function EmbeddedIdentityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { connection } = useSolanaConnection();
  const [keypair, setKeypair] = useState(loadOrCreateEmbeddedIdentity);
  const [balanceLamports, setBalanceLamports] = useState<number | null>(null);
  const [usdcBaseUnits, setUsdcBaseUnits] = useState<bigint | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const wallet = useMemo(() => new SessionWallet(keypair), [keypair]);

  const refreshBalance = useCallback(async () => {
    setBalanceLoading(true);
    try {
      const usdcAccount = getAssociatedTokenAddressSync(
        CANONICAL_DEVNET_USDC_MINT,
        keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
      );
      const [balance, tokenInfo] = await Promise.all([
        connection.getBalance(keypair.publicKey, "confirmed"),
        connection.getAccountInfo(usdcAccount, "confirmed"),
      ]);
      const token = tokenInfo
        ? unpackAccount(usdcAccount, tokenInfo, TOKEN_PROGRAM_ID)
        : null;
      if (
        token &&
        (!token.owner.equals(keypair.publicKey) ||
          !token.mint.equals(CANONICAL_DEVNET_USDC_MINT))
      ) {
        throw new Error("The zKube Vault USDC account identity is invalid");
      }
      setBalanceLamports(balance);
      setUsdcBaseUnits(token?.amount ?? 0n);
      return balance;
    } catch {
      setBalanceLamports(null);
      setUsdcBaseUnits(null);
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }, [connection, keypair.publicKey]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const restore = useCallback((code: string) => {
    const restored = importRecoveryCode(code);
    setKeypair(restored);
    setBalanceLamports(null);
    setUsdcBaseUnits(null);
    return restored.publicKey;
  }, []);

  const withdrawSol = useCallback(
    async (to: string, lamports: number) => {
      if (!Number.isSafeInteger(lamports) || lamports <= 0) {
        throw new Error("Withdrawal amount must be positive");
      }
      const destination = new PublicKey(to);
      if (destination.equals(keypair.publicKey)) {
        throw new Error("Destination must differ from the zKube Vault");
      }
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: latest.blockhash,
          instructions: [
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: destination,
              lamports,
            }),
          ],
        }).compileToV0Message(),
      );
      transaction.sign([keypair]);
      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: true,
      });
      if (simulation.value.err) {
        throw new Error(
          `Withdrawal simulation failed: ${JSON.stringify(simulation.value.err)}`,
        );
      }
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const confirmation = await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed",
      );
      if (confirmation.value.err)
        throw new Error("Withdrawal was not confirmed");
      await refreshBalance();
      return signature;
    },
    [connection, keypair, refreshBalance],
  );

  const withdrawUsdc = useCallback(
    async (to: string, baseUnits: bigint) => {
      if (baseUnits <= 0n || baseUnits > 18_446_744_073_709_551_615n) {
        throw new Error("USDC withdrawal amount must be positive");
      }
      const destination = new PublicKey(to);
      if (destination.equals(keypair.publicKey)) {
        throw new Error("Destination must differ from the zKube Vault");
      }
      const sourceAccount = getAssociatedTokenAddressSync(
        CANONICAL_DEVNET_USDC_MINT,
        keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
      );
      const destinationAccount = getAssociatedTokenAddressSync(
        CANONICAL_DEVNET_USDC_MINT,
        destination,
        false,
        TOKEN_PROGRAM_ID,
      );
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: keypair.publicKey,
          recentBlockhash: latest.blockhash,
          instructions: [
            createAssociatedTokenAccountIdempotentInstruction(
              keypair.publicKey,
              destinationAccount,
              destination,
              CANONICAL_DEVNET_USDC_MINT,
              TOKEN_PROGRAM_ID,
            ),
            createTransferCheckedInstruction(
              sourceAccount,
              CANONICAL_DEVNET_USDC_MINT,
              destinationAccount,
              keypair.publicKey,
              baseUnits,
              6,
              [],
              TOKEN_PROGRAM_ID,
            ),
          ],
        }).compileToV0Message(),
      );
      transaction.sign([keypair]);
      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: true,
      });
      if (simulation.value.err) {
        throw new Error(
          `USDC withdrawal simulation failed: ${JSON.stringify(simulation.value.err)}`,
        );
      }
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const confirmation = await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed",
      );
      if (confirmation.value.err)
        throw new Error("USDC withdrawal was not confirmed");
      await refreshBalance();
      return signature;
    },
    [connection, keypair, refreshBalance],
  );

  const value = useMemo<EmbeddedIdentityValue>(
    () => ({
      keypair,
      wallet,
      publicKey: keypair.publicKey,
      balanceLamports,
      usdcBaseUnits,
      balanceLoading,
      refreshBalance,
      recoveryCode: () => exportRecoveryCode(keypair),
      restore,
      withdrawSol,
      withdrawUsdc,
    }),
    [
      balanceLamports,
      balanceLoading,
      keypair,
      refreshBalance,
      restore,
      usdcBaseUnits,
      wallet,
      withdrawSol,
      withdrawUsdc,
    ],
  );

  return (
    <EmbeddedIdentityContext.Provider value={value}>
      {children}
    </EmbeddedIdentityContext.Provider>
  );
}

using System;
using System.Linq;
using Chaos.NaCl;

namespace ZKube.Integration
{
    public static class WalletSignatureVerifier
    {
        public static void VerifyBeforeWallet(byte[] original, string owner)
        {
            var transaction = Parse(original);
            var ownerBytes = SolanaAddress.Bytes(owner);
            int ownerIndex = Array.FindIndex(transaction.Header.Signers, key => key.SequenceEqual(ownerBytes));
            if (ownerIndex < 0) throw new FormatException("Owner is not a required signer");
            for (int i = 0; i < transaction.Signatures.Length; i++)
            {
                if (i == ownerIndex) continue;
                if (!Ed25519.Verify(transaction.Signatures[i], transaction.Message, transaction.Header.Signers[i]))
                    throw new FormatException("Missing or invalid nonowner partial signature");
            }
        }

        // Called before accepting MWA output. Zero is a reserved signature slot,
        // never evidence that an account signed. Verify the owner cryptographically.
        public static byte[] VerifySignedTransaction(byte[] original, byte[] returned, string owner)
        {
            VerifyBeforeWallet(original, owner);
            var before = Parse(original);
            var after = Parse(returned);
            if (!before.Message.SequenceEqual(after.Message)) throw new FormatException("Wallet changed the message");
            var ownerBytes = SolanaAddress.Bytes(owner);
            int ownerIndex = Array.FindIndex(after.Header.Signers, key => key.SequenceEqual(ownerBytes));
            if (ownerIndex < 0) throw new FormatException("Owner is not a required signer");
            for (int i = 0; i < before.Signatures.Length; i++)
            {
                if (before.Signatures[i].Any(value => value != 0) && !before.Signatures[i].SequenceEqual(after.Signatures[i]))
                    throw new FormatException("Wallet discarded or changed an existing signature");
                if (after.Signatures[i].Any(value => value != 0) &&
                    !Ed25519.Verify(after.Signatures[i], after.Message, after.Header.Signers[i]))
                    throw new FormatException("Invalid transaction signature");
            }
            if (after.Signatures[ownerIndex].All(value => value == 0)) throw new FormatException("Owner did not sign");
            return (byte[])returned.Clone();
        }

        private static TransactionSignatures.SignedMessage Parse(byte[] transaction)
        {
            var parsed = TransactionSignatures.Parse(transaction);
            if (!parsed.Header.VersionZero) throw new FormatException("Invalid wallet transaction header");
            return parsed;
        }
    }
}

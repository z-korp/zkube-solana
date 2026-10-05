using System;
using System.Linq;
using Chaos.NaCl;

namespace ZKube.Integration
{
    // The wallet returned another message than the one it was given. The rule
    // is unchanged: nothing is sent. Summary is the evidence, and is safe to log
    // and show: counts, program IDs and yes/no facts, never another key, an
    // amount or a signature.
    public sealed class WalletChangedMessageException : FormatException
    {
        public string Summary { get; }
        public WalletChangedMessageException(string summary) : base("Wallet changed the message") { Summary = summary; }
    }

    public static class WalletSignatureVerifier
    {
        public static void VerifyBeforeWallet(byte[] original, string owner)
        {
            var transaction = Parse(original);
            var ownerBytes = SolanaAddress.Bytes(owner);
            int ownerIndex = Array.FindIndex(transaction.Header.Signers, key => key.SequenceEqual(ownerBytes));
            if (ownerIndex < 0) throw new FormatException("Owner is not a required signer");
            // The wallet is never handed a message nothing else has signed: a
            // message it changed would then verify. The install key signs first.
            if (transaction.Signatures.Length < 2) throw new FormatException("Owner-wallet payload carries no install signature");
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
            if (!before.Message.SequenceEqual(after.Message)) throw new WalletChangedMessageException(Difference(original, returned));
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

        // What differs between the message given and the message returned.
        internal static string Difference(byte[] original, byte[] returned)
        {
            try
            {
                var before = TransactionSignatures.Describe(original); var after = TransactionSignatures.Describe(returned);
                string Programs(TransactionDescription from, TransactionDescription against)
                {
                    var left = against.Instructions.Select(instruction => instruction.ProgramId).ToList();
                    var extra = from.Instructions.Select(instruction => instruction.ProgramId).Where(program => !left.Remove(program))
                        .GroupBy(program => program, StringComparer.Ordinal).OrderBy(group => group.Key, StringComparer.Ordinal)
                        .Select(group => group.Key + (group.Count() > 1 ? " x" + group.Count() : "")).ToArray();
                    return extra.Length == 0 ? "none" : string.Join(", ", extra);
                }
                string Changed(bool changed) => changed ? "changed" : "same";
                // The instructions both messages carry in the same order, compared one by one.
                int shared = Math.Min(before.Instructions.Count, after.Instructions.Count), rewritten = 0;
                for (int i = 0; i < shared; i++)
                {
                    var a = before.Instructions[i]; var b = after.Instructions[i];
                    if (a.ProgramId == b.ProgramId && (!a.Data.SequenceEqual(b.Data) ||
                        !a.Accounts.Select(account => account.Address).SequenceEqual(b.Accounts.Select(account => account.Address)))) rewritten++;
                }
                return "instructions " + before.Instructions.Count + " to " + after.Instructions.Count +
                    "; added " + Programs(after, before) + "; removed " + Programs(before, after) +
                    "; rewritten in place " + rewritten +
                    "; fee payer " + Changed(before.FeePayer != after.FeePayer) +
                    "; blockhash " + Changed(TransactionSignatures.ReadBlockhash(original) != TransactionSignatures.ReadBlockhash(returned)) +
                    "; signers " + Changed(!Signers(before).SequenceEqual(Signers(after))) +
                    "; accounts " + Changed(!before.Accounts.Select(account => account.Address).SequenceEqual(after.Accounts.Select(account => account.Address))) +
                    " (" + before.Accounts.Count + " to " + after.Accounts.Count + ")" +
                    "; version " + Changed(before.VersionZero != after.VersionZero);
            }
            catch (Exception) { return "the returned message could not be read"; }
        }
        private static string[] Signers(TransactionDescription message) =>
            message.Accounts.Where(account => account.Signer).Select(account => account.Address).ToArray();

        private static TransactionSignatures.SignedMessage Parse(byte[] transaction)
        {
            var parsed = TransactionSignatures.Parse(transaction);
            if (!parsed.Header.VersionZero) throw new FormatException("Invalid wallet transaction header");
            return parsed;
        }
    }
}

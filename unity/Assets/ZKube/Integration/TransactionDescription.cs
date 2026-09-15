using System;
using System.Collections.Generic;

namespace ZKube.Integration
{
    public sealed class TransactionDescription
    {
        public IReadOnlyList<AccountMeta> Accounts { get; }
        public IReadOnlyList<SolanaInstruction> Instructions { get; }
        public string FeePayer => Accounts[0].Address;
        public bool VersionZero { get; }
        internal TransactionDescription(AccountMeta[] accounts, SolanaInstruction[] instructions, bool versionZero)
        {
            Accounts = Array.AsReadOnly((AccountMeta[])accounts.Clone());
            Instructions = Array.AsReadOnly((SolanaInstruction[])instructions.Clone());
            VersionZero = versionZero;
        }
    }
}

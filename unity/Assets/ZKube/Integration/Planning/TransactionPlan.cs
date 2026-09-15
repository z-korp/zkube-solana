using System;
using System.Collections.Generic;
using System.Linq;
using ZKube.Core.Generated;

namespace ZKube.Integration.Planning
{
    public enum PlanRoute { Base, ResolvedEr }

    public sealed class TransactionPlan
    {
        public PlanRoute Route { get; }
        public string Owner { get; }
        public string FeePayer { get; }
        public IReadOnlyList<SolanaInstruction> Instructions { get; }
        public IReadOnlyList<string> DeviceSigners { get; }
        public bool OwnerSignatureRequired { get; }
        public ulong PostFeeReserveLamports { get; }
        public ulong? RunId { get; }
        public bool VersionZero => Route == PlanRoute.Base || OwnerSignatureRequired;

        internal TransactionPlan(PlanRoute route, string owner, string payer,
            IEnumerable<SolanaInstruction> instructions, ulong reserve = 0, ulong? runId = null)
        {
            SolanaAddress.Bytes(owner); SolanaAddress.Bytes(payer);
            var list = instructions.ToArray();
            if (list.Length == 0) throw new ArgumentException("Empty transaction plan");
            var signers = list.SelectMany(i => i.Accounts).Where(a => a.Signer).Select(a => a.Address)
                .Prepend(payer).Distinct(StringComparer.Ordinal).ToArray();
            Route = route; Owner = owner; FeePayer = payer; Instructions = Array.AsReadOnly(list);
            OwnerSignatureRequired = signers.Contains(owner);
            DeviceSigners = Array.AsReadOnly(signers.Where(key => key != owner).ToArray());
            PostFeeReserveLamports = reserve; RunId = runId;
        }

        public byte[] CompileMessage(string blockhash)
        {
            var instructions = Instructions.ToList();
            if (VersionZero)
            {
                var limit = new byte[5]; limit[0] = 2;
                NativeWire.Write(limit, 1, 4, PlanningConstants.ComputeUnitLimit);
                var price = new byte[9]; price[0] = 3;
                NativeWire.Write(price, 1, 8, PlanningConstants.ComputeUnitPrice);
                instructions.InsertRange(0, new[] {
                    new SolanaInstruction(PlanningConstants.ComputeBudgetProgram, Array.Empty<AccountMeta>(), limit),
                    new SolanaInstruction(PlanningConstants.ComputeBudgetProgram, Array.Empty<AccountMeta>(), price),
                });
            }
            return SolanaWire.CompileMessage(FeePayer, blockhash, instructions, VersionZero);
        }

        // The transport supplies a fee quoted for the exact compiled message.
        public void RequireDeviceFunding(ulong balance, ulong systemRentFloor, ulong quotedFee)
        {
            if (FeePayer == Owner) return;
            ulong required = checked(systemRentFloor + quotedFee + PostFeeReserveLamports);
            if (balance < required) throw new InvalidOperationException("Device fee allowance requires refill");
        }
    }
}

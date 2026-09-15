using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Integration.Tests
{
    public sealed class ProtocolDecodeTests
    {
        private static ProtocolBindings Bindings() => new ProtocolBindings(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("solana");
        [Test]
        public void RustProgramInstructionsDecodeAndReencodeWithTheSharedBorshReader()
        {
            var bindings = Bindings();
            foreach (var row in Fixture()["transactions"])
            {
                var description = TransactionSignatures.Describe(Convert.FromBase64String((string)row["signedTransaction"]));
                foreach (var instruction in description.Instructions.Where(i => i.ProgramId == bindings.ProgramId))
                {
                    var decoded = bindings.DecodeInstruction(instruction);
                    var encoded = bindings.Instruction(decoded.Name, decoded.Arguments, decoded.Accounts);
                    Assert.That(encoded.Data, Is.EqualTo(instruction.Data));
                    Assert.That(encoded.Accounts.Select(a => a.Address).Concat(decoded.Remaining.Select(a => a.Address)), Is.EqualTo(instruction.Accounts.Select(a => a.Address)));
                    if (decoded.Name == (string)row["instructionName"])
                        Assert.That(Normalize(decoded.Arguments), Is.EqualTo(Normalize(row["args"])));
                }
            }
        }
        [Test]
        public void TruncatedTrailingUnknownAndMissingRequiredRolesFailClosed()
        {
            var bindings = Bindings(); var row = Fixture()["transactions"].First();
            var ix = TransactionSignatures.Describe(Convert.FromBase64String((string)row["signedTransaction"])).Instructions.Single(i => i.ProgramId == bindings.ProgramId);
            foreach (var data in new[] { ix.Data.Take(ix.Data.Length - 1).ToArray(), ix.Data.Concat(new byte[1]).ToArray(), new byte[ix.Data.Length] })
                Assert.Throws<FormatException>(() => bindings.DecodeInstruction(new SolanaInstruction(ix.ProgramId, ix.Accounts, data)));
            var required = bindings.Instruction("purchase_kredits", (JObject)row["args"], bindings.DecodeInstruction(ix).Accounts);
            int signer = required.Accounts.Select((a, i) => (a, i)).First(pair => pair.a.Signer).i;
            var accounts = ix.Accounts.ToArray(); accounts[signer] = new AccountMeta(accounts[signer].Address, false, accounts[signer].Writable);
            Assert.Throws<FormatException>(() => bindings.DecodeInstruction(new SolanaInstruction(ix.ProgramId, accounts, ix.Data)));
        }
        private static string Normalize(JToken value)
        {
            if (value is JObject obj) return "{" + string.Join(",", obj.Properties().OrderBy(p => p.Name).Select(p => p.Name.ToLowerInvariant() + ":" + Normalize(p.Value))) + "}";
            if (value is JArray array) return "[" + string.Join(",", array.Select(Normalize)) + "]";
            return value.ToString();
        }
    }
}

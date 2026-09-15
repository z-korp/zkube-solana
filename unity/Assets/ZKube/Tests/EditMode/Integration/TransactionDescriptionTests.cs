using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Integration.Tests
{
    public sealed class TransactionDescriptionTests
    {
        [Test]
        public void DurableWireDescriptionsMatchActualWeb3AccountPrivilegesAndInstructions()
        {
            var fixture = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/unity-solana-v1.json"))));
            foreach (var row in fixture["transactions"])
            {
                var description = TransactionSignatures.Describe(Convert.FromBase64String((string)row["signedTransaction"]));
                Assert.That(description.VersionZero, Is.EqualTo((string)row["version"] == "v0"));
                Assert.That(description.FeePayer, Is.EqualTo((string)row["feePayer"]));
                Assert.That(description.Accounts.Count, Is.EqualTo(row["decodedAccounts"].Count()));
                for (int i = 0; i < description.Accounts.Count; i++) Account(description.Accounts[i], row["decodedAccounts"][i]);
                Assert.That(description.Instructions.Count, Is.EqualTo(row["decodedInstructions"].Count()));
                for (int i = 0; i < description.Instructions.Count; i++)
                {
                    var instruction = description.Instructions[i]; var expected = row["decodedInstructions"][i];
                    Assert.That(instruction.ProgramId, Is.EqualTo((string)expected["programId"]));
                    Assert.That(instruction.Data, Is.EqualTo(Convert.FromBase64String((string)expected["data"])));
                    Assert.That(instruction.Accounts.Count, Is.EqualTo(expected["accounts"].Count()));
                    for (int j = 0; j < instruction.Accounts.Count; j++) Account(instruction.Accounts[j], expected["accounts"][j]);
                }
            }
        }
        private static void Account(AccountMeta actual, JToken expected)
        {
            Assert.That(actual.Address, Is.EqualTo((string)expected["address"]));
            Assert.That(actual.Signer, Is.EqualTo((bool)expected["signer"]));
            Assert.That(actual.Writable, Is.EqualTo((bool)expected["writable"]));
        }
    }
}

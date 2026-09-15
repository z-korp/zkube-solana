using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Integration.Tests
{
    // Account bytes, PDAs and messages come from the program's Rust producer.
    // Synthetic test signatures are applied here; no secret is stored in a fixture.
    public static class ProgramScenarios
    {
        public static void Equivalent(byte[] actual, byte[] expected)
        {
            var left = TransactionSignatures.Describe(actual); var right = TransactionSignatures.Describe(expected);
            Assert.That(left.FeePayer, Is.EqualTo(right.FeePayer));
            Assert.That(left.VersionZero, Is.EqualTo(right.VersionZero));
            Assert.That(TransactionSignatures.ReadBlockhash(actual), Is.EqualTo(TransactionSignatures.ReadBlockhash(expected)));
            string Meta(AccountMeta value) => value.Address + ":" + value.Signer + ":" + value.Writable;
            // SDKs may order independent account keys differently. Compare every
            // compiled privilege and ordered instruction after resolving indices.
            Assert.That(left.Accounts.Select(Meta).OrderBy(x => x), Is.EqualTo(right.Accounts.Select(Meta).OrderBy(x => x)));
            Assert.That(left.Instructions.Count, Is.EqualTo(right.Instructions.Count));
            for (int i = 0; i < left.Instructions.Count; i++)
            {
                Assert.That(left.Instructions[i].ProgramId, Is.EqualTo(right.Instructions[i].ProgramId));
                Assert.That(left.Instructions[i].Data, Is.EqualTo(right.Instructions[i].Data));
                Assert.That(left.Instructions[i].Accounts.Select(Meta), Is.EqualTo(right.Instructions[i].Accounts.Select(Meta)));
            }
        }
        public static void EquivalentMessages(string actual, string expected) => Equivalent(
            SolanaWire.UnsignedTransaction(Convert.FromBase64String(actual)), SolanaWire.UnsignedTransaction(Convert.FromBase64String(expected)));
        public static JObject Load(string section)
        {
            var root = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/program-unity-v1.json"))));
            if (section == "transport") return new JObject { ["inputs"] = new JObject {
                ["base"] = "https://base.invalid/", ["router"] = "https://router.invalid/", ["er"] = "https://er.invalid/",
                ["expectedGenesis"] = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", ["program"] = root["plans"]["inputs"]["programId"] } };
            var result = (JObject)root[section];
            SignMessages(result);
            if (section == "runs")
                foreach (string payer in new[] { "ownerConsume", "deviceConsume" })
                    result[payer]["daily"] = result[payer]["daily"]["signedTransaction"].DeepClone();
            if (section == "economy") result["oldScoreTransaction"] = result["oldScoreTransaction"]["signedTransaction"].DeepClone();
            return result;
        }

        public static byte[] Sign(JToken transaction)
        {
            var bytes = SolanaWire.UnsignedTransaction(Convert.FromBase64String((string)transaction["message"]));
            foreach (byte value in new byte[] { 1, 2, 3 })
            {
                using var signer = new DeviceSigner(Enumerable.Repeat(value, 32).ToArray());
                if (transaction["signers"].Values<string>().Contains(signer.Address)) bytes = signer.PartialSign(bytes);
            }
            TransactionSignatures.ValidateFullySigned(bytes);
            return bytes;
        }

        private static void SignMessages(JToken token)
        {
            if (token is JObject value)
            {
                foreach (var property in value.Properties().ToArray()) SignMessages(property.Value);
                if (value["message"] != null && value["signers"] is JArray)
                {
                    var bytes = Sign(value);
                    value["signedTransaction"] = Convert.ToBase64String(bytes);
                    value["signature"] = TransactionSignatures.ValidateFullySigned(bytes);
                }
            }
            else if (token is JArray array) foreach (var item in array) SignMessages(item);
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace ZKube.Integration.Transport.Tests
{
    // The Seeker ID and the verified-Seeker badge are display reads from
    // mainnet: they resolve as AllDomains and Solana Mobile document, once per
    // address, and every failure is an empty profile, never an exception.
    public sealed class SeekerNamesTests
    {
        private const string Owner = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3", NameAccount = "82VxVcUmTZJF7WdwfJtrGToaek6jiyD6jA4MP9JCTvTv";
        private const string Mint = "5mXbkqKz883aufhAsx3p5Z1NcvD2ppZbdTTznM6oUKLj";
        private sealed class Rpc : IJsonRpcHttp
        {
            public readonly List<(string method, JArray parameters)> Calls = new List<(string, JArray)>();
            public Func<string, JArray, JToken> Answer;
            public Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                var request = JObject.Parse(json); string method = (string)request["method"]; var parameters = (JArray)request["params"];
                lock (Calls) Calls.Add((method, parameters));
                return Task.FromResult(new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = Answer(method, parameters) }.ToString());
            }
        }
        private static JToken Record(string label)
        {
            var data = new byte[SeekerNames.HeaderBytes + label.Length]; Encoding.UTF8.GetBytes(label).CopyTo(data, SeekerNames.HeaderBytes);
            return new JObject { ["owner"] = SeekerNames.NameService, ["data"] = new JArray(Convert.ToBase64String(data), "base64") };
        }
        private static JToken Held(string mint, string amount) => new JObject { ["account"] = new JObject { ["data"] = new JObject { ["parsed"] = new JObject {
            ["info"] = new JObject { ["mint"] = mint, ["tokenAmount"] = new JObject { ["amount"] = amount } } } } } };
        private static JToken MintAccount(string metadata, string group) => new JObject { ["owner"] = SeekerNames.Token2022, ["data"] = new JObject { ["parsed"] = new JObject {
            ["info"] = new JObject { ["extensions"] = new JArray(
                new JObject { ["extension"] = "metadataPointer", ["state"] = new JObject { ["metadataAddress"] = metadata } },
                new JObject { ["extension"] = "tokenGroupMember", ["state"] = new JObject { ["group"] = group } }) } } } };
        // A mainnet where Owner holds alice.skr and, when sgt is set, a Seeker Genesis Token with that balance.
        private static Rpc Mainnet(string genesis = SeekerNames.MainnetGenesis, string label = "alice", string balance = "1", string group = SeekerNames.GenesisGroup) => new Rpc {
            Answer = (method, parameters) => method switch {
                "getGenesisHash" => genesis,
                "getProgramAccounts" => new JArray(new JObject { ["pubkey"] = NameAccount }),
                "getTokenAccountsByOwner" => new JObject { ["value"] = new JArray(Held(Mint, balance)) },
                "getMultipleAccounts" => new JObject { ["value"] = new JArray(((JArray)parameters[0]).Select(address =>
                    (string)address == SeekerNames.ReverseRecord(NameAccount) ? Record(label) : (string)address == Mint ? MintAccount(group, group) : JValue.CreateNull())) },
                _ => throw new InvalidOperationException(method) } };

        [Test] public void TheSkrAddressesDeriveAsAllDomainsPublishesThem()
        {
            // AllDomains' published root name account, and its parser's derivations from it.
            Assert.AreEqual("3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU", SeekerNames.Origin);
            Assert.AreEqual("F3A8kuikEiu6k2399oSJ1PWfcJYDHqpwoQ2e8psSDNuF", SeekerNames.Parent);
            Assert.AreEqual("4RKP4BEMu5sXBfXSH7xN2owtQrnAJvhhwtBBmj9JEYkA", SeekerNames.House);
            Assert.AreEqual(NameAccount, SeekerNames.NameAccount(SeekerNames.Hashed("alice"), null, SeekerNames.Parent));
            Assert.AreEqual("AvCPTA9rpTKMUaERGri7Dr2eRkcYXqYB7RCGdgc6VF1F", SeekerNames.ReverseRecord(Owner));
        }

        [Test] public async Task SeekerIdsResolveFromTheirSkrRecordsOncePerAddress()
        {
            var rpc = Mainnet(); var names = new SeekerNames(rpc, "https://mainnet.example");
            var profile = await names.Resolve(Owner);
            Assert.AreEqual("alice.skr", profile.Name);
            var filters = (JArray)rpc.Calls.Single(call => call.method == "getProgramAccounts").parameters[1]["filters"];
            Assert.AreEqual(SeekerNames.NameService, (string)rpc.Calls.Single(call => call.method == "getProgramAccounts").parameters[0]);
            CollectionAssert.AreEquivalent(new[] { "40:" + Owner, "8:" + SeekerNames.Parent },
                filters.Select(filter => (int)filter["memcmp"]["offset"] + ":" + (string)filter["memcmp"]["bytes"]).ToArray());
            int calls = rpc.Calls.Count;
            Assert.AreSame(profile, await names.Resolve(Owner), "An address resolves once per app run");
            Assert.AreEqual(calls, rpc.Calls.Count);
        }

        [Test] public async Task AVerifiedSeekerHoldsAGenesisTokenWithABalance()
        {
            Assert.IsTrue((await new SeekerNames(Mainnet(), "https://mainnet.example").Resolve(Owner)).Verified);
            Assert.IsFalse((await new SeekerNames(Mainnet(balance: "0"), "https://mainnet.example").Resolve(Owner)).Verified, "An emptied token account is not ownership");
            Assert.IsFalse((await new SeekerNames(Mainnet(group: Owner), "https://mainnet.example").Resolve(Owner)).Verified, "Another group's token is not a Genesis Token");
            var rpc = Mainnet(); await new SeekerNames(rpc, "https://mainnet.example").Resolve(Owner);
            Assert.AreEqual(SeekerNames.Token2022, (string)rpc.Calls.Single(call => call.method == "getTokenAccountsByOwner").parameters[1]["programId"]);
        }

        [Test] public async Task SeekerLookupsNeverThrowAndShowNothingWhenTheyCannotResolve()
        {
            foreach (var (names, why) in new (SeekerNames, string)[] {
                (new SeekerNames(Mainnet(), null), "no endpoint"),
                (new SeekerNames(Mainnet(), "http://mainnet.example"), "not HTTPS"),
                (new SeekerNames(Mainnet(genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"), "https://devnet.example"), "not mainnet"),
                (new SeekerNames(new Rpc { Answer = (method, parameters) => throw new InvalidOperationException("offline") }, "https://mainnet.example"), "a failing endpoint"),
                (new SeekerNames(Mainnet(label: "<b>not a name</b>"), "https://mainnet.example"), "a record that is not a plain label") })
            {
                var profile = await names.Resolve(Owner);
                Assert.IsNull(profile.Name, why);
                if (why != "a record that is not a plain label") Assert.IsFalse(profile.Verified, why);
            }
            Assert.IsNull((await new SeekerNames(Mainnet(), "https://mainnet.example").Resolve("not an address")).Name);
        }
    }
}

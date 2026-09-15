using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration
{
    public sealed class DecodedProtocolInstruction
    {
        private readonly JObject arguments;
        public string Name { get; }
        public JObject Arguments => (JObject)arguments.DeepClone();
        public IReadOnlyDictionary<string, string> Accounts { get; }
        public IReadOnlyList<AccountMeta> Remaining { get; }
        internal DecodedProtocolInstruction(string name, JObject arguments, Dictionary<string, string> accounts, AccountMeta[] remaining)
        {
            Name = name; this.arguments = (JObject)arguments.DeepClone();
            Accounts = new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(accounts));
            Remaining = Array.AsReadOnly((AccountMeta[])remaining.Clone());
        }
    }
}

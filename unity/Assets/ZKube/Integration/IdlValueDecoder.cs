using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Numerics;
using Newtonsoft.Json.Linq;
using Solana.Unity.Wallet;

namespace ZKube.Integration
{
    internal sealed class IdlValueDecoder
    {
        private readonly Dictionary<string, JToken> definitions;
        public IdlValueDecoder(JObject idl) { definitions = idl["types"].ToDictionary(item => (string)item["name"], item => item["type"]); }
        public JToken Decode(BinaryReader reader, JToken type)
        {
            if (type.Type == JTokenType.String)
            {
                switch ((string)type)
                {
                    case "u8": return reader.ReadByte();
                    case "u16": return reader.ReadUInt16();
                    case "u32": return reader.ReadUInt32();
                    case "u64": return reader.ReadUInt64().ToString(CultureInfo.InvariantCulture);
                    case "i64": return reader.ReadInt64().ToString(CultureInfo.InvariantCulture);
                    case "u128": return new BigInteger(Read(reader, 16).Concat(new byte[1]).ToArray()).ToString(CultureInfo.InvariantCulture);
                    case "pubkey": return new PublicKey(Read(reader, 32)).Key;
                    case "bool":
                        byte value = reader.ReadByte();
                        if (value > 1) throw new FormatException("Invalid Borsh boolean");
                        return value != 0;
                    default: throw new NotSupportedException("Unsupported IDL primitive");
                }
            }
            if (type["array"] is JArray array)
            {
                var result = new JArray();
                for (int i = 0; i < (int)array[1]; i++) result.Add(Decode(reader, array[0]));
                return result;
            }
            if (type["option"] != null)
            {
                byte present = reader.ReadByte();
                if (present > 1) throw new FormatException("Invalid Borsh option");
                return present == 0 ? JValue.CreateNull() : Decode(reader, type["option"]);
            }
            if (type["vec"] != null)
            {
                uint count = reader.ReadUInt32();
                if (count > SolanaWire.PacketBytes) throw new FormatException("Instruction vector exceeds packet bound");
                var result = new JArray();
                for (uint i = 0; i < count; i++) result.Add(Decode(reader, type["vec"]));
                return result;
            }
            var definition = definitions[(string)type["defined"]["name"]];
            if ((string)definition["kind"] == "enum")
            {
                byte index = reader.ReadByte();
                var variants = (JArray)definition["variants"];
                if (index >= variants.Count || variants[index]["fields"] != null) throw new FormatException("Invalid IDL enum");
                return new JObject { [(string)variants[index]["name"]] = new JObject() };
            }
            var fields = new JObject();
            foreach (var field in definition["fields"]) fields.Add((string)field["name"], Decode(reader, field["type"]));
            return fields;
        }
        private static byte[] Read(BinaryReader reader, int count)
        {
            var bytes = reader.ReadBytes(count);
            if (bytes.Length != count) throw new FormatException("Truncated Borsh data");
            return bytes;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration
{
    // The checked-in IDL is emitted from the existing client artifact. Instruction
    // order, roles, discriminators and integer widths therefore have one source.
    public sealed class ProtocolBindings
    {
        private readonly JObject idl;
        private readonly IdlValueDecoder values;
        public string ProgramId { get; }
        public ProtocolBindings(string generatedIdl)
        {
            idl = JObject.Parse(generatedIdl);
            values = new IdlValueDecoder(idl);
            ProgramId = (string)idl["address"];
            SolanaAddress.Bytes(ProgramId);
        }

        public SolanaInstruction Instruction(string name, JObject arguments, IReadOnlyDictionary<string, string> accounts)
        {
            var descriptor = idl["instructions"].SingleOrDefault(item => (string)item["name"] == name)
                ?? throw new ArgumentException("Unknown instruction", nameof(name));
            var keys = new List<AccountMeta>();
            foreach (var account in descriptor["accounts"])
            {
                var accountName = (string)account["name"];
                var fixedAddress = (string)account["address"];
                accounts.TryGetValue(accountName, out var supplied);
                if (fixedAddress != null && supplied != null && supplied != fixedAddress)
                    throw new ArgumentException("Incorrect fixed instruction account: " + accountName);
                var address = fixedAddress ?? supplied;
                bool absent = address == null && (bool?)account["optional"] == true;
                if (absent) address = ProgramId;
                if (address == null) throw new ArgumentException("Missing instruction account: " + accountName);
                keys.Add(new AccountMeta(address, !absent && (bool?)account["signer"] == true,
                    !absent && (bool?)account["writable"] == true));
            }
            using var stream = new MemoryStream();
            SolanaWire.Write(stream, descriptor["discriminator"].Values<byte>().ToArray());
            var fields = descriptor["args"].ToArray();
            if (arguments.Properties().Count() != fields.Length) throw new ArgumentException("Unexpected instruction arguments");
            foreach (var argument in fields)
            {
                var value = arguments[(string)argument["name"]];
                if (value == null) throw new ArgumentException("Missing argument: " + argument["name"]);
                Encode(stream, argument["type"], value);
            }
            return new SolanaInstruction(ProgramId, keys, stream.ToArray());
        }

        public DecodedProtocolInstruction DecodeInstruction(SolanaInstruction instruction)
        {
            if (instruction == null || instruction.ProgramId != ProgramId) throw new FormatException("Incorrect instruction program");
            byte[] data = instruction.Data;
            if (data.Length < 8 || data.Length > SolanaWire.PacketBytes) throw new FormatException("Invalid instruction data length");
            var descriptor = idl["instructions"].SingleOrDefault(item => data.Take(8).SequenceEqual(item["discriminator"].Values<byte>()));
            if (descriptor == null) throw new FormatException("Unknown instruction discriminator");
            var declared = descriptor["accounts"].ToArray();
            if (instruction.Accounts.Count < declared.Length || instruction.Accounts.Count > 256) throw new FormatException("Invalid instruction account count");
            var keys = new Dictionary<string, string>();
            for (int index = 0; index < declared.Length; index++)
            {
                var account = declared[index]; var actual = instruction.Accounts[index];
                string fixedAddress = (string)account["address"];
                bool absent = (bool?)account["optional"] == true && actual.Address == ProgramId;
                if ((fixedAddress != null && fixedAddress != actual.Address) || (!absent &&
                    (((bool?)account["signer"] == true && !actual.Signer) || ((bool?)account["writable"] == true && !actual.Writable))))
                    throw new FormatException("Instruction account role or fixed address is invalid");
                keys.Add((string)account["name"], absent ? null : actual.Address);
            }
            using var stream = new MemoryStream(data, false);
            using var reader = new BinaryReader(stream);
            stream.Position = 8;
            var arguments = new JObject();
            try
            {
                foreach (var argument in descriptor["args"])
                    arguments.Add((string)argument["name"], values.Decode(reader, argument["type"]));
            }
            catch (EndOfStreamException error) { throw new FormatException("Truncated instruction data", error); }
            if (stream.Position != stream.Length) throw new FormatException("Trailing instruction data");
            return new DecodedProtocolInstruction((string)descriptor["name"], arguments, keys, instruction.Accounts.Skip(declared.Length).ToArray());
        }

        private void Encode(Stream stream, JToken type, JToken value)
        {
            using var writer = new BinaryWriter(stream, System.Text.Encoding.UTF8, true);
            if (type.Type == JTokenType.String)
            {
                string text = value.ToString();
                switch ((string)type)
                {
                    case "u8": writer.Write(byte.Parse(text, CultureInfo.InvariantCulture)); return;
                    case "u16": writer.Write(ushort.Parse(text, CultureInfo.InvariantCulture)); return;
                    case "u32": writer.Write(uint.Parse(text, CultureInfo.InvariantCulture)); return;
                    case "u64": writer.Write(ulong.Parse(text, CultureInfo.InvariantCulture)); return;
                    case "i64": writer.Write(long.Parse(text, CultureInfo.InvariantCulture)); return;
                    case "bool":
                        if (value.Type != JTokenType.Boolean) throw new ArgumentException("Expected bool");
                        writer.Write((bool)value); return;
                    case "pubkey": writer.Write(SolanaAddress.Bytes((string)value)); return;
                    default: throw new NotSupportedException("Unsupported IDL primitive: " + type);
                }
            }
            if (type["array"] is JArray array)
            {
                if (!(value is JArray items) || items.Count != (int)array[1]) throw new ArgumentException("Incorrect fixed array length");
                foreach (var item in items) Encode(stream, array[0], item);
                return;
            }
            if (type["option"] != null)
            {
                bool present = value.Type != JTokenType.Null;
                writer.Write((byte)(present ? 1 : 0));
                if (present) Encode(stream, type["option"], value);
                return;
            }
            if (type["vec"] != null)
            {
                if (!(value is JArray items) || items.Count > SolanaWire.PacketBytes)
                    throw new ArgumentException("Instruction vector exceeds packet bound");
                writer.Write((uint)items.Count);
                foreach (var item in items) Encode(stream, type["vec"], item);
                if (stream.Length > SolanaWire.PacketBytes) throw new ArgumentException("Instruction data exceeds packet bound");
                return;
            }
            var definitionName = (string)type["defined"]?["name"];
            var definition = idl["types"].SingleOrDefault(item => (string)item["name"] == definitionName)?["type"];
            if (definition == null || (string)definition["kind"] != "enum")
                throw new NotSupportedException("Unsupported IDL type: " + type);
            if (!(value is JObject tagged) || tagged.Count != 1) throw new ArgumentException("Expected one enum variant");
            var variantName = tagged.Properties().Single().Name;
            var variants = definition["variants"].ToArray();
            int index = Array.FindIndex(variants, item => string.Equals((string)item["name"], variantName, StringComparison.OrdinalIgnoreCase));
            if (index < 0 || index > 255 || variants[index]["fields"] != null)
                throw new NotSupportedException("Unsupported enum variant");
            writer.Write((byte)index);
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Solana.Unity.Wallet;

namespace ZKube.Integration
{
    public sealed class AccountMeta
    {
        public string Address { get; }
        public bool Signer { get; }
        public bool Writable { get; }
        public AccountMeta(string address, bool signer, bool writable)
        {
            SolanaAddress.Bytes(address);
            Address = address; Signer = signer; Writable = writable;
        }
    }

    public sealed class SolanaInstruction
    {
        public string ProgramId { get; }
        public IReadOnlyList<AccountMeta> Accounts { get; }
        public byte[] Data => (byte[])data.Clone();
        private readonly byte[] data;
        public SolanaInstruction(string programId, IEnumerable<AccountMeta> accounts, byte[] data)
        {
            SolanaAddress.Bytes(programId);
            ProgramId = programId;
            Accounts = Array.AsReadOnly(accounts.ToArray());
            this.data = (byte[])data.Clone();
        }
    }

    public static class SolanaAddress
    {
        public static byte[] Bytes(string address)
        {
            if (address == null || address.Length > 44) throw new FormatException("Invalid public key");
            var key = new PublicKey(address);
            if (key.KeyBytes.Length != 32 || new PublicKey(key.KeyBytes).Key != address)
                throw new FormatException("Invalid public key");
            return key.KeyBytes;
        }

        public static string Derive(string program, IEnumerable<byte[]> seeds, out byte bump)
        {
            var list = seeds.ToArray();
            if (list.Length > 15 || list.Any(seed => seed == null || seed.Length > 32))
                throw new ArgumentException("Invalid PDA seeds");
            if (!PublicKey.TryFindProgramAddress(list, new PublicKey(Bytes(program)), out var address, out bump))
                throw new InvalidOperationException("No PDA bump found");
            return address.Key;
        }
    }

    // The web3.js legacy and v0 compilers have different account-order contracts.
    // This compiler deliberately supports only the current planners' no-LUT messages.
    public static class SolanaWire
    {
        public const int PacketBytes = 1232;
        private sealed class KeyRole
        {
            public string Address;
            public bool Signer, Writable;
        }

        public static byte[] CompileMessage(string feePayer, string blockhash,
            IReadOnlyList<SolanaInstruction> instructions, bool versionZero)
        {
            SolanaAddress.Bytes(feePayer);
            var blockhashBytes = SolanaAddress.Bytes(blockhash);
            var keys = new List<KeyRole>();
            var roles = new Dictionary<string, KeyRole>(StringComparer.Ordinal);
            void Include(string address, bool signer, bool writable)
            {
                if (!roles.TryGetValue(address, out var role))
                {
                    role = new KeyRole { Address = address };
                    roles.Add(address, role); keys.Add(role);
                }
                role.Signer |= signer; role.Writable |= writable;
            }
            Include(feePayer, true, true);
            foreach (var instruction in instructions)
            {
                Include(instruction.ProgramId, false, false);
                foreach (var account in instruction.Accounts)
                    Include(account.Address, account.Signer, account.Writable);
            }
            if (keys.Count > 256) throw new ArgumentException("Too many static accounts");
            var sorted = keys.OrderBy(key => key.Signer ? 0 : 1).ThenBy(key => key.Writable ? 0 : 1);
            if (!versionZero) sorted = sorted.ThenBy(key => key.Address, LegacyKeyComparer.Instance);
            keys = sorted.ToList();
            var payer = roles[feePayer]; keys.Remove(payer); keys.Insert(0, payer);
            int signers = keys.Count(key => key.Signer);
            if (signers > 127) throw new ArgumentException("Too many required signers");
            var indices = keys.Select((key, index) => (key.Address, index))
                .ToDictionary(pair => pair.Address, pair => (byte)pair.index, StringComparer.Ordinal);
            using var stream = new MemoryStream();
            if (versionZero) stream.WriteByte(0x80);
            stream.WriteByte((byte)signers);
            stream.WriteByte((byte)keys.Count(key => key.Signer && !key.Writable));
            stream.WriteByte((byte)keys.Count(key => !key.Signer && !key.Writable));
            WriteLength(stream, keys.Count);
            foreach (var key in keys) Write(stream, SolanaAddress.Bytes(key.Address));
            Write(stream, blockhashBytes);
            WriteLength(stream, instructions.Count);
            foreach (var instruction in instructions)
            {
                stream.WriteByte(indices[instruction.ProgramId]);
                WriteLength(stream, instruction.Accounts.Count);
                foreach (var account in instruction.Accounts) stream.WriteByte(indices[account.Address]);
                var data = instruction.Data;
                WriteLength(stream, data.Length); Write(stream, data);
            }
            if (versionZero) stream.WriteByte(0); // address table lookup count
            var message = stream.ToArray();
            if (message.Length + 1 + signers * 64 > PacketBytes)
                throw new ArgumentException("Transaction exceeds Solana packet limit");
            return message;
        }

        public static byte[] UnsignedTransaction(byte[] message)
        {
            var parsed = ParseMessage(message);
            using var stream = new MemoryStream();
            WriteLength(stream, parsed.Signers.Length);
            Write(stream, new byte[parsed.Signers.Length * 64]); Write(stream, message);
            var result = stream.ToArray();
            if (result.Length > PacketBytes) throw new FormatException("Transaction exceeds packet limit");
            return result;
        }

        internal sealed class ParsedMessage
        {
            public bool VersionZero;
            public byte[][] Signers;
            public byte[] Blockhash;
            public AccountMeta[] Accounts;
            public SolanaInstruction[] Instructions;
        }

        internal static ParsedMessage ParseMessage(byte[] message)
        {
            var reader = new WireReader(message);
            byte first = reader.Byte();
            bool versionZero = (first & 0x80) != 0;
            if (versionZero && first != 0x80) throw new FormatException("Unsupported transaction version");
            int required = versionZero ? reader.Byte() : first;
            int readonlySigned = reader.Byte(), readonlyUnsigned = reader.Byte();
            int count = reader.Length();
            if (required == 0 || required > count || count > 256 || readonlySigned >= required || readonlyUnsigned > count - required)
                throw new FormatException("Invalid message header");
            var keys = new byte[count][];
            for (int i = 0; i < count; i++) keys[i] = reader.Bytes(32);
            if (keys.Select(Convert.ToBase64String).Distinct().Count() != count)
                throw new FormatException("Duplicate static keys");
            var blockhash = reader.Bytes(32);
            int instructions = reader.Length();
            var roles = keys.Select((key, index) => new AccountMeta(new PublicKey(key).Key, index < required,
                index < required ? index < required - readonlySigned : index < count - readonlyUnsigned)).ToArray();
            var decoded = new List<SolanaInstruction>();
            for (int i = 0; i < instructions; i++)
            {
                int program = reader.Byte();
                if (program >= count) throw new FormatException("Invalid program index");
                int accounts = reader.Length();
                var instructionAccounts = new List<AccountMeta>();
                for (int j = 0; j < accounts; j++)
                {
                    int index = reader.Byte();
                    if (index >= count) throw new FormatException("Invalid account index");
                    instructionAccounts.Add(roles[index]);
                }
                decoded.Add(new SolanaInstruction(roles[program].Address, instructionAccounts, reader.Bytes(reader.Length())));
            }
            if (versionZero && reader.Length() != 0) throw new FormatException("Address table lookups unsupported");
            reader.End();
            return new ParsedMessage { VersionZero = versionZero, Signers = keys.Take(required).ToArray(), Blockhash = blockhash,
                Accounts = roles, Instructions = decoded.ToArray() };
        }

        internal static void Write(Stream stream, byte[] bytes) => stream.Write(bytes, 0, bytes.Length);
        internal static void WriteLength(Stream stream, int value)
        {
            if (value < 0 || value > 65535) throw new ArgumentOutOfRangeException(nameof(value));
            do { byte next = (byte)(value & 127); value >>= 7; stream.WriteByte((byte)(next | (value > 0 ? 128 : 0))); } while (value > 0);
        }

        // Base58 contains only ASCII digits and letters. English collation compares
        // the complete case-folded string first, then resolves case lowercase-first.
        private sealed class LegacyKeyComparer : IComparer<string>
        {
            public static readonly LegacyKeyComparer Instance = new LegacyKeyComparer();
            public int Compare(string left, string right)
            {
                int primary = StringComparer.OrdinalIgnoreCase.Compare(left, right);
                if (primary != 0) return primary;
                for (int i = 0; i < left.Length; i++)
                    if (left[i] != right[i]) return char.IsLower(left[i]) ? -1 : 1;
                return 0;
            }
        }
    }

    internal sealed class WireReader
    {
        private readonly byte[] bytes;
        private int offset;
        public WireReader(byte[] bytes)
        {
            this.bytes = bytes ?? throw new ArgumentNullException(nameof(bytes));
            if (bytes.Length > SolanaWire.PacketBytes) throw new FormatException("Packet too large");
        }
        public byte Byte()
        {
            if (offset >= bytes.Length) throw new FormatException("Truncated wire data");
            return bytes[offset++];
        }
        public byte[] Bytes(int count)
        {
            if (count < 0 || count > bytes.Length - offset) throw new FormatException("Truncated wire data");
            var result = new byte[count]; Array.Copy(bytes, offset, result, 0, count); offset += count; return result;
        }
        public int Length()
        {
            int value = 0;
            for (int i = 0; i < 3; i++)
            {
                byte next = Byte();
                if (i == 2 && next > 3) throw new FormatException("Short vector overflow");
                value |= (next & 127) << (7 * i);
                if ((next & 128) == 0)
                {
                    if (i > 0 && next == 0) throw new FormatException("Noncanonical short vector");
                    return value;
                }
            }
            throw new FormatException("Invalid short vector");
        }
        public byte[] Remainder() => Bytes(bytes.Length - offset);
        public void End() { if (offset != bytes.Length) throw new FormatException("Trailing wire data"); }
    }
}

using System;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using Solana.Unity.Wallet;

namespace ZKube.Integration
{
    public sealed class AccountEnvelope
    {
        public string Address { get; }
        public string Owner { get; }
        public bool Executable { get; }
        public byte[] Data => (byte[])data.Clone();
        private readonly byte[] data;
        public AccountEnvelope(string address, string owner, bool executable, byte[] data)
        {
            SolanaAddress.Bytes(address); SolanaAddress.Bytes(owner);
            Address = address; Owner = owner; Executable = executable; this.data = (byte[])data.Clone();
        }
    }

    public sealed class SessionTokenView
    {
        public string Authority { get; internal set; }
        public string TargetProgram { get; internal set; }
        public string SessionSigner { get; internal set; }
        public string FeePayer { get; internal set; }
        public long ValidUntil { get; internal set; }
    }

    public sealed class SessionTokenBindings
    {
        public string ProgramId { get; }
        private readonly int accountBytes;
        private readonly byte[] accountDiscriminator, createDiscriminator;
        public SessionTokenBindings(string generatedSchema)
        {
            var schema = JObject.Parse(generatedSchema);
            ProgramId = (string)schema["programId"]; SolanaAddress.Bytes(ProgramId);
            accountBytes = (int)schema["accountBytes"];
            accountDiscriminator = schema["accountDiscriminator"].Values<byte>().ToArray();
            createDiscriminator = schema["createDiscriminator"].Values<byte>().ToArray();
        }
        public string Derive(string authority, string sessionSigner, string targetProgram) =>
            SolanaAddress.Derive(ProgramId, new[] { Encoding.UTF8.GetBytes("session_token_v2"),
                SolanaAddress.Bytes(targetProgram), SolanaAddress.Bytes(sessionSigner), SolanaAddress.Bytes(authority) }, out _);

        public SessionTokenView Decode(AccountEnvelope envelope)
        {
            if (envelope.Owner != ProgramId || envelope.Executable) throw new FormatException("Session token has the wrong account owner");
            var data = envelope.Data;
            if (data.Length != accountBytes) throw new FormatException("Session token has an invalid data length");
            if (!data.Take(accountDiscriminator.Length).SequenceEqual(accountDiscriminator))
                throw new FormatException("Session token discriminator is invalid");
            using var stream = new MemoryStream(data, false);
            using var reader = new BinaryReader(stream);
            reader.ReadBytes(accountDiscriminator.Length);
            var view = new SessionTokenView { Authority = new PublicKey(reader.ReadBytes(32)).Key,
                TargetProgram = new PublicKey(reader.ReadBytes(32)).Key, SessionSigner = new PublicKey(reader.ReadBytes(32)).Key,
                FeePayer = new PublicKey(reader.ReadBytes(32)).Key, ValidUntil = reader.ReadInt64() };
            if (view.ValidUntil < -9007199254740991L || view.ValidUntil > 9007199254740991L)
                throw new FormatException("Session token expiry is outside the safe integer range");
            if (envelope.Address != Derive(view.Authority, view.SessionSigner, view.TargetProgram))
                throw new FormatException("Session token PDA does not match its serialized fields");
            return view;
        }

        public SolanaInstruction Create(string authority, string signer, string feePayer, string targetProgram,
            bool? topUp, long? validUntil, ulong? lamports)
        {
            using var stream = new MemoryStream();
            using var writer = new BinaryWriter(stream);
            writer.Write(createDiscriminator);
            writer.Write((byte)(topUp.HasValue ? 1 : 0)); if (topUp.HasValue) writer.Write(topUp.Value);
            writer.Write((byte)(validUntil.HasValue ? 1 : 0)); if (validUntil.HasValue) writer.Write(validUntil.Value);
            writer.Write((byte)(lamports.HasValue ? 1 : 0)); if (lamports.HasValue) writer.Write(lamports.Value);
            return new SolanaInstruction(ProgramId, new[] {
                new AccountMeta(Derive(authority, signer, targetProgram), false, true),
                new AccountMeta(signer, true, true), new AccountMeta(feePayer, true, true),
                new AccountMeta(authority, true, false), new AccountMeta(targetProgram, false, false),
                new AccountMeta("11111111111111111111111111111111", false, false),
            }, stream.ToArray());
        }
    }
}

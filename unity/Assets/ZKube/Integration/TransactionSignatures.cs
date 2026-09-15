using System;
using System.Linq;
using Chaos.NaCl;
using Solana.Unity.Wallet.Utilities;

namespace ZKube.Integration
{
    public static class TransactionSignatures
    {
        public static TransactionDescription Describe(byte[] transaction)
        {
            var parsed = Parse(transaction);
            return new TransactionDescription(parsed.Header.Accounts, parsed.Header.Instructions, parsed.Header.VersionZero);
        }
        public static string ReadBlockhash(byte[] transaction) => new Solana.Unity.Wallet.PublicKey(Parse(transaction).Header.Blockhash).Key;
        public static string ValidateFullySigned(byte[] transaction)
        {
            var parsed = Parse(transaction);
            for (int i = 0; i < parsed.Signatures.Length; i++)
                if (!Ed25519.Verify(parsed.Signatures[i], parsed.Message, parsed.Header.Signers[i]))
                    throw new FormatException("Missing or invalid transaction signature");
            return new Base58Encoder().EncodeData(parsed.Signatures[0]);
        }
        public static void ValidateSignature(string signature)
        {
            if (signature == null || signature.Length > 88) throw new FormatException("Invalid signature length");
            var encoder = new Base58Encoder();
            byte[] bytes = encoder.DecodeData(signature);
            if (bytes.Length != 64 || encoder.EncodeData(bytes) != signature) throw new FormatException("Invalid signature encoding");
        }
        internal sealed class SignedMessage
        {
            public byte[][] Signatures;
            public byte[] Message;
            public SolanaWire.ParsedMessage Header;
        }
        internal static SignedMessage Parse(byte[] transaction)
        {
            var reader = new WireReader(transaction);
            int count = reader.Length();
            if (count == 0 || count > SolanaWire.PacketBytes / 64) throw new FormatException("Invalid signature count");
            var signatures = new byte[count][];
            for (int i = 0; i < count; i++) signatures[i] = reader.Bytes(64);
            var message = reader.Remainder();
            var header = SolanaWire.ParseMessage(message);
            if (header.Signers.Length != count) throw new FormatException("Invalid transaction signature header");
            return new SignedMessage { Signatures = signatures, Message = message, Header = header };
        }
    }
}

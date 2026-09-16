using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text;
using Newtonsoft.Json.Linq;
using Solana.Unity.Wallet;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration
{
    public sealed class AccountBindings
    {
        private readonly JObject idl;
        private readonly IdlValueDecoder values;
        private readonly Dictionary<string, JToken> definitions;
        private readonly uint playerVersion, protocolVersion;
        public string ProgramId { get; }
        public AccountBindings(string generatedIdl, uint playerVersion, uint protocolVersion)
        {
            idl = JObject.Parse(generatedIdl); values = new IdlValueDecoder(idl); ProgramId = (string)idl["address"];
            SolanaAddress.Bytes(ProgramId);
            definitions = idl["types"].ToDictionary(item => (string)item["name"], item => item["type"]);
            this.playerVersion = playerVersion; this.protocolVersion = protocolVersion;
        }

        public JObject PlayerState(AccountEnvelope envelope, string authority)
        {
            var fields = DecodeFixed("PlayerState", envelope);
            var expected = SolanaAddress.Derive(ProgramId, new[] { Encoding.UTF8.GetBytes("player"), SolanaAddress.Bytes(authority) }, out _);
            if (envelope.Address != expected || (string)fields["owner"] != authority || (uint)fields["version"] != playerVersion ||
                (int)fields["highest_ladder_tier"] > NativeEngine.LadderTier(ulong.MaxValue) ||
                (int)fields["featured_frame_tier"] > (int)fields["highest_ladder_tier"] ||
                fields["reserved"].Values<byte>().Any(value => value != 0))
                throw new FormatException("PlayerState relationship is invalid");
            return fields;
        }

        public JObject ProtocolConfig(AccountEnvelope envelope)
        {
            var fields = DecodeFixed("ProtocolConfig", envelope);
            RequireIdentity(envelope, fields, Address("protocol"), protocolVersion);
            return fields;
        }

        public JObject CreditVault(AccountEnvelope envelope)
        {
            var fields = DecodeFixed("CreditVault", envelope);
            RequireIdentity(envelope, fields, Address("credit_vault"), Protocol.ProtocolAccountVersion);
            if ((string)fields["protocol"] != Address("protocol")) throw new FormatException("CreditVault protocol relationship is invalid");
            return fields;
        }


        public JObject ArenaDaily(AccountEnvelope envelope)
        {
            var fields = DecodeFixed("ArenaDaily", envelope);
            return ArenaDaily(envelope, (uint)fields["day_id"]);
        }

        public JObject ArenaDaily(AccountEnvelope envelope, uint expectedDayId)
        {
            var fields = DecodeFixed("ArenaDaily", envelope);
            RequireIdentity(envelope, fields, Address("arena_daily", LittleDay(expectedDayId)), Protocol.ProtocolAccountVersion);
            if ((uint)fields["day_id"] != expectedDayId)
                throw new FormatException("ArenaDaily relationship is invalid");
            return fields;
        }

        public ValidatedBoardAccount ArenaBoard(AccountEnvelope envelope, uint dayId, string kind)
        {
            if (kind != "score" && kind != "theme") throw new FormatException("Invalid board kind");
            if (envelope == null) return null;
            int headerBytes = FixedAccountBytes("ArenaBoard");
            var entryType = new JObject { ["defined"] = new JObject { ["name"] = "ArenaBoardEntry" } };
            int rowBytes = MaximumSize(entryType);
            var data = envelope.Data;
            if (envelope.Owner != ProgramId || envelope.Executable || data.Length < headerBytes ||
                data.Length > headerBytes + Protocol.ArenaBoardCapacity * rowBytes + (Protocol.ArenaBoardCapacity + 7) / 8)
                throw new FormatException("Board account owner or bounded length is invalid");
            var header = DecodeFixed("ArenaBoard", new AccountEnvelope(envelope.Address, envelope.Owner,
                false, data.Take(headerBytes).ToArray()));
            string daily = Address("arena_daily", LittleDay(dayId));
            string expected = Address("arena_board", SolanaAddress.Bytes(daily), Encoding.UTF8.GetBytes(kind));
            RequireIdentity(envelope, header, expected, Protocol.ProtocolAccountVersion);
            if ((string)header["arena_daily"] != daily || (uint)header["day_id"] != dayId ||
                !string.Equals(((JObject)header["kind"]).Properties().Single().Name, kind, StringComparison.OrdinalIgnoreCase))
                throw new FormatException("Board relationship is invalid");
            uint count = (uint)header["payout_count"], cursor = (uint)header["cursor"];
            long sealedAt = (long)header["sealed_at"];
            bool sealedBoard = cursor == count;
            if (count > Protocol.ArenaBoardCapacity || cursor > count || count > (uint)header["width_count"] ||
                count > (uint)header["qualified_count"] || (bool)header["capacity_limited"] != (count < (uint)header["width_count"]) ||
                (count > 0 && BigInteger.Parse((string)header["denominator"], CultureInfo.InvariantCulture) == 0) ||
                (!sealedBoard && sealedAt != 0) || (sealedBoard && sealedAt <= 0) || sealedAt > 9007199254740991L ||
                (uint)header["claimed_count"] > count ||
                data.Length != headerBytes + (long)cursor * rowBytes + (count + 7) / 8)
                throw new FormatException("Board allocation is invalid");
            int rowsEnd = checked(headerBytes + (int)cursor * rowBytes);
            uint claimedBits = 0;
            for (int i = rowsEnd; i < data.Length; i++)
            {
                byte bits = data[i];
                for (int bit = 0; bit < 8; bit++) if ((bits & (1 << bit)) != 0) claimedBits++;
            }
            if (claimedBits != (uint)header["claimed_count"] ||
                (count % 8 != 0 && (data[data.Length - 1] & (255 << (int)(count % 8))) != 0) ||
                (!sealedBoard && claimedBits != 0)) throw new FormatException("Board claimed bitmap is invalid");
            var rows = new List<ValidatedBoardRow>();
            var players = new HashSet<string>(StringComparer.Ordinal);
            using var stream = new MemoryStream(data, false);
            using var reader = new BinaryReader(stream);
            stream.Position = headerBytes;
            ValidatedBoardRow previous = null;
            for (uint position = 0; position < cursor; position++)
            {
                var row = (JObject)Decode(reader, entryType);
                string player = (string)row["player"];
                if (!players.Add(player)) throw new FormatException("Board contains duplicate players");
                var accepted = new ValidatedBoardRow(position, player, (uint)row["score"], (ulong)row["objective_total"],
                    (long)row["finalized_at"],
                    (data[rowsEnd + (int)(position / 8)] & (1 << (int)(position % 8))) != 0);
                ulong metric = kind == "score" ? accepted.Score : accepted.ObjectiveTotal;
                if (metric == 0 || accepted.FinalizedAt < 0 || accepted.FinalizedAt > 9007199254740991L ||
                    (previous != null && BoardOrder.Compare(kind == "score" ? previous.Score : previous.ObjectiveTotal,
                        previous.FinalizedAt, previous.Player, metric, accepted.FinalizedAt, player) >= 0))
                    throw new FormatException("Board rows must have positive metrics in canonical order");
                previous = accepted;
                if (sealedBoard) rows.Add(accepted);
            }
            return new ValidatedBoardAccount(envelope.Address, dayId, kind, count, (uint)header["qualified_count"],
                BigInteger.Parse((string)header["denominator"], CultureInfo.InvariantCulture), (ulong)header["pool_lamports"],
                sealedAt, sealedBoard, (bool)header["capacity_limited"], rows.ToArray(),
                (uint)header["width_count"], (ulong)header["paid_lamports"], (ulong)header["rollover_lamports"], (ulong)header["claimed_lamports"]);
        }


        public IReadOnlyList<ValidatedBoardReward> BoardRewards(AccountEnvelope envelope, uint dayId, string kind, string owner)
        {
            SolanaAddress.Bytes(owner);
            var board = ArenaBoard(envelope, dayId, kind);
            return board == null ? Array.Empty<ValidatedBoardReward>() : Array.AsReadOnly(board.Rows.Where(row => row.Player == owner)
                .Select(row => new ValidatedBoardReward(dayId, kind, row.Position, board.SealedAt, row.Claimed, owner, board.Address)).ToArray());
        }

        public JObject ArenaPlayer(AccountEnvelope envelope, uint dayId, string owner)
        {
            var fields = DecodeFixed("ArenaPlayer", envelope);
            string daily = Address("arena_daily", LittleDay(dayId));
            RequireIdentity(envelope, fields, Address("arena_player", SolanaAddress.Bytes(daily), SolanaAddress.Bytes(owner)), Protocol.ProtocolAccountVersion);
            if ((string)fields["challenge"] != daily || (string)fields["player"] != owner ||
                (uint)fields["resolved_entries"] > (uint)fields["paid_entries"] ||
                ((uint)fields["score_best_entry"]["score"] > 0 && (string)fields["score_best_entry"]["player"] != owner) ||
                ((ulong)fields["theme_best_entry"]["objective_total"] > 0 && (string)fields["theme_best_entry"]["player"] != owner))
                throw new FormatException("ArenaPlayer relationship is invalid");
            return fields;
        }

        private string Address(string seed, params byte[][] parts) => SolanaAddress.Derive(ProgramId,
            new[] { Encoding.UTF8.GetBytes(seed) }.Concat(parts), out _);
        private static byte[] LittleDay(uint value)
        {
            using var stream = new MemoryStream();
            using var writer = new BinaryWriter(stream); writer.Write(value); return stream.ToArray();
        }
        private static void RequireIdentity(AccountEnvelope envelope, JObject fields, string address, uint version)
        {
            if (envelope.Address != address || (uint)fields["version"] != version) throw new FormatException("Account PDA or version is invalid");
        }

        public JObject ActiveRun(AccountEnvelope envelope, string authority)
        {
            var fields = DecodeFixed("ActiveRun", envelope);
            using var runBytes = new MemoryStream();
            using (var writer = new BinaryWriter(runBytes, Encoding.UTF8, true)) writer.Write((ulong)fields["run_id"]);
            var expected = SolanaAddress.Derive(ProgramId, new[] { Encoding.UTF8.GetBytes("run"), Encoding.UTF8.GetBytes("active"),
                SolanaAddress.Bytes(authority), runBytes.ToArray() }, out _);
            if (envelope.Address != expected || (string)fields["owner"] != authority || (uint)fields["version"] != protocolVersion ||
                (ulong)fields["run_id"] == 0)
                throw new FormatException("ActiveRun relationship is invalid");
            return fields;
        }

        public int FixedAccountBytes(string name) => checked(8 + MaximumSize(new JObject { ["defined"] = new JObject { ["name"] = name } }));

        // Borsh options occupy their encoded width; Anchor fixed account allocation
        // reserves maximum width. Only zeroed allocation padding is accepted.
        private JObject DecodeFixed(string name, AccountEnvelope envelope)
        {
            if (envelope.Owner != ProgramId || envelope.Executable) throw new FormatException(name + " has an invalid account owner");
            int size = FixedAccountBytes(name);
            var data = envelope.Data;
            if (size > 1048576 || data.Length != size) throw new FormatException(name + " has an invalid data length");
            var descriptor = idl["accounts"].Single(item => (string)item["name"] == name);
            if (!data.Take(8).SequenceEqual(descriptor["discriminator"].Values<byte>())) throw new FormatException(name + " discriminator is invalid");
            using var stream = new MemoryStream(data, false);
            using var reader = new BinaryReader(stream);
            reader.ReadBytes(8);
            var result = (JObject)Decode(reader, new JObject { ["defined"] = new JObject { ["name"] = name } });
            while (stream.Position < stream.Length) if (reader.ReadByte() != 0) throw new FormatException("Nonzero account allocation padding");
            return result;
        }

        private int MaximumSize(JToken type)
        {
            if (type.Type == JTokenType.String)
            {
                switch ((string)type)
                {
                    case "u8": case "bool": return 1;
                    case "u16": return 2;
                    case "u32": return 4;
                    case "u64": case "i64": return 8;
                    case "u128": return 16;
                    case "pubkey": return 32;
                    default: throw new NotSupportedException("Unbounded or unsupported account type: " + type);
                }
            }
            if (type["array"] is JArray array) return checked(MaximumSize(array[0]) * (int)array[1]);
            if (type["option"] != null) return checked(1 + MaximumSize(type["option"]));
            var definition = definitions[(string)type["defined"]["name"]];
            if ((string)definition["kind"] == "struct") return definition["fields"].Sum(field => MaximumSize(field["type"]));
            if ((string)definition["kind"] == "enum" && definition["variants"].All(variant => variant["fields"] == null)) return 1;
            throw new NotSupportedException("Unsupported account definition");
        }

        private JToken Decode(BinaryReader reader, JToken type) => values.Decode(reader, type);
    }
}

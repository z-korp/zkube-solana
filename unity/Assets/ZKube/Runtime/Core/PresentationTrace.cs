using System;
using System.Collections.Generic;
using ZKube.Core.Generated;

namespace ZKube.Core
{
    public sealed class PresentationEvent
    {
        public PresentationKind Kind { get; }
        public byte[] Payload { get; }
        internal PresentationEvent(PresentationKind kind, byte[] payload) { Kind = kind; Payload = payload; }
    }

    public static class PresentationTrace
    {
        public static PresentationEvent[] Decode(byte[] bytes)
        {
            if (bytes == null) throw new ArgumentNullException(nameof(bytes));
            if (bytes.Length < 6 || NativeWire.Read(bytes, 0, 2) != NativeSchema.AbiVersion)
                throw new ArgumentException("Invalid trace version");
            uint count = checked((uint)NativeWire.Read(bytes, 2, 4));
            if (count > (bytes.Length - 6) / 4) throw new ArgumentException("Invalid trace count");
            var events = new List<PresentationEvent>(checked((int)count));
            int offset = 6;
            for (uint i = 0; i < count; i++)
            {
                if (offset > bytes.Length - 3) throw new ArgumentException("Truncated trace event");
                var kind = (PresentationKind)bytes[offset];
                int length = checked((int)NativeWire.Read(bytes, offset + 1, 2));
                if (length != PresentationSchema.PayloadLength(kind)) throw new ArgumentException("Invalid trace payload length");
                var payload = NativeWire.Bytes(bytes, offset + 3, length);
                if (kind == PresentationKind.PerfectClear && payload[0] > 1)
                    throw new ArgumentException("Invalid perfect-clear grant flag");
                events.Add(new PresentationEvent(kind, payload));
                offset += 3 + length;
            }
            if (offset != bytes.Length) throw new ArgumentException("Trailing trace bytes");
            return events.ToArray();
        }

        // Applies explicit engine facts to the displayed board.
        // No collision test, gravity solver, line discovery or scoring lives here.
        public static byte[] ProjectBoard(byte[] initial, IEnumerable<PresentationEvent> events)
        {
            if (initial == null || initial.Length != 80) throw new ArgumentException("Invalid board length");
            var cells = (byte[])initial.Clone();
            foreach (var e in events)
            {
                var p = e.Payload;
                switch (e.Kind)
                {
                    case PresentationKind.BlockMoved:
                        if (p[0] > 1 || p[1] >= 10 || p[3] >= 10 || p[5] < 1 || p[5] > 4 || p[2] + p[5] > 8 || p[4] + p[5] > 8)
                            throw new ArgumentException("Invalid movement event");
                        int source = p[1] * 8 + p[2], target = p[3] * 8 + p[4];
                        for (int i = 0; i < p[5]; i++)
                            if (cells[source + i] != p[5]) throw new ArgumentException("Trace does not match display snapshot");
                        Array.Clear(cells, source, p[5]);
                        for (int i = 0; i < p[5]; i++) cells[target + i] = p[5];
                        break;
                    case PresentationKind.RowsCleared:
                        uint mask = (uint)NativeWire.Read(p, 0, 2);
                        if ((mask & ~1023U) != 0) throw new ArgumentException("Invalid clear mask");
                        for (int row = 0; row < 10; row++) if ((mask & (1U << row)) != 0) Array.Clear(cells, row * 8, 8);
                        break;
                    case PresentationKind.RowInserted:
                        Array.Copy(cells, 0, cells, 8, 72);
                        Array.Copy(p, 0, cells, 0, 8);
                        break;
                    case PresentationKind.BonusApplied:
                        if (p[0] < 1 || p[0] > 3) throw new ArgumentException("Invalid bonus event");
                        for (int row = 0; row < 10; row++)
                            for (int col = 0; col < 8; col++)
                                if ((p[1 + row] & (1 << col)) != 0) cells[row * 8 + col] = 0;
                        break;
                    case PresentationKind.BoardReplaced:
                        Array.Copy(p, cells, 80);
                        break;
                    case PresentationKind.PreviewChanged:
                        if (p[0] > 1) throw new ArgumentException("Invalid preview presence flag");
                        break;
                    case PresentationKind.Terminal:
                        if (p[0] < 1 || p[0] > 4) throw new ArgumentException("Invalid terminal reason");
                        break;
                    case PresentationKind.PerfectClear:
                        if (p[0] > 1) throw new ArgumentException("Invalid perfect-clear grant flag");
                        break;
                    default: throw new ArgumentException("Unknown presentation event");
                }
            }
            return cells;
        }
    }
}

using System;
using System.Collections.Generic;

namespace ZKube.Presentation
{
    public enum BoardNotice { Waiting, Outside, Queued, Totem, Wave, Hammer, Pending, WaitingRow, Accepted, Changed, Unavailable, Recover, Recovering }
    // Status copy has one source so the typography pass can reserve every
    // message before play; pending feedback never needs to rebuild the board.
    public static class BoardNotices
    {
        public static string Text(BoardNotice notice)
        {
            switch (notice)
            {
                case BoardNotice.Waiting: return "Waiting for a run";
                case BoardNotice.Outside: return "Keep the block inside the board";
                case BoardNotice.Queued: return "Swipe queued";
                case BoardNotice.Totem: return "Tap a block to choose its size";
                case BoardNotice.Wave: return "Tap a row for Wave";
                case BoardNotice.Hammer: return "Tap a block for Hammer";
                case BoardNotice.Pending: return "Pending acceptance…";
                case BoardNotice.WaitingRow: return "Accepted · waiting for next row…";
                case BoardNotice.Accepted: return "Accepted";
                case BoardNotice.Changed: return "Board changed · swipe again";
                case BoardNotice.Unavailable: return "That move is unavailable";
                case BoardNotice.Recover: return "Unable to complete the action · recover the run";
                case BoardNotice.Recovering: return "Checking the latest accepted state…";
                default: throw new ArgumentOutOfRangeException(nameof(notice));
            }
        }
        public static string Ready(bool daily, byte pressure) => daily ? "PRESSURE " + pressure : "";
        public static IEnumerable<string> All()
        {
            foreach (BoardNotice notice in Enum.GetValues(typeof(BoardNotice))) yield return Text(notice);
            yield return Ready(true, byte.MaxValue);
        }
    }
}

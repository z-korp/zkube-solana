using System;
using System.Collections.Generic;

namespace ZKube.Presentation
{
    // Players read these; protocol words stay out. A wait for the network shows
    // as the board's quiet waiting indicator, not as a notice.
    public enum BoardNotice { Waiting, Queued, Totem, Wave, Hammer, Unavailable, Recover, Recovering, Settled }
    // Status copy has one source so the typography pass can reserve every
    // message before play; pending feedback never needs to rebuild the board.
    public static class BoardNotices
    {
        public static string Text(BoardNotice notice)
        {
            switch (notice)
            {
                case BoardNotice.Waiting: return "Waiting for a run";
                case BoardNotice.Queued: return "Swipe queued";
                case BoardNotice.Totem: return "Tap a size to clear it";
                case BoardNotice.Wave: return "Tap a row to clear it";
                case BoardNotice.Hammer: return "Tap a block to break it";
                case BoardNotice.Unavailable: return "That move is unavailable";
                case BoardNotice.Recover: return "Unable to complete the action · recover the run";
                case BoardNotice.Recovering: return "Checking your last move…";
                case BoardNotice.Settled: return "That move did not go through";
                default: throw new ArgumentOutOfRangeException(nameof(notice));
            }
        }
        // What a chosen guardian bonus asks for next.
        public static string Prompt(byte bonus) => Text(bonus == 2 ? BoardNotice.Totem : bonus == 3 ? BoardNotice.Wave : BoardNotice.Hammer);
        public static IEnumerable<string> All()
        {
            foreach (BoardNotice notice in Enum.GetValues(typeof(BoardNotice))) yield return Text(notice);
        }
    }
}

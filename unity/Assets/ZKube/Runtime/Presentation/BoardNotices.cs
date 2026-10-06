using ZKube.Core.Generated;
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
                case BoardNotice.Waiting: return Words.BoardNoticeWaiting;
                case BoardNotice.Queued: return Words.BoardNoticeQueued;
                case BoardNotice.Totem: return Words.BoardNoticeTotem;
                case BoardNotice.Wave: return Words.BoardNoticeWave;
                case BoardNotice.Hammer: return Words.BoardNoticeHammer;
                case BoardNotice.Unavailable: return Words.BoardNoticeUnavailable;
                case BoardNotice.Recover: return Words.BoardNoticeRecover;
                case BoardNotice.Recovering: return Words.BoardNoticeRecovering;
                case BoardNotice.Settled: return Words.BoardNoticeSettled;
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

using System;
using System.Collections.Generic;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Each thing the guardian teaches once: the guided first run, a board moment
    // the first time it happens, the stars on the first preview and each
    // product's Daily.
    public enum Lesson { GuidedRun, Wave, Hammer, Totem, Star, EmptyBoard, Stars, RealmsDaily, ArenaDaily }

    // What the guardian has taught on this device, beside the realms it has
    // greeted (GuardianGreetings), and every lesson's line. How to play replays
    // the same lines over their cards.
    public sealed class Lessons
    {
        private const string Key = "zkube.taught";
        private readonly Func<int> read;
        private readonly Action<int> write;
        public Lessons(Func<int> read, Action<int> write)
        {
            this.read = read ?? throw new ArgumentNullException(nameof(read));
            this.write = write ?? throw new ArgumentNullException(nameof(write));
        }
        // The device's record; a test sets its own.
        public static Lessons Device { get; set; } =
            new Lessons(() => PlayerPrefs.GetInt(Key, 0), value => { PlayerPrefs.SetInt(Key, value); PlayerPrefs.Save(); });
        // A record held in memory: none taught, or every one.
        public static Lessons Memory(bool taught = false) { int bits = taught ? ~0 : 0; return new Lessons(() => bits, value => bits = value); }

        public bool Taught(Lesson lesson) => (read() & 1 << (int)lesson) != 0;
        public void Teach(Lesson lesson) => write(read() | 1 << (int)lesson);
        // Skip tips: every lesson the board teaches is marked taught.
        public void TeachTheBoard()
        {
            foreach (var lesson in new[] { Lesson.GuidedRun, Lesson.Wave, Lesson.Hammer, Lesson.Totem, Lesson.Star, Lesson.EmptyBoard }) Teach(lesson);
        }

        // The guided first run, in Mako's voice.
        public static string Slide => Words.LessonSlide;
        public static string Clears => Words.LessonClears;
        public static string Falls => Words.LessonFalls;
        public static string Rises => Words.LessonRises;
        public static string MovesLeft(int moves) => Words.LessonMovesLeft(moves);
        public static string TapGoal => Words.LessonTapGoal;
        public static string Reroll => Words.LessonReroll;
        public static string Skip => Words.LessonSkip;

        // The board's moments, in any guardian's voice.
        public static string Charge(byte bonus) => bonus switch
        {
            1 => Words.LessonCharge1,
            3 => Words.LessonCharge3,
            _ => Words.LessonCharge2,
        };
        public static Lesson ChargeLesson(byte bonus) => bonus == 1 ? Lesson.Hammer : bonus == 3 ? Lesson.Wave : Lesson.Totem;
        public static string ChargeCard(byte bonus) => bonus == 1 ? SkinSlots.LessonHammer : bonus == 3 ? SkinSlots.LessonWave : SkinSlots.LessonTotem;
        public static string Star => Words.LessonStar;
        public static string EmptyBoard => Words.LessonEmptyBoard(Number(Protocol.ChargeCap));

        // The first preview of the first level: its stars and their counters.
        public static TalkPage[] Stars => new[] {
            new TalkPage(Words.LessonStars1, "greeting", SkinSlots.LessonStars),
            new TalkPage(Words.LessonStars2, "idle", SkinSlots.LessonStars) };
        public static string Opens(string realm) => Words.LevelOpens(realm);

        // What a Daily run is, the same in both products: one copy of it.
        public static TalkPage DailyRun => new TalkPage(Words.LessonDailyRun(Protocol.DailyMaxMoves),
            "idle", SkinSlots.LessonDaily);
        // Each product's Daily, before its first play: its own entry, the run, then what its scores are for.
        public static TalkPage[] RealmsDaily(bool leaderboard)
        {
            var pages = new List<TalkPage> { new TalkPage(Words.LessonRealmsDaily, "greeting", SkinSlots.LessonDaily), DailyRun };
            if (leaderboard) pages.Add(new TalkPage(Words.LessonRealmsLeaderboard, "satisfied", SkinSlots.LessonDaily));
            return pages.ToArray();
        }
        public static TalkPage[] ArenaDaily => new[] {
            new TalkPage(Words.LessonArenaEntry, "greeting", SkinSlots.LessonDaily),
            DailyRun,
            new TalkPage(Words.LessonArenaBoards, "idle", SkinSlots.LessonDaily),
            new TalkPage(Words.LessonArenaPrize, "satisfied", SkinSlots.LessonDaily),
            new TalkPage(Words.LessonArenaLadder, "idle", SkinSlots.LessonDaily) };

        // How to play: every lesson in the order a player meets it, then the product's Daily.
        public static TalkPage[] HowToPlay(bool arena)
        {
            var pages = new List<TalkPage> {
                new TalkPage(Slide, "greeting", SkinSlots.LessonSlide),
                new TalkPage(Clears, "idle", SkinSlots.LessonClear),
                new TalkPage(Rises, "idle", SkinSlots.LessonNextRow),
                new TalkPage(Words.LessonRunEnds, "idle", SkinSlots.LessonTop) };
            pages.AddRange(Stars);
            pages.Add(new TalkPage(Words.LessonBonus(Number(Protocol.ChargeCap)),
                "idle", SkinSlots.LessonCharge));
            pages.Add(new TalkPage(Words.LessonDoes3, "idle", SkinSlots.LessonWave));
            pages.Add(new TalkPage(Words.LessonDoes1, "idle", SkinSlots.LessonHammer));
            pages.Add(new TalkPage(Words.LessonDoes2, "idle", SkinSlots.LessonTotem));
            pages.Add(new TalkPage(Words.LessonRerollDoes, "idle", SkinSlots.LessonReroll));
            pages.Add(new TalkPage(Words.LessonGuardian, "satisfied", SkinSlots.LessonGuardian));
            pages.AddRange(arena ? ArenaDaily : RealmsDaily(false));
            return pages.ToArray();
        }
        // A small count as a word ("three"), as the language writes it.
        private static string Number(int value) => value switch { 1 => Words.Number1, 2 => Words.Number2, 3 => Words.Number3, 4 => Words.Number4, 5 => Words.Number5,
            _ => Words.Number((long)value) };
    }
}

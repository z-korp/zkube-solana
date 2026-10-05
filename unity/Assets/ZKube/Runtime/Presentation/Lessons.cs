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
        public const string Slide = "Slide a block along its row.";
        public const string Clears = "A full line clears. Everything above it falls.";
        public const string Falls = "Blocks fall into any gap below them.";
        public const string Rises = "After every move, the next row rises from below.";
        public static string MovesLeft(int moves) => moves + " moves left. Fill the goals before the blocks reach the top.";
        public const string TapGoal = "Tap a goal any time to read it.";
        public const string Reroll = "Not keen on the next row? Swap it here. The tide is yours now.";
        public const string Skip = "Skip tips";

        // The board's moments, in any guardian's voice.
        public static string Charge(byte bonus) => bonus switch
        {
            1 => "You earned a Hammer! Tap it, then a block. It costs no move.",
            3 => "You earned a Wave! Tap it, then a row. It costs no move.",
            _ => "You earned a Totem! Tap it, then a block: every block that size breaks.",
        };
        public static Lesson ChargeLesson(byte bonus) => bonus == 1 ? Lesson.Hammer : bonus == 3 ? Lesson.Wave : Lesson.Totem;
        public static string ChargeCard(byte bonus) => bonus == 1 ? SkinSlots.LessonHammer : bonus == 3 ? SkinSlots.LessonWave : SkinSlots.LessonTotem;
        public const string Star = "A star! Each goal you meet keeps its star.";
        public static string EmptyBoard => "An empty board earns a reroll. You can hold " + Number(Protocol.ChargeCap) + ".";

        // The first preview of the first level: its stars and their counters.
        public static TalkPage[] Stars => new[] {
            new TalkPage("Three goals, three stars. Light all three and the level is yours.", "greeting", SkinSlots.LessonStars),
            new TalkPage("A bar fills over the whole run. A ring needs one single move.", "idle", SkinSlots.LessonStars) };
        public static string Opens(string realm) => "Opens " + realm;

        // What a Daily run is, the same in both products: one copy of it.
        public static TalkPage DailyRun => new TalkPage("The Daily has no stars. Score all you can in " + Protocol.DailyMaxMoves + " moves; points grow as you climb.",
            "idle", SkinSlots.LessonDaily);
        // Each product's Daily, before its first play: its own entry, the run, then what its scores are for.
        public static TalkPage[] RealmsDaily(bool leaderboard)
        {
            var pages = new List<TalkPage> { new TalkPage("One try a day, and the same board for everyone.", "greeting", SkinSlots.LessonDaily), DailyRun };
            if (leaderboard) pages.Add(new TalkPage("Your best score goes on the leaderboard.", "satisfied", SkinSlots.LessonDaily));
            return pages.ToArray();
        }
        public static TalkPage[] ArenaDaily => new[] {
            new TalkPage("Each entry costs one Kredit. Play as often as you like; your best run counts.", "greeting", SkinSlots.LessonDaily),
            DailyRun,
            new TalkPage("Two boards: one for points, one for today's goal.", "idle", SkinSlots.LessonDaily),
            new TalkPage("The top places share the prize. Claim it within thirty days.", "satisfied", SkinSlots.LessonDaily),
            new TalkPage("Every Daily you score in adds ladder points. They never fade.", "idle", SkinSlots.LessonDaily) };

        // How to play: every lesson in the order a player meets it, then the product's Daily.
        public static TalkPage[] HowToPlay(bool arena)
        {
            var pages = new List<TalkPage> {
                new TalkPage(Slide, "greeting", SkinSlots.LessonSlide),
                new TalkPage(Clears, "idle", SkinSlots.LessonClear),
                new TalkPage(Rises, "idle", SkinSlots.LessonNextRow),
                new TalkPage("The run ends when the blocks reach the top or your moves run out.", "idle", SkinSlots.LessonTop) };
            pages.AddRange(Stars);
            pages.Add(new TalkPage("Each guardian has its own bonus. Its rule, beside the bonus, earns a charge; you can hold " + Number(Protocol.ChargeCap) + ".",
                "idle", SkinSlots.LessonCharge));
            pages.Add(new TalkPage("A Wave clears one row.", "idle", SkinSlots.LessonWave));
            pages.Add(new TalkPage("A Hammer breaks one block.", "idle", SkinSlots.LessonHammer));
            pages.Add(new TalkPage("A Totem breaks every block the size of the one you tap.", "idle", SkinSlots.LessonTotem));
            pages.Add(new TalkPage("A reroll swaps the next row. Every run starts with one; an empty board earns another.", "idle", SkinSlots.LessonReroll));
            pages.Add(new TalkPage("Beat a guardian's level to open the next realm.", "satisfied", SkinSlots.LessonGuardian));
            pages.AddRange(arena ? ArenaDaily : RealmsDaily(false));
            return pages.ToArray();
        }
        private static string Number(int value) => value switch { 1 => "one", 2 => "two", 3 => "three", 4 => "four", 5 => "five", _ => value.ToString() };
    }
}

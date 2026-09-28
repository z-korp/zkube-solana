using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The moments a guardian speaks, each with its authored line and mood.
    public enum TalkMoment { Greeting, Passage, Daily, TrialIntro, Win, Ended, GuardianDefeated, NewBest }

    // One page of dialogue: the line, the face the guardian rests on after it,
    // and an optional rule shown once the line is complete.
    public sealed class TalkPage
    {
        public string Line, Mood, RuleHeading, Rule;
        public TalkPage(string line, string mood, string ruleHeading = null, string rule = null)
        {
            if (string.IsNullOrWhiteSpace(line)) throw new ArgumentException("A guardian page needs a line", nameof(line));
            Line = line; Mood = mood ?? "idle"; RuleHeading = ruleHeading; Rule = rule;
        }

        // The authored line for a moment, and the face it is spoken with. A
        // realm's first visit after its predecessor's guardian fell (Passage)
        // is followed by its greeting; see Pages.
        public static TalkPage For(PageCatalog.GuardianLines lines, TalkMoment moment, int stars = 0) => moment switch
        {
            TalkMoment.Greeting => new TalkPage(lines.greeting, "greeting"),
            TalkMoment.Passage => new TalkPage(lines.respectLine, "satisfied"),
            TalkMoment.Daily => new TalkPage(lines.dailyGreeting, "greeting"),
            TalkMoment.TrialIntro => new TalkPage(lines.trialIntro, "idle"),
            TalkMoment.Win => new TalkPage(lines.Stars(stars), stars >= 3 ? "celebrate" : "satisfied"),
            TalkMoment.Ended => new TalkPage(lines.incomplete, "defeated"),
            TalkMoment.GuardianDefeated => new TalkPage(lines.defeatLine, "defeated"),
            TalkMoment.NewBest => new TalkPage(lines.newBestLine, "surprised"),
            _ => throw new ArgumentOutOfRangeException(nameof(moment)),
        };

        // The map's greeting: the passage line on a realm opened by beating the
        // previous guardian, then the greeting, whose box shows the guardian's
        // rule once the line is complete.
        public static TalkPage[] MapGreeting(PageCatalog.RealmPage realm, PageCatalog.GuardianRule rule, bool passage)
        {
            var pages = new List<TalkPage>();
            if (passage) pages.Add(For(realm.guardianLines, TalkMoment.Passage));
            var greeting = For(realm.guardianLines, TalkMoment.Greeting);
            if (rule != null) { greeting.RuleHeading = HudLayout.GuardianCaption(rule.bonus); greeting.Rule = rule.description; }
            pages.Add(greeting);
            return pages.ToArray();
        }
    }

    // The guardian's dialogue box: the realm's ledge rail as its top, the
    // guardian leaning on it (body, rail, paws), a name tag, and each line typed
    // letter by letter with holds on punctuation while the mouth flaps between
    // idle, talk-open and talk-mid. Then the guardian rests on the page's mood;
    // idle blinks. A tap completes the line, the next tap turns the page, and the
    // last one finishes. Reduced motion shows each line at once on its mood.
    public sealed class GuardianTalk : MonoBehaviour, IPointerClickHandler
    {
        public const float LetterSeconds = .028f, CommaHold = .12f, StopHold = .28f, FlapSeconds = .09f, BlinkSeconds = .12f;
        private static readonly string[] Flaps = { "talk-open", "talk-mid", "idle", "talk-mid" };
        private BoardArt art;
        private Image guardian;
        private TMP_Text line, ruleHeading, rule, cue;
        private TalkPage[] pages;
        private Action finished;
        private int page, shown;
        private float nextLetter, flapUntil, nextBlink, blinkUntil;
        private int flap;
        public int Page => page;
        public bool Typing { get; private set; }
        public string Face { get; private set; }
        public string Shown => line.text.Substring(0, Mathf.Min(shown, line.text.Length));
        public bool Done { get; private set; }

        internal void Bind(BoardArt source, Image frame, TMP_Text text, TMP_Text heading, TMP_Text ruleText, TMP_Text continueCue,
            TalkPage[] talk, Action onFinished)
        {
            if (talk == null || talk.Length == 0) throw new ArgumentException("A guardian needs something to say", nameof(talk));
            art = source; guardian = frame; line = text; ruleHeading = heading; rule = ruleText; cue = continueCue;
            pages = talk; finished = onFinished;
            Open(0);
        }

        private void Open(int index)
        {
            page = index; var current = pages[index];
            line.text = current.Line; shown = 0;
            ruleHeading.text = current.RuleHeading ?? ""; rule.text = current.Rule ?? "";
            ruleHeading.gameObject.SetActive(false); rule.gameObject.SetActive(false); cue.gameObject.SetActive(false);
            Typing = true; nextLetter = Time.unscaledTime; flapUntil = 0; flap = 0;
            if (AppPreferences.ReducedMotion) Complete();
            else Show(Flaps[0]);
            line.maxVisibleCharacters = shown;
        }

        // Shows the whole line and rests on the page's mood.
        public void Complete()
        {
            shown = line.text.Length; line.maxVisibleCharacters = shown; Typing = false;
            ruleHeading.gameObject.SetActive(!string.IsNullOrEmpty(ruleHeading.text));
            rule.gameObject.SetActive(!string.IsNullOrEmpty(rule.text));
            cue.gameObject.SetActive(true);
            Show(pages[page].Mood);
            nextBlink = Time.unscaledTime + 2.4f;
        }

        public void OnPointerClick(PointerEventData eventData) => Tap();
        public void Tap()
        {
            if (Done) return;
            if (Typing) { Complete(); return; }
            if (page + 1 < pages.Length) { Open(page + 1); return; }
            Done = true; finished?.Invoke();
        }

        private void Show(string frame)
        {
            if (Face == frame) return;
            Face = frame; guardian.sprite = art.Sprite("boss__" + frame);
        }

        private void Update()
        {
            float now = Time.unscaledTime;
            if (Typing)
            {
                while (Typing && now >= nextLetter)
                {
                    shown++;
                    if (shown >= line.text.Length) { Complete(); break; }
                    char letter = line.text[shown - 1];
                    // An ellipsis holds once, at its last dot.
                    float hold = letter == '.' && line.text[shown] == '.' ? LetterSeconds : Hold(letter);
                    nextLetter += LetterSeconds + hold;
                    // The mouth closes for a pause, as a speaker's does.
                    if (hold > 0) { Show("idle"); flapUntil = nextLetter; }
                }
                line.maxVisibleCharacters = shown;
                if (Typing && now >= flapUntil) { flap = (flap + 1) % Flaps.Length; Show(Flaps[flap]); flapUntil = now + FlapSeconds; }
                return;
            }
            if (AppPreferences.ReducedMotion || pages[page].Mood != "idle") return;
            if (blinkUntil > 0 && now >= blinkUntil) { blinkUntil = 0; Show("idle"); nextBlink = now + 3.2f + 1.9f * Mathf.Repeat(now * .618f, 1); }
            else if (blinkUntil == 0 && now >= nextBlink) { Show("blink"); blinkUntil = now + BlinkSeconds; }
        }
        public static float Hold(char letter) => letter switch
        {
            ',' or ';' or ':' or '—' or '–' => CommaHold,
            '.' or '!' or '?' or '…' => StopHold,
            _ => 0,
        };
    }
}

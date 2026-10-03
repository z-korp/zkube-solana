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

    // One page of dialogue: the line, the face the guardian rests on after it
    // and a lesson's card shown over the scene (a skin slot, or none); or the
    // rule page, which shows the guardian's Earn panel at size (the trigger's
    // pictogram, an arrow and the bonus), the rule and its effect.
    public sealed class TalkPage
    {
        public string Line, Mood, Picture;
        public PageCatalog.GuardianRule Rule;
        public TalkPage(string line, string mood, string picture = null)
        {
            if (string.IsNullOrWhiteSpace(line)) throw new ArgumentException("A guardian page needs a line", nameof(line));
            Line = line; Mood = mood ?? "idle"; Picture = picture;
        }
        private TalkPage(PageCatalog.GuardianRule rule) { Rule = rule ?? throw new ArgumentNullException(nameof(rule)); Mood = "idle"; }
        public static TalkPage RulePage(PageCatalog.GuardianRule rule) => new TalkPage(rule);
        public string RuleHeading => Rule == null ? null : "Earn a " + HudLayout.BonusName(Rule.bonus);
        public string RuleSentence => Rule == null ? null : Rule.description.TrimEnd('.') + ".";

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
        // previous guardian, then the greeting, then the guardian's rule page.
        public static TalkPage[] MapGreeting(PageCatalog.RealmPage realm, PageCatalog.GuardianRule rule, bool passage)
        {
            var pages = new List<TalkPage>();
            if (passage) pages.Add(For(realm.guardianLines, TalkMoment.Passage));
            pages.Add(For(realm.guardianLines, TalkMoment.Greeting));
            if (rule != null) pages.Add(RulePage(rule));
            return pages.ToArray();
        }
    }

    // The guardian's dialogue box: the realm's ledge rail as its top, the
    // guardian leaning on it right of centre (body, rail, paws), the name tag
    // with its title, and each line typed letter by letter with holds on
    // punctuation while the mouth flaps between idle, talk-open and talk-mid.
    // Then the guardian rests on the page's mood; idle blinks. A rule page shows
    // its Earn panel at once, the tag naming the bonus. A tap completes the
    // line, the next tap turns the page, and the last one finishes. Reduced
    // motion shows each line at once on its mood.
    public sealed class GuardianTalk : MonoBehaviour, IPointerClickHandler
    {
        public const float LetterSeconds = .028f, CommaHold = .12f, StopHold = .28f, FlapSeconds = .09f, BlinkSeconds = .12f;
        private static readonly string[] Flaps = { "talk-open", "talk-mid", "idle", "talk-mid" };
        private BoardArt art;
        private Image guardian;
        private TMP_Text line, tagName, tagTitle, cue;
        private GameObject rulePanel;
        private TalkPage[] pages;
        private Action finished;
        private int page, shown;
        private float nextLetter, flapUntil, nextBlink, blinkUntil;
        private int flap;
        public int Page => page;
        public TalkPage Current => pages[page];
        // Each page as it opens, the first one included.
        public event Action<TalkPage> Opened;
        public bool Typing { get; private set; }
        public string Face { get; private set; }
        public string Shown => line.text.Substring(0, Mathf.Min(shown, line.text.Length));
        public bool Done { get; private set; }

        private string guardianName;
        private RectTransform box;
        private RectTransform[] tops = Array.Empty<RectTransform>();
        private float[] heights;
        private float shownHeight;
        internal void Bind(BoardArt source, Image frame, TMP_Text text, TMP_Text nameText, TMP_Text titleText, GameObject rules, TMP_Text continueCue,
            TalkPage[] talk, Action onFinished, RectTransform panel = null, RectTransform[] onTop = null, float[] pageHeights = null)
        {
            box = panel; tops = onTop ?? Array.Empty<RectTransform>(); heights = pageHeights; shownHeight = pageHeights?[0] ?? 0;
            if (talk == null || talk.Length == 0) throw new ArgumentException("A guardian needs something to say", nameof(talk));
            art = source; guardian = frame; line = text; tagName = nameText; tagTitle = titleText; rulePanel = rules; cue = continueCue;
            guardianName = tagName.text;
            pages = talk; finished = onFinished;
            Open(0);
        }

        private void Open(int index)
        {
            page = index; var current = pages[index];
            bool ruled = current.Rule != null;
            // Each page sizes the box, which keeps its bottom and grows or shrinks at its top.
            if (box != null && heights != null && heights[index] != shownHeight)
            {
                float delta = heights[index] - shownHeight; shownHeight = heights[index];
                box.offsetMax += new Vector2(0, delta);
                foreach (var rect in tops) rect.anchoredPosition += new Vector2(0, delta);
            }
            line.text = current.Line ?? ""; shown = 0;
            tagName.text = ruled ? current.RuleHeading : guardianName;
            line.gameObject.SetActive(!ruled); tagTitle.gameObject.SetActive(!ruled);
            if (rulePanel != null) rulePanel.SetActive(ruled);
            cue.gameObject.SetActive(false);
            Typing = true; nextLetter = Time.unscaledTime; flapUntil = 0; flap = 0;
            if (AppPreferences.ReducedMotion || ruled) Complete();
            else Show(Flaps[0]);
            line.maxVisibleCharacters = shown;
            Opened?.Invoke(current);
        }

        // Shows the whole line and rests on the page's mood.
        public void Complete()
        {
            shown = line.text.Length; line.maxVisibleCharacters = shown; Typing = false;
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
            Face = frame; SkinUi.GuardianFrame(art, guardian, frame);
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

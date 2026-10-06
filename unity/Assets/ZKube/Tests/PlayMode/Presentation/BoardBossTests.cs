using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    // DECISIONS 2026-10-02: the guardian level is a boss level and feels like
    // one in play: an intro moment with the guardian, a distinct HUD accent and
    // the guardian's presence during the run.
    public sealed class BoardBossTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        private readonly List<string> played = new List<string>();

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Board boss tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            yield return null;
            board.SetMuted(true); board.SetReducedMotion(false); board.SoundPlayed += played.Add;
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Ready()
        {
            float deadline = Time.realtimeSinceStartup + 30;
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) || board.Busy)
            { if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board is still busy or loading"); yield return null; }
        }
        private SpriteRenderer Sprite(string name) => board.View.GetComponentsInChildren<SpriteRenderer>(true).SingleOrDefault(sprite => sprite.name == name);
        private TMP_Text Label(string name) => board.View.GetComponentsInChildren<TMP_Text>(true).SingleOrDefault(text => text.name == name);
        private AudioSource Music => root.GetComponents<AudioSource>().Single(value => value.loop);
        private static AudioClip Track(PageCatalog.RealmPage theme, string track) => Resources.Load<AudioClip>("ZKube/Audio/" + theme.id + "/sounds__musics__" + track);

        // In every realm, level 10 opens with the guardian (its name and title over
        // the board, its greeting face, the intro sound once), plays the guardian's
        // own track, and keeps a gold frame, the guardian medal and a breathing
        // aura behind the guardian. Level 9 has none of it, and going back and
        // forth swaps the music with the level.
        [UnityTest] public IEnumerator TheGuardianLevelOpensWithTheGuardianAndKeepsItsAccentAndMusic()
        {
            var catalog = PageCatalog.Load();
            foreach (var theme in catalog.themes)
            {
                var art = (Func<BoardArt>)(() => ZKube.Tests.Presentation.BoardTestState.Art(board));
                string at = theme.id;
                played.Clear();
                evidence.LoadCampaign(theme.realmId, 9); yield return Ready();
                Assert.IsFalse(board.View.Boss, at + ": level 9 is an ordinary level");
                Assert.IsNull(Sprite("Guardian aura")); Assert.IsNull(Label("Guardian name"));
                Assert.AreSame(Track(theme, "level"), Music.clip, at + ": level 9 plays the level track");
                Assert.AreEqual(art().Token(SkinTokens.LightKey), Sprite("Board frame").color, at + ": the frame in the realm's key light");
                CollectionAssert.DoesNotContain(played, SoundCues.BossIntro);

                evidence.LoadCampaign(theme.realmId, 10);
                float deadline = Time.realtimeSinceStartup + 30;
                while (!board.PresentationInitialized || board.View == null || !board.View.Boss)
                { if (Time.realtimeSinceStartup > deadline) Assert.Fail(at + ": the guardian level did not load"); yield return null; }
                Assert.AreEqual(theme.guardianName, Label("Guardian name").text, at);
                Assert.AreEqual(theme.guardianTitle, Label("Guardian title").text, at);
                StringAssert.Contains("LilitaOne", Label("Guardian name").font.name);
                Assert.AreEqual("greeting", board.View.GuardianFace, at + ": the guardian greets the player");
                Assert.AreEqual(1, played.Count(cue => cue == SoundCues.BossIntro), at + ": the intro sound, once");
                Assert.AreSame(Track(theme, "boss"), Music.clip, at + ": the guardian's own track");
                Assert.IsNotNull(Music.clip);
                var accent = art().Token(SkinTokens.Accent);
                Assert.AreEqual(accent, Sprite("Board frame").color, at + ": a gold frame");
                var aura = Sprite("Guardian aura");
                Assert.IsNotNull(aura, at + ": the guardian's aura"); Assert.Greater(aura.color.a, .1f);
                Assert.Less(aura.sortingOrder, Sprite("Calm realm guardian").sortingOrder, at + ": behind the guardian");
                Assert.IsTrue(aura.bounds.Contains(Sprite("Calm realm guardian").bounds.center), at);
                var medal = board.View.GetComponentsInChildren<Image>().SingleOrDefault(image => image.name == "Level medal");
                if (medal != null) StringAssert.StartsWith(SkinSlots.MapNodeGuardian, medal.sprite.name, at + ": the guardian's medal");
                yield return Ready();
                // A redraw keeps the accent and does not repeat the intro.
                board.RefreshLayout(); yield return null;
                Assert.IsTrue(board.View.Boss); Assert.IsNotNull(Sprite("Guardian aura"));
                Assert.AreEqual(1, played.Count(cue => cue == SoundCues.BossIntro), at + ": a redraw does not repeat the intro");
                Assert.IsNull(Label("Guardian name"), at + ": the redrawn board has no second intro");
                if (theme.realmId != 1) continue;
                // The intro leaves and the guardian calms; the aura breathes on.
                float low = 1, high = 0;
                for (float end = Time.realtimeSinceStartup + 3.2f; Time.realtimeSinceStartup < end;)
                { float a = Sprite("Guardian aura").color.a; low = Mathf.Min(low, a); high = Mathf.Max(high, a); yield return null; }
                Assert.Greater(high - low, .05f, "The aura breathes");
                StringAssert.IsMatch("^(idle|blink)$", board.View.GuardianFace);
                evidence.LoadCampaign(theme.realmId, 9); yield return Ready();
                Assert.AreSame(Track(theme, "level"), Music.clip, "Back on level 9 the level track returns");
                Assert.IsFalse(board.View.Boss);
            }
        }

        // The intro on the compact phone, the emulator's default and the Seeker,
        // at both text sizes: the name and title fit the board, the name above the
        // title. Reduced motion fades them in place.
        [UnityTest] public IEnumerator TheGuardianIntroFitsEveryPhone()
        {
            evidence.LoadCampaign(4, 10); yield return Ready();
            var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
            board.View.gameObject.SetActive(false);
            var phones = new[] { ("compact", ZKube.Tests.Presentation.Phones.CompactScreen, ZKube.Tests.Presentation.Phones.CompactTopInsetDp, 0f),
                ("emulator", ZKube.Tests.Presentation.Phones.EmulatorScreen, ZKube.Tests.Presentation.Phones.EmulatorTopInsetDp, ZKube.Tests.Presentation.Phones.EmulatorBottomInsetDp),
                ("seeker", ZKube.Tests.Presentation.Phones.SeekerScreen, ZKube.Tests.Presentation.Phones.SeekerTopInsetDp, 0f) };
            foreach (var (phone, screen, top, bottom) in phones)
                foreach (float text in new[] { 1f, 1.3f })
                    foreach (bool reduced in new[] { false, true })
                    {
                        string at = phone + " at " + text + (reduced ? " (reduced motion)" : "");
                        var ui = new SkinUi(art, 1, text);
                        var child = new GameObject("Boss view"); child.transform.SetParent(root.transform);
                        var view = child.AddComponent<BoardView>();
                        view.Create(board, art, HudLayout.Build(ui, board.State, board.Session, new Rect(0, bottom, screen.width, screen.height - top - bottom), 1, screen), ui);
                        view.SetBoard(board.State.Grid); view.SetPreview(board.State.HasNextRow, board.State.NextRow); view.Summary(board.State, board.Session, true);
                        view.IntroduceGuardian(reduced);
                        var name = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Guardian name");
                        var title = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Guardian title");
                        var area = view.Layout.Board;
                        foreach (var cue in new[] { name, title })
                        {
                            cue.ForceMeshUpdate();
                            Assert.LessOrEqual(cue.GetPreferredValues(cue.text, float.PositiveInfinity, float.PositiveInfinity).x * 1.4f, area.width + .5f, at + ": '" + cue.text + "' fits the board at its largest");
                            Assert.AreEqual(area.center.x, cue.rectTransform.position.x, 1, at);
                            if (reduced) Assert.AreEqual(Vector3.one, cue.rectTransform.localScale, at + ": no scale");
                        }
                        Assert.Greater(name.rectTransform.position.y, title.rectTransform.position.y, at + ": the name stands over the title");
                        Assert.Greater(name.fontSize, title.fontSize, at);
                        if (text == 1 && !reduced)
                        {
                            float began = Time.realtimeSinceStartup; while (Time.realtimeSinceStartup - began < .8f) yield return null;
                            yield return ZKube.Tests.Presentation.Captures.Snap(screen, "boss-intro-" + phone);
                        }
                        UnityEngine.Object.Destroy(child); yield return null;
                    }
            board.View.gameObject.SetActive(true);
        }
    }
}

using System;
using System.Collections;
using System.Reflection;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardRealmTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Explicit realm tests"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            yield return null; board.SetMuted(true); board.SetReducedMotion(true);
        }
        [UnityTearDown] public IEnumerator TearDown() { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Ready()
        {
            float deadline = Time.realtimeSinceStartup + 30;
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) || board.Busy)
            { if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board is still busy or loading"); yield return null; }
        }
        private static int AtlasOwners(string path)
        {
            var loads = (IDictionary)typeof(BoardArt).GetField("atlasLoads", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null);
            var lease = loads[path];
            return lease == null ? 0 : (int)lease.GetType().GetField("Owners").GetValue(lease);
        }
        [Test] public void EveryGuardianSpeaksEveryLine()
        {
            var catalog = JsonUtility.FromJson<PageCatalog>(Resources.Load<TextAsset>("ZKube/Catalog").text);
            catalog.Validate();
            foreach (var realm in catalog.themes)
            {
                Assert.That(realm.guardianTitle, Is.Not.Empty, realm.guardianName);
                Assert.AreEqual(10, realm.guardianLines.All.Length);
                foreach (var line in realm.guardianLines.All) Assert.That(line, Is.Not.Null.And.Not.Empty, realm.guardianName);
                Assert.AreEqual(realm.guardianLines.oneStar, realm.guardianLines.Stars(1));
                Assert.AreEqual(realm.guardianLines.threeStar, realm.guardianLines.Stars(3));
            }
            catalog.themes[0].guardianLines.incomplete = " ";
            Assert.Throws<FormatException>(() => catalog.Validate(), "A guardian with a silent line is rejected");
        }
        // Every Campaign goal in its realm, and every Daily objective with any
        // guardian, finds its caption, counter and imported pictogram.
        [UnityTest] public IEnumerator EveryCatalogGoalDrawsItsPictogramCounterAndCaption()
        {
            evidence.Load("realm-8-campaign"); yield return Ready();
            var art = (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
            var catalog = PageCatalog.Load();
            void Check(byte[] goal, byte bonus)
            {
                var face = catalog.Goal(goal[0], goal[1], goal.Length > 2 ? goal[2] : (byte)0);
                string at = "kind " + goal[0] + " value " + goal[1] + " bonus " + bonus;
                Assert.That(face.text, Is.Not.Empty, at);
                if (goal[0] == 0) { Assert.AreEqual("none", face.counter, at); return; }
                Assert.That(new[] { "fill", "ring", "bar" }, Does.Contain(face.counter), at);
                Assert.NotNull(art.SkinUi(face.Pictogram(bonus)), at);
            }
            foreach (var realm in ZKube.Core.Generated.Protocol.Realms)
                foreach (var level in realm.Levels) { Check(level.Primary, (byte)realm.GuardianAndHeight[0]); Check(level.Secondary, (byte)realm.GuardianAndHeight[0]); }
            foreach (var objective in ZKube.Core.Generated.Protocol.DailyThemes)
                for (byte bonus = 1; bonus <= 3; bonus++) Check(objective, bonus);
        }
        [Test] public void EverySkinMustCoverEveryRealm()
        {
            var text = Resources.Load<TextAsset>("ZKube/Catalog").text;
            var catalog = JsonUtility.FromJson<PageCatalog>(text);
            catalog.Validate();
            catalog.skins = new[] { new PageCatalog.SkinEntry { id = "test", tokens = new PageCatalog.Swatch[0], ui = new PageCatalog.UiSlot[0],
                realms = catalog.themes.Select(realm => new PageCatalog.SkinRealm { realmId = realm.realmId, tokens = new PageCatalog.Swatch[0],
                    light = new PageCatalog.RealmLight { source = new float[2] } }).ToArray() } };
            catalog.Validate();
            Assert.AreEqual("test", catalog.DefaultSkin.id);
            catalog.skins[0].realms[0].light = null;
            Assert.Throws<FormatException>(() => catalog.Validate(), "Every skin realm places its light");
            catalog.skins[0].realms[0].light = new PageCatalog.RealmLight { source = new float[2] };
            catalog.skins[0].realms[0].tokens = null;
            Assert.Throws<FormatException>(() => catalog.Validate(), "Every skin realm carries its own tokens");
            catalog.skins[0].realms = catalog.skins[0].realms.Skip(1).ToArray();
            Assert.Throws<FormatException>(() => catalog.Validate());
            catalog.skins = new PageCatalog.SkinEntry[0];
            Assert.Throws<FormatException>(() => catalog.Validate(), "The catalog lists at least one skin");
            catalog.skins = null;
            Assert.Throws<FormatException>(() => catalog.Validate());
        }
        private static IntPtr NativeAtlasPointer(UnityEngine.Object asset)
        {
            // Unity 6000.3 Object.IsNativeObjectAlive also checks persistent IDs
            // in the Editor, so an unloaded SpriteAtlas may still compare != null.
            // Read its native pointer without resolving/reloading that asset.
            // UnityCsReference/6000.3/Runtime/Export/Scripting/UnityEngineObject.bindings.cs
            return (IntPtr)typeof(UnityEngine.Object).GetField("m_CachedPtr", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(asset);
        }

        [UnityTest] public IEnumerator EveryRealmUsesItsImportedArtMusicAndNativeInventory()
        {
            var catalog = PageCatalog.Load();
            Assert.AreSame(catalog, PageCatalog.Load(), "Pages and board share the parsed catalog");
            foreach (var caption in catalog.constraintCaptions)
            {
                StringAssert.DoesNotContain("{", catalog.ObjectiveName(caption.kind, caption.value, caption.count));
                Assert.That(catalog.ObjectiveName(caption.kind, caption.value, caption.count), Is.Not.Empty);
            }
            var themes = catalog.themes;
            TMP_FontAsset font = null;
            foreach (var theme in themes)
            {
                evidence.Load("realm-" + theme.realmId + "-daily"); yield return Ready();
                Assert.AreEqual(theme.realmId, board.Session.RealmId); Assert.AreEqual(theme.realmId, ZKube.Tests.Presentation.BoardTestState.Art(board).RealmId);
                Assert.AreEqual(theme.id, ZKube.Tests.Presentation.BoardTestState.Art(board).ThemeId);
                var guardian = board.View.GetComponentsInChildren<SpriteRenderer>().Single(value => value.name == "Calm realm guardian");
                Assert.IsNotNull(guardian.sprite); StringAssert.IsMatch("^boss__(idle|blink)$", guardian.sprite.name.Replace("(Clone)", ""));
                var paws = board.View.GetComponentsInChildren<SpriteRenderer>().Single(value => value.name == "Guardian paws");
                Assert.AreEqual("boss__paws", paws.sprite.name.Replace("(Clone)", ""));
                Assert.AreEqual(guardian.bounds, paws.bounds, "The paws layer shares the guardian's canvas");
                var label = board.View.GetComponentsInChildren<TMP_Text>().Single(value => value.name == "Moves remaining");
                if (font == null) font = label.font; else Assert.AreSame(font, label.font, "Shared font survives realm switches");
                var music = root.GetComponents<AudioSource>().Single(value => value.loop);
                var expected = Resources.Load<AudioClip>("ZKube/Audio/" + theme.id + "/sounds__musics__level");
                Assert.AreSame(expected, music.clip); Assert.IsTrue(music.mute); Assert.IsFalse(music.isPlaying);
                Assert.AreEqual(board.State.BonusCharges.ToString(), board.View.GetComponentsInChildren<TMP_Text>().Single(value => value.name == "Guardian action label").text);
                Assert.AreEqual(0, board.State.BonusCharges, "Realm art does not grant charges");
            }
        }
        // Guardian continuity: every frame of every guardian renders in the same
        // box as idle, because it is idle. The body is always the idle frame; a
        // mood, blink or talk frame only lays its face (the rectangle the art
        // records, cut from that frame) over it, on the HUD's sprite and on the
        // talk scene's and the pages' images alike. So no frame can move, scale
        // or re-texture the body, whatever the codec does to each packed frame.
        private static readonly string[] GuardianFrames = { "blink", "talk-mid", "talk-open", "greeting", "satisfied", "surprised", "celebrate", "defeated" };
        [UnityTest] public IEnumerator EveryFrameOfEveryGuardianRendersInTheSameBoxAsIdle()
        {
            foreach (var theme in PageCatalog.Load().themes)
            {
                evidence.Load("realm-" + theme.realmId + "-daily"); yield return Ready();
                var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
                var idle = art.Sprite(BoardArt.GuardianIdle);
                Assert.IsNull(art.Face("idle"), theme.id + ": idle has no face laid over it");
                var cut = art.GuardianFace;
                // On the HUD: the body's sprite and box never change; the face covers its rectangle of that box.
                var guardian = board.View.GetComponentsInChildren<SpriteRenderer>().Single(value => value.name == "Calm realm guardian");
                var patch = board.View.GetComponentsInChildren<SpriteRenderer>(true).Single(value => value.name == SkinUi.GuardianFaceName);
                var box = guardian.bounds; var show = typeof(BoardView).GetMethod("Face", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                // On an image (the talk scene, the pages' guardian cards).
                var host = new GameObject("Guardian image test", typeof(RectTransform), typeof(Canvas)); host.transform.SetParent(root.transform, false);
                var image = new GameObject("Frame", typeof(RectTransform), typeof(Image)).GetComponent<Image>();
                image.transform.SetParent(host.transform, false); image.rectTransform.sizeDelta = new Vector2(180, 180); image.preserveAspect = true;
                SkinUi.GuardianFrame(art, image, "idle"); Canvas.ForceUpdateCanvases();
                Assert.IsNull(image.transform.Find(SkinUi.GuardianFaceName), theme.id + ": idle draws the idle frame alone");
                var corners = new Vector3[4]; image.rectTransform.GetWorldCorners(corners);
                var canvas = Rect.MinMaxRect(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
                foreach (string frame in GuardianFrames)
                {
                    string at = theme.id + " " + frame;
                    var whole = art.Sprite("boss__" + frame); var face = art.Face(frame);
                    Assert.AreEqual(idle.rect.size, whole.rect.size, at + ": one canvas");
                    Assert.AreSame(whole.texture, face.texture, at + ": the face is cut from its frame");
                    Assert.AreEqual(Mathf.Round(cut.width * idle.rect.width), face.rect.width, at); Assert.AreEqual(Mathf.Round(cut.height * idle.rect.height), face.rect.height, at);
                    Assert.AreEqual(whole.textureRect.x + Mathf.Round(cut.x * idle.rect.width), face.textureRect.x, at + ": cut where the art records it");
                    Assert.AreEqual(whole.textureRect.y + Mathf.Round((1 - cut.yMax) * idle.rect.height), face.textureRect.y, at);
                    Assert.AreEqual(idle.pixelsPerUnit, face.pixelsPerUnit, at);

                    show.Invoke(board.View, new object[] { frame });
                    Assert.AreSame(idle, guardian.sprite, at + ": the HUD's body stays the idle frame"); Assert.AreEqual(box, guardian.bounds, at + ": the HUD box");
                    Assert.IsTrue(patch.enabled, at); Assert.AreSame(face, patch.sprite, at);
                    var expected = art.FaceIn(new Rect(box.min.x, box.min.y, box.size.x, box.size.y));
                    Assert.AreEqual(expected.center.x, patch.bounds.center.x, .01f, at + ": the face sits in its rectangle"); Assert.AreEqual(expected.center.y, patch.bounds.center.y, .01f, at);
                    Assert.AreEqual(expected.width, patch.bounds.size.x, .01f, at); Assert.AreEqual(expected.height, patch.bounds.size.y, .01f, at);
                    Assert.AreEqual(guardian.sortingOrder + 1, patch.sortingOrder, at + ": just over the body");
                    Assert.AreSame(guardian.sharedMaterial, patch.sharedMaterial, at + ": lit as the body is");

                    SkinUi.GuardianFrame(art, image, frame); Canvas.ForceUpdateCanvases();
                    Assert.AreSame(idle, image.sprite, at + ": the image's body stays the idle frame");
                    var over = image.transform.Find(SkinUi.GuardianFaceName).GetComponent<Image>();
                    Assert.IsTrue(over.enabled, at); Assert.AreSame(face, over.sprite, at);
                    over.rectTransform.GetWorldCorners(corners);
                    var drawn = Rect.MinMaxRect(corners[0].x, corners[0].y, corners[2].x, corners[2].y); var want = art.FaceIn(canvas);
                    Assert.AreEqual(want.x, drawn.x, .05f, at + ": the image's face sits in its rectangle"); Assert.AreEqual(want.y, drawn.y, .05f, at);
                    Assert.AreEqual(want.width, drawn.width, .05f, at); Assert.AreEqual(want.height, drawn.height, .05f, at);
                }
                show.Invoke(board.View, new object[] { "idle" });
                Assert.IsFalse(patch.enabled, theme.id + ": back to idle alone");
                SkinUi.GuardianFrame(art, image, "idle");
                Assert.IsFalse(image.transform.Find(SkinUi.GuardianFaceName).GetComponent<Image>().enabled);
                UnityEngine.Object.Destroy(host);
            }
        }
        // The art's side of that contract: outside the recorded face rectangle,
        // every imported frame of every guardian is the idle frame (within 8
        // levels), so laying only the face over idle loses nothing a frame drew.
        // New frames that move the body fail here until their rectangle covers it.
        [UnityTest] public IEnumerator EveryGuardianFrameMatchesIdleOutsideItsRecordedFace()
        {
            foreach (var theme in PageCatalog.Load().themes)
            {
                evidence.Load("realm-" + theme.realmId + "-daily"); yield return Ready();
                var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
                var idleSprite = art.Sprite(BoardArt.GuardianIdle); var atlas = idleSprite.texture;
                // The packed atlas is not readable; draw it once and read the frames back.
                var target = RenderTexture.GetTemporary(atlas.width, atlas.height, 0, RenderTextureFormat.ARGB32);
                var copy = new Texture2D(atlas.width, atlas.height, TextureFormat.RGBA32, false);
                var active = RenderTexture.active;
                try
                {
                    Graphics.Blit(atlas, target); RenderTexture.active = target;
                    copy.ReadPixels(new Rect(0, 0, atlas.width, atlas.height), 0, 0); copy.Apply();
                }
                finally { RenderTexture.active = active; RenderTexture.ReleaseTemporary(target); }
                Color32[] Pixels(Sprite sprite)
                {
                    Assert.AreSame(atlas, sprite.texture); var r = sprite.textureRect;
                    return copy.GetPixels32().Length == 0 ? null : System.Array.ConvertAll(copy.GetPixels((int)r.x, (int)r.y, (int)r.width, (int)r.height), c => (Color32)c);
                }
                var idle = Pixels(idleSprite); int width = (int)idleSprite.textureRect.width, height = (int)idleSprite.textureRect.height;
                var cut = art.GuardianFace;
                int left = Mathf.RoundToInt(cut.x * width), right = Mathf.RoundToInt(cut.xMax * width), top = Mathf.RoundToInt(cut.y * height), bottom = Mathf.RoundToInt(cut.yMax * height);
                foreach (string frame in GuardianFrames)
                {
                    var pixels = Pixels(art.Sprite("boss__" + frame));
                    Assert.AreEqual(idle.Length, pixels.Length, theme.id + " " + frame + ": one canvas");
                    int worst = 0, where = 0;
                    for (int i = 0; i < pixels.Length; i++)
                    {
                        int x = i % width, fromTop = height - 1 - i / width;
                        if (x >= left && x < right && fromTop >= top && fromTop < bottom) continue;
                        // As drawn: colour weighted by alpha (the importer fills clear pixels with nearby colour).
                        var p = pixels[i]; var q = idle[i];
                        int d = Mathf.Max(Mathf.Max(Mathf.Abs(p.r * p.a - q.r * q.a), Mathf.Abs(p.g * p.a - q.g * q.a)), Mathf.Max(Mathf.Abs(p.b * p.a - q.b * q.a), 255 * Mathf.Abs(p.a - q.a))) / 255;
                        if (d > worst) { worst = d; where = i; }
                    }
                    Assert.LessOrEqual(worst, 8, $"{theme.id} {frame} differs from idle outside its face rectangle at {where % width}, {height - 1 - where / width}");
                }
                UnityEngine.Object.Destroy(copy);
            }
        }
        [UnityTest] public IEnumerator SelectionDuringAnAsyncLoadNeverPresentsTheSupersededRealm()
        {
            evidence.Load("realm-8-daily"); yield return Ready(); var retired = board.View;
            evidence.Load("realm-1-daily");
            Assert.IsTrue(!board.PresentationInitialized); Assert.IsFalse(ZKube.Tests.Presentation.BoardTestState.Idle(board)); Assert.IsFalse(retired.gameObject.activeSelf);
            evidence.Load("realm-10-daily");
            uint actions = board.State.ActionCounter;
            board.Reroll(); board.SelectGuardian();
            Assert.AreEqual(actions, board.State.ActionCounter, "No input mutates a run during its asset load");
            yield return Ready(); Assert.AreEqual(10, ZKube.Tests.Presentation.BoardTestState.Art(board).RealmId); Assert.IsTrue(retired == null);
            Assert.AreEqual(1, root.GetComponentsInChildren<BoardView>(true).Length);
        }
        [UnityTest] public IEnumerator DestroyDuringLoadDoesNotLeaveAPlayableViewOrLateOwnerWork()
        {
            evidence.Load("realm-8-daily"); yield return Ready();
            evidence.Load("realm-2-daily"); Assert.IsTrue(!board.PresentationInitialized);
            UnityEngine.Object.Destroy(root); yield return null; yield return null;
            Assert.IsTrue(board == null); LogAssert.NoUnexpectedReceived();
        }
        [UnityTest] public IEnumerator DisposingArtWithAnOutstandingResourceRequestStopsItsPublication()
        {
            var art = new BoardArt(); var loading = art.Load(2);
            Assert.IsTrue(loading.MoveNext()); var request = loading.Current as ResourceRequest;
            Assert.IsNotNull(request); art.Dispose();
            yield return request;
            Assert.IsFalse(loading.MoveNext()); Assert.AreEqual(0, art.RealmId); Assert.That(art.ThemeId, Is.Null);
            art.Dispose(); LogAssert.NoUnexpectedReceived();
        }
        [UnityTest] public IEnumerator PageRealmSwitchAndDisposalDoNotUnloadTheBoardsSharedAtlases()
        {
            using var pageArt = new BoardArt(); using var boardArt = new BoardArt();
            var loading = pageArt.Load(8); Assert.IsTrue(loading.MoveNext());
            var request = (ResourceRequest)loading.Current; yield return request;
            while (loading.MoveNext()) yield return loading.Current;
            yield return boardArt.Load(8); var sharedAtlas = request.asset;
            string realmPath = "ZKube/Atlases/" + boardArt.ThemeId;
            Assert.AreEqual(2, AtlasOwners(realmPath), "Only page + board own the test atlas");
            var font = boardArt.Font(SkinUi.Type.Body);
            yield return pageArt.Load(2); yield return null;
            Assert.AreEqual(1, AtlasOwners(realmPath), "The board retains the sole old-realm lease after page navigation");
            Assert.IsTrue(sharedAtlas != null, "The board still owns Balam's atlas");
            Assert.IsNotNull(boardArt.Sprite("boss__celebrate"), "An uncached sprite proves the atlas itself survived");
            pageArt.Dispose(); yield return null;
            Assert.IsNotNull(boardArt.Sprite("boss__defeated"));
            var common = (UnityEngine.U2D.SpriteAtlas)typeof(BoardArt).GetField("common", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(boardArt);
            var uncached = common.GetSprite("mark");
            Assert.IsNotNull(uncached, "Common atlas ownership survives a fresh sprite lookup too");
            UnityEngine.Object.Destroy(uncached);
            Assert.AreSame(font, boardArt.Font(SkinUi.Type.Body));
            Assert.AreNotEqual(IntPtr.Zero, NativeAtlasPointer(sharedAtlas), "The final owner still holds a loaded native atlas");
            boardArt.Dispose();
            Assert.AreEqual(0, AtlasOwners(realmPath), "Last release removes the shared lease");
            Assert.AreEqual(IntPtr.Zero, NativeAtlasPointer(sharedAtlas), "Last release unloads the native atlas immediately");
            yield return null;
            Assert.AreEqual(IntPtr.Zero, NativeAtlasPointer(sharedAtlas), "The released atlas stays unloaded on the next frame");
            LogAssert.NoUnexpectedReceived();
        }
        [UnityTest] public IEnumerator DisposedPendingOwnerCannotUnloadTheOtherOwnersCompletedRequest()
        {
            using var pageArt = new BoardArt(); using var boardArt = new BoardArt();
            var pageLoad = pageArt.Load(3); var boardLoad = boardArt.Load(3);
            Assert.IsTrue(pageLoad.MoveNext()); Assert.IsTrue(boardLoad.MoveNext());
            Assert.AreSame(pageLoad.Current, boardLoad.Current, "Concurrent owners share one in-flight request");
            var request = (ResourceRequest)boardLoad.Current;
            pageArt.Dispose(); yield return request;
            Assert.IsFalse(pageLoad.MoveNext(), "Disposed owner never publishes the shared result");
            while (boardLoad.MoveNext()) yield return boardLoad.Current;
            var sharedAtlas = request.asset;
            Assert.AreEqual(1, AtlasOwners("ZKube/Atlases/" + boardArt.ThemeId), "Disposed requester owns no residual lease");
            string realmPath = "ZKube/Atlases/" + boardArt.ThemeId;
            Assert.AreEqual(3, boardArt.RealmId); Assert.IsTrue(sharedAtlas != null);
            Assert.IsNotNull(boardArt.Sprite("boss__celebrate"));
            var common = (UnityEngine.U2D.SpriteAtlas)typeof(BoardArt).GetField("common", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(boardArt);
            var uncached = common.GetSprite("mark");
            Assert.IsNotNull(uncached);
            UnityEngine.Object.Destroy(uncached);
            Assert.AreNotEqual(IntPtr.Zero, NativeAtlasPointer(sharedAtlas), "The surviving requester owns the loaded native atlas");
            boardArt.Dispose();
            Assert.AreEqual(0, AtlasOwners(realmPath), "Last release removes the shared lease");
            Assert.AreEqual(IntPtr.Zero, NativeAtlasPointer(sharedAtlas), "Last release unloads the native atlas immediately");
            yield return null;
            Assert.AreEqual(IntPtr.Zero, NativeAtlasPointer(sharedAtlas), "The released atlas stays unloaded on the next frame");
            LogAssert.NoUnexpectedReceived();
        }
    }
}

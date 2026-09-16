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
        private static IntPtr NativeAtlasPointer(UnityEngine.Object asset)
        {
            // Unity 6000.3 Object.IsNativeObjectAlive also checks persistent IDs
            // in the Editor, so an unloaded SpriteAtlas may still compare != null.
            // Read its native pointer without resolving/reloading that asset.
            // UnityCsReference/6000.3/Runtime/Export/Scripting/UnityEngineObject.bindings.cs
            return (IntPtr)typeof(UnityEngine.Object).GetField("m_CachedPtr", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(asset);
        }
        [Serializable] private sealed class Catalog { public Theme[] themes; }
        [Serializable] private sealed class Theme { public byte realmId; public string id, guardianName; }

        [UnityTest] public IEnumerator EveryRealmUsesItsImportedArtMusicAndNativeInventory()
        {
            var resource = Resources.Load<TextAsset>("ZKube/Catalog");
            var themes = JsonUtility.FromJson<Catalog>(resource.text).themes; Resources.UnloadAsset(resource);
            TMP_FontAsset font = null;
            foreach (var theme in themes)
            {
                evidence.Load("realm-" + theme.realmId + "-daily"); yield return Ready();
                Assert.AreEqual(theme.realmId, board.Session.RealmId); Assert.AreEqual(theme.realmId, ZKube.Tests.Presentation.BoardTestState.Art(board).RealmId);
                Assert.AreEqual(theme.id, ZKube.Tests.Presentation.BoardTestState.Art(board).ThemeId);
                var guardian = board.View.GetComponentsInChildren<Image>().Single(value => value.name == "Calm realm guardian");
                Assert.IsNotNull(guardian.sprite); Assert.AreEqual("boss__idle", guardian.sprite.name.Replace("(Clone)", ""));
                var label = board.View.GetComponentsInChildren<TMP_Text>().Single(value => value.name == "Run title");
                Assert.AreEqual((theme.guardianName + " · DAILY").ToUpperInvariant(), label.text);
                if (font == null) font = label.font; else Assert.AreSame(font, label.font, "Shared font survives realm switches");
                var music = root.GetComponents<AudioSource>().Single(value => value.loop);
                var expected = Resources.Load<AudioClip>("ZKube/Audio/" + theme.id + "/sounds__musics__level");
                Assert.AreSame(expected, music.clip); Assert.IsTrue(music.mute); Assert.IsFalse(music.isPlaying);
                Assert.AreEqual(board.State.BonusCharges.ToString(), board.View.GetComponentsInChildren<TMP_Text>().Single(value => value.name == "Guardian action label").text);
                Assert.AreEqual(0, board.State.BonusCharges, "Realm art does not grant charges");
            }
        }
        [UnityTest] public IEnumerator SelectionDuringAnAsyncLoadNeverPresentsTheSupersededRealm()
        {
            evidence.Load("realm-8-daily"); yield return Ready(); var retired = board.View;
            evidence.Load("realm-1-daily");
            Assert.IsTrue(!board.PresentationInitialized); Assert.IsFalse(ZKube.Tests.Presentation.BoardTestState.Idle(board)); Assert.IsFalse(retired.gameObject.activeSelf);
            evidence.Load("realm-10-daily");
            uint actions = board.State.ActionCounter;
            board.Reroll(); board.SelectGuardian(); board.ShowStar(0);
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
            var font = boardArt.Body;
            yield return pageArt.Load(2); yield return null;
            Assert.AreEqual(1, AtlasOwners(realmPath), "The board retains the sole old-realm lease after page navigation");
            Assert.IsTrue(sharedAtlas != null, "The board still owns Balam's atlas");
            Assert.IsNotNull(boardArt.Sprite("boss__celebrate"), "An uncached sprite proves the atlas itself survived");
            pageArt.Dispose(); yield return null;
            Assert.IsNotNull(boardArt.Sprite("boss__defeated"));
            var common = (UnityEngine.U2D.SpriteAtlas)typeof(BoardArt).GetField("common", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(boardArt);
            var uncached = common.GetSprite("bonus__tiki");
            Assert.IsNotNull(uncached, "Common atlas ownership survives a fresh sprite lookup too");
            UnityEngine.Object.Destroy(uncached);
            Assert.AreSame(font, boardArt.Body);
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
            var uncached = common.GetSprite("bonus__tiki");
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

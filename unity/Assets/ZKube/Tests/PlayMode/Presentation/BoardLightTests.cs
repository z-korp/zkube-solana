using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.TestTools;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardLightTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        private bool reduced;
        [UnitySetUp] public IEnumerator SetUp()
        {
            reduced = AppPreferences.ReducedMotion;
            root = new GameObject("Light test board"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            board.SetMuted(true); board.SetReducedMotion(false);
            yield return Load("realm-8-daily");
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            UnityEngine.Object.Destroy(root); yield return null;
            AppPreferences.SetReducedMotion(reduced);
        }
        private IEnumerator Load(string fixture)
        {
            evidence.Load(fixture);
            float deadline = Time.realtimeSinceStartup + 20;
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board))
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board is still busy or loading");
                yield return null;
            }
        }
        private SpriteRenderer Named(string name) => board.View.GetComponentsInChildren<SpriteRenderer>().First(r => r.name == name);

        // Every board sprite draws its own texture: on every realm the frame is the
        // same with the SRP Batcher and without it, with the danger line's light
        // right behind the guardian's paws. A sprite handed its shared material
        // after its sprite drew its neighbour's atlas there, which showed as dark
        // boxes round the paws whenever a light sat behind them.
        [UnityTest] public IEnumerator EveryBoardSpriteDrawsItsOwnTextureOnEveryRealm()
        {
            board.SetReducedMotion(true);
            bool batching = GraphicsSettings.useScriptableRenderPipelineBatching;
            Color32[] Frame()
            {
                var texture = new Texture2D(Screen.width, Screen.height, TextureFormat.RGB24, false);
                texture.ReadPixels(new Rect(0, 0, Screen.width, Screen.height), 0, 0); texture.Apply();
                var pixels = texture.GetPixels32(); UnityEngine.Object.Destroy(texture); return pixels;
            }
            try
            {
                for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                {
                    evidence.LoadCampaign(realm, 1);
                    float deadline = Time.realtimeSinceStartup + 20;
                    while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) || board.Busy)
                    { if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board is still busy or loading"); yield return null; }
                    yield return null;
                    var grid = new byte[80]; for (int row = 0; row < 10; row++) for (int col = row % 2; col < 7; col += 3) grid[row * 8 + col] = 2;
                    board.View.SetBoard(grid);
                    Assert.IsTrue(Named("Danger line").enabled, "The line is lit");
                    Assert.Less(Named("Danger line").sortingOrder, Named("Guardian contact shadow").sortingOrder, "The line is behind the paws");
                    GraphicsSettings.useScriptableRenderPipelineBatching = true;
                    yield return null; yield return new WaitForEndOfFrame(); var batched = Frame();
                    GraphicsSettings.useScriptableRenderPipelineBatching = false;
                    yield return null; yield return new WaitForEndOfFrame(); var plain = Frame();
                    int differing = 0;
                    for (int i = 0; i < plain.Length; i++)
                        if (Mathf.Abs(plain[i].r - batched[i].r) > 12 || Mathf.Abs(plain[i].g - batched[i].g) > 12 || Mathf.Abs(plain[i].b - batched[i].b) > 12) differing++;
                    Assert.AreEqual(0, differing, "Realm " + realm + ": pixels drawn from another sprite's texture");
                }
            }
            finally { GraphicsSettings.useScriptableRenderPipelineBatching = batching; }
        }

        [Test] public void BloomOnlyTakesTheBrightestPixelsAtQuarterResolution()
        {
            var bloom = board.View.Lighting.Bloom;
            Assert.AreEqual(BoardLight.BloomThreshold, bloom.threshold.value); Assert.AreEqual(.9f, bloom.threshold.value);
            Assert.AreEqual(.5f, bloom.intensity.value); Assert.AreEqual(.6f, bloom.scatter.value);
            Assert.AreEqual(BloomDownscaleMode.Quarter, bloom.downscale.value); Assert.AreEqual(4, bloom.maxIterations.value);
            Assert.IsFalse(bloom.highQualityFiltering.value);
            var camera = board.View.GetComponentsInChildren<Camera>().Single(c => c.name == "Board Camera");
            Assert.IsTrue(camera.GetUniversalAdditionalCameraData().renderPostProcessing);
        }

        [Test] public void TheKeyLightFallsOnlyOnThePaintingAndTheGuardian()
        {
            var lit = new[] { "Realm background", "Calm realm guardian", SkinUi.GuardianFaceName, "Guardian paws" };
            foreach (var sprite in board.View.GetComponentsInChildren<SpriteRenderer>(true))
                Assert.AreEqual(lit.Contains(sprite.name) ? BoardLight.Lit : BoardLight.Unlit, sprite.sharedMaterial, sprite.name);
            var key = board.View.Lighting.Key;
            var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
            Assert.AreEqual(Light2D.LightType.Point, key.lightType);
            Assert.AreEqual(art.Token(SkinTokens.LightKey), key.color);
            var painting = Named("Realm background").bounds;
            Assert.AreEqual(painting.min.x + art.Light.source[0] * painting.size.x, key.transform.position.x, .5f);
            Assert.AreEqual(painting.max.y - art.Light.source[1] * painting.size.y, key.transform.position.y, .5f, "It shines from the painting's light");
        }

        [UnityTest] public IEnumerator MotesDriftOutsideTheBoardAndReducedMotionHasNone()
        {
            var lighting = board.View.Lighting;
            Assert.AreEqual(BoardLight.MoteCount, lighting.Motes); Assert.That(lighting.Motes, Is.InRange(12, 30));
            yield return null; yield return null;
            var rim = board.View.Layout.Rim;
            foreach (var mote in lighting.MoteRenderers)
            {
                Assert.AreEqual("mote", mote.sprite.name.Replace("(Clone)", ""));
                if (rim.Contains(mote.transform.position)) Assert.AreEqual(0, mote.color.a, "No mote shows over the board");
                Assert.Less(mote.sortingOrder, Named("Grid well").sortingOrder, "Motes drift behind the well");
            }
            var first = lighting.MoteRenderers.First().transform.position;
            for (float end = Time.realtimeSinceStartup + .5f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.AreNotEqual(first, lighting.MoteRenderers.First().transform.position, "Motes drift");
            board.SetReducedMotion(true);
            yield return Load("realm-8-campaign");
            Assert.AreEqual(0, board.View.Lighting.Motes); Assert.AreEqual(0, board.View.Lighting.Shafts);
        }

        [UnityTest] public IEnumerator MotesAndShaftsStayUnderTheDialogScrim()
        {
            board.View.OpenModal("Paused", "Scrim test", ("Resume", () => { }));
            yield return null;
            var shield = board.View.GetComponentsInChildren<UnityEngine.UI.Image>().Single(i => i.name == "Modal input shield");
            var canvas = shield.canvas.rootCanvas;
            // An overlay canvas draws after every camera, so the scrim covers every world sprite.
            Assert.AreEqual(RenderMode.ScreenSpaceOverlay, canvas.renderMode);
            Assert.AreEqual(ZKube.Tests.Presentation.BoardTestState.Art(board).Token(SkinTokens.Scrim), shield.color);
            var covered = SkinUi.ScreenRect(shield.rectTransform);
            Assert.IsTrue(covered.Contains(Vector2.zero) && covered.Contains(new Vector2(Screen.width - 1, Screen.height - 1)), "The scrim covers the screen");
            var light = board.View.Lighting.MoteRenderers.Concat(board.View.GetComponentsInChildren<SpriteRenderer>().Where(r => r.name == "Realm light shaft"));
            Assert.IsNotEmpty(light);
            foreach (var sprite in light)
                Assert.IsNull(sprite.GetComponentInParent<Canvas>(), sprite.name + " is a world sprite, drawn before the overlay");
            board.View.CloseModal();
        }

        [UnityTest] public IEnumerator OnlyRealmsWithAPaintedSourceThrowShafts()
        {
            Assert.AreEqual(1, board.View.Lighting.Shafts, "The Mayan canopy throws one shaft");
            Assert.AreEqual("fx-shaft", Named("Realm light shaft").sprite.name.Replace("(Clone)", ""));
            yield return Load("realm-1-daily");
            Assert.AreEqual(0, board.View.Lighting.Shafts, "Tiki's moon throws none");
        }

        [UnityTest] public IEnumerator BoardsShareOneAmbientLight()
        {
            var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
            var second = new GameObject("Second view"); second.transform.SetParent(root.transform);
            var ui = new SkinUi(art, 1, 1);
            var view = second.AddComponent<BoardView>();
            view.Create(board, art, HudLayout.Build(ui, board.State, board.Session, new Rect(0, 0, 360, 640), 1), ui);
            yield return null;
            Assert.AreEqual(1, UnityEngine.Object.FindObjectsByType<Light2D>(FindObjectsSortMode.None).Count(l => l.lightType == Light2D.LightType.Global));
            UnityEngine.Object.Destroy(second); yield return null;
            Assert.AreEqual(1, UnityEngine.Object.FindObjectsByType<Light2D>(FindObjectsSortMode.None).Count(l => l.lightType == Light2D.LightType.Global),
                "The remaining board keeps its light");
        }
    }
}

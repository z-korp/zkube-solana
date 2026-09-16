using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardAudioTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        private float savedMusic, savedEffects;
        private int savedMute, savedMotion;
        private bool hadMusic, hadEffects, hadMute, hadMotion;
        private AudioSource Music => root.GetComponents<AudioSource>().Single(value => value.loop);
        private AudioSource Effects => root.GetComponents<AudioSource>().Single(value => !value.loop);
        [UnitySetUp] public IEnumerator SetUp()
        {
            hadMusic = PlayerPrefs.HasKey(AudioPolicy.MusicKey); savedMusic = PlayerPrefs.GetFloat(AudioPolicy.MusicKey);
            hadEffects = PlayerPrefs.HasKey(AudioPolicy.EffectsKey); savedEffects = PlayerPrefs.GetFloat(AudioPolicy.EffectsKey);
            hadMute = PlayerPrefs.HasKey("zkube.sound.muted"); savedMute = PlayerPrefs.GetInt("zkube.sound.muted");
            hadMotion = PlayerPrefs.HasKey("zkube.motion.reduced"); savedMotion = PlayerPrefs.GetInt("zkube.motion.reduced");
            PlayerPrefs.DeleteKey(AudioPolicy.MusicKey); PlayerPrefs.DeleteKey(AudioPolicy.EffectsKey); PlayerPrefs.SetInt("zkube.sound.muted", 1);
            Create(); yield return null;
        }
        private void Create()
        {
            root = new GameObject("Independent audio channels"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            Object.Destroy(root); yield return null;
            if (hadMusic) PlayerPrefs.SetFloat(AudioPolicy.MusicKey, savedMusic); else PlayerPrefs.DeleteKey(AudioPolicy.MusicKey);
            if (hadEffects) PlayerPrefs.SetFloat(AudioPolicy.EffectsKey, savedEffects); else PlayerPrefs.DeleteKey(AudioPolicy.EffectsKey);
            if (hadMute) PlayerPrefs.SetInt("zkube.sound.muted", savedMute); else PlayerPrefs.DeleteKey("zkube.sound.muted");
            if (hadMotion) PlayerPrefs.SetInt("zkube.motion.reduced", savedMotion); else PlayerPrefs.DeleteKey("zkube.motion.reduced");
        }
        private IEnumerator Ready()
        {
            float deadline = Time.realtimeSinceStartup + 30;
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) || board.Busy)
            { if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board is still busy or loading"); yield return null; }
        }
        [UnityTest] public IEnumerator IndependentLevelsUseActualDefaultsAndSurviveMasterMute()
        {
            Assert.AreEqual((float)AudioPolicy.DefaultMusicVolume, Music.volume);
            Assert.AreEqual((float)AudioPolicy.DefaultEffectsVolume, Effects.volume);
            evidence.Load("realm-8-daily"); yield return Ready();
            uint actions = board.State.ActionCounter;
            board.SetMusicVolume(.61); Assert.AreEqual(.61f, Music.volume); Assert.AreEqual((float)AudioPolicy.DefaultEffectsVolume, Effects.volume);
            board.SetEffectsVolume(.27); Assert.AreEqual(.61f, Music.volume); Assert.AreEqual(.27f, Effects.volume);
            board.SetMusicVolume(0); board.SetMuted(false); board.SetMuted(true);
            Assert.AreEqual(0, Music.volume); Assert.AreEqual(.27f, Effects.volume);
            Assert.IsTrue(Music.mute); Assert.IsTrue(Effects.mute);
            Assert.AreEqual(actions, board.State.ActionCounter, "Audio preferences cannot submit a run action");
        }
        [UnityTest] public IEnumerator PausedVolumeChangesDoNotRestartMusicAndRealmSwitchKeepsPreferences()
        {
            evidence.Load("realm-8-daily"); yield return Ready();
            board.SetMuted(false); board.Pause();
            board.SetMusicVolume(.53); board.SetEffectsVolume(.19); yield return null;
            Assert.IsTrue(board.Paused); Assert.IsFalse(Music.isPlaying);
            board.SetMuted(true); evidence.Load("realm-2-daily"); yield return Ready();
            Assert.AreEqual(2, ZKube.Tests.Presentation.BoardTestState.Art(board).RealmId);
            Assert.AreEqual(.53f, Music.volume); Assert.AreEqual(.19f, Effects.volume);
            Assert.IsTrue(Music.mute); Assert.IsTrue(Effects.mute); Assert.IsFalse(Music.isPlaying);
        }
        [UnityTest] public IEnumerator SettingsBeforeStartAreAppliedAndPersistAcrossControllerRecreation()
        {
            Object.Destroy(root); yield return null; Create();
            board.SetMusicVolume(.82); board.SetEffectsVolume(.13);
            Assert.IsEmpty(root.GetComponents<AudioSource>(), "Host settings can run before the board's first Start");
            yield return null;
            Assert.AreEqual(.82f, Music.volume); Assert.AreEqual(.13f, Effects.volume);
            Object.Destroy(root); yield return null; Create(); yield return null;
            Assert.That(board.MusicVolume, Is.EqualTo(.82).Within(0.000001)); Assert.That(board.EffectsVolume, Is.EqualTo(.13).Within(0.000001));
            Assert.AreEqual(.82f, Music.volume); Assert.AreEqual(.13f, Effects.volume);
        }
    }
}

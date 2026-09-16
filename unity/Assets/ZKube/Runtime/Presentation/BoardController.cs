using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.EventSystems;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    public sealed class BoardController : MonoBehaviour
    {
        private BoardArt art;
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        private AudioSource effects, music;
        private AudioPreferences audioPreferences;
        private AudioPreferences AudioSettings => audioPreferences ??= new AudioPreferences(
            key => PlayerPrefs.GetString(key, ""), (key, value) => { PlayerPrefs.SetString(key, value); PlayerPrefs.Save(); });
        public double MusicVolume => AudioSettings.MusicVolume;
        public double EffectsVolume => AudioSettings.EffectsVolume;
        private bool paused, busy, guardianSelected, recoveryRequired, recoveryUnavailable;
        private int activePointer = int.MinValue, dragRow, dragStart, dragWidth;
        private Vector2 down;
        private float grabOffset;
        private byte[] dragGrid;
        private BoardAction? queued;
        private byte[] queuedGrid;
        private string failure;
        private Rect lastSafe;
        private Vector2Int lastSize;
        public BoardView View { get; private set; }
        public BoardSession Session { get; private set; }
        public RunSummary State { get; private set; }
        [NonSerialized] private bool initialized;
        [NonSerialized] private bool bootstrapped, loadingRealm;
        [NonSerialized] private bool playReloadInvalidated;
        public bool PresentationInitialized => initialized && !loadingRealm && !playReloadInvalidated && View != null && View.HasRuntimeGraph;
        public bool Busy => busy;
        public bool RecoveryRequired => recoveryRequired;
        public bool Paused => paused;
        public bool ReducedMotion { get; private set; }
        public bool Muted { get; private set; }
        public bool Haptics { get; private set; }
        public float TextScale { get; private set; } = 1;
        public event Action<CoreRunToken> Accepted;
        public event Action ExitRequested;
        public event Action<string> Rejected;
        // Optional backend-neutral host policy. Local/store boards retain the
        // default terminal card and input behavior when no host installs it.
        public Action<BoardController, string, string> TerminalPresenter { get; set; }
        public bool HostInputEnabled { get; private set; } = true;
        public void SetHostInputEnabled(bool value)
        {
            if (HostInputEnabled == value) return;
            HostInputEnabled = value;
            if (!value) { queued = null; queuedGrid = null; CancelDrag(); }
            if (PresentationInitialized && State != null)
                View.Summary(State, Session, value && !busy && !paused && !recoveryRequired && State.Phase == (byte)CorePhase.Playing);
        }
        public void RequireRecovery(string message)
        {
            recoveryRequired = true; recoveryUnavailable = false; failure = message;
            queued = null; queuedGrid = null; CancelDrag();
            if (PresentationInitialized && !busy) ShowRecovery();
        }
        // Foreground observation never requests an opening or repeats a gesture.
        // The host validates its immutable binding before supplying the snapshot.
        public async Task ObserveSnapshot(BoardActionResult snapshot)
        {
            if (busy || snapshot == null || !snapshot.IsSnapshot) throw new InvalidOperationException("A snapshot requires an idle board");
            busy = true;
            try { await PresentAccepted(snapshot); }
            finally { if (this != null) CompleteInteraction(); }
        }

        private void Awake()
        {
            ReducedMotion = PlayerPrefs.GetInt("zkube.motion.reduced", 0) == 1;
            Muted = PlayerPrefs.GetInt("zkube.sound.muted", 0) == 1;
            Haptics = PlayerPrefs.GetInt("zkube.haptics.enabled", 0) == 1;
            TextScale = ReadSavedTextScale();
            // The listener belongs to the board session, not its replaceable
            // camera/view. Reuse an existing active scene listener when present.
            if (!FindObjectsByType<AudioListener>(FindObjectsSortMode.None).Any(l => l.enabled && l.gameObject.activeInHierarchy))
                gameObject.AddComponent<AudioListener>();
            if (EventSystem.current == null)
            {
                var events = new GameObject("Board EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
                events.transform.SetParent(transform, false);
            }
        }

#if UNITY_EDITOR
        private void OnEnable()
        {
            // Unity hot reload can preserve private bools/Unity object fields
            // while dropping opaque managed session objects and layout structs.
            // Never reinterpret that partial graph as a recovered accepted run.
            if (Application.isPlaying && !initialized && GetComponentInChildren<BoardView>(true) != null)
            {
                playReloadInvalidated = true; recoveryRequired = true;
                Session = null; State = null;
                foreach (var view in GetComponentsInChildren<BoardView>(true)) view.gameObject.SetActive(false);
                Debug.LogWarning("Editor code reload invalidated the run; restart Play");
            }
        }
#endif

        private IEnumerator Start()
        {
            art = new BoardArt();
            effects = gameObject.AddComponent<AudioSource>(); effects.playOnAwake = false;
            music = gameObject.AddComponent<AudioSource>(); music.playOnAwake = false; music.loop = true;
            ApplyChannelVolumes();
            SetMuted(Muted);
            bootstrapped = true;
            // There is no implicit default guardian. Hosts bind an accepted run
            // before any realm atlas, music, or playable geometry is selected.
            if (Session != null) yield return LoadBoundRealm();
        }

        public void Bind(BoardSession session)
        {
            if (playReloadInvalidated) throw new InvalidOperationException("Editor code reload invalidated the run; restart Play");
            if (busy) throw new InvalidOperationException("Cannot replace a board while an action is unresolved");
            Session = session ?? throw new ArgumentNullException(nameof(session));
            State = NativeEngine.Summary(session.Accepted);
            guardianSelected = false; paused = false; queued = null; queuedGrid = null;
            recoveryRequired = false; recoveryUnavailable = false; failure = null;
            // A new run changes measured HUD slots even when every text label
            // still fits (for example, Daily has no Campaign socket row).
            // Invalidate the old gesture and layout together at that boundary.
            if (!bootstrapped || loadingRealm) return;
            if (PresentationInitialized && art.RealmId == session.RealmId)
            { CancelDrag(); SetMuted(Muted); CreateView(); DisplayAccepted(); ResolveOpening(); }
            else StartCoroutine(LoadBoundRealm());
        }
        private IEnumerator LoadBoundRealm()
        {
            loadingRealm = true; initialized = false; CancelDrag();
            if (View != null) { View.gameObject.SetActive(false); Destroy(View.gameObject); View = null; }
            ReleaseRealmMusic();
            try
            {
                // Let the retired view release its sprite/material references
                // before unloading its atlas. Common fonts/effects remain owned.
                yield return null;
                while (!lifetime.IsCancellationRequested)
                {
                    byte requested = Session.RealmId;
                    yield return art.Load(requested);
                    if (lifetime.IsCancellationRequested) yield break;
                    // Bind may replace a selection while Resources is loading.
                    // Serialize loads and never expose that superseded realm.
                    if (Session.RealmId != requested) continue;
                    music.clip = Resources.Load<AudioClip>(art.LevelMusicResource);
                    if (music.clip == null) throw new InvalidOperationException("The bound realm music is missing");
                    SetMuted(Muted); CreateView(); initialized = true; loadingRealm = false;
                    DisplayAccepted(); ResolveOpening(); yield break;
                }
            }
            finally { loadingRealm = false; }
        }
        private void ReleaseRealmMusic()
        {
            if (music == null) return;
            music.Stop(); var old = music.clip; music.clip = null;
            if (old != null) Resources.UnloadAsset(old);
        }
        private void CreateView()
        {
            lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
            if (View != null) { View.gameObject.SetActive(false); Destroy(View.gameObject); }
            var root = new GameObject("Realm " + art.RealmId + " board presentation"); root.transform.SetParent(transform, false);
            View = root.AddComponent<BoardView>();
            float density = ReadDisplayDensity();
            var typography = BoardTypography.Build(art, State, Session, lastSafe, density, TextScale);
            View.Create(this, art, typography.Layout, typography);
        }
        private void Update()
        {
            if (!PresentationInitialized || busy || activePointer != int.MinValue) return;
            if (lastSafe != Screen.safeArea || lastSize.x != Screen.width || lastSize.y != Screen.height || View.NeedsTextReflow || View.TextScale != TextScale)
                RefreshLayout();
        }
        // Also used by the host when display metrics/insets change. Session
        // services survive the disposable visual hierarchy.
        public void RefreshLayout()
        {
            if (!PresentationInitialized || busy) return;
            CancelDrag(); CreateView(); if (Session != null) DisplayAccepted();
            if (recoveryRequired) ShowRecovery();
            else if (IsTerminal()) ShowTerminalIfNeeded(false);
            else if (paused) Pause();
        }
        private void DisplayAccepted()
        {
            State = NativeEngine.Summary(Session.Accepted);
            View.SetBoard(State.Grid); View.SetPreview(State.HasNextRow, State.NextRow);
            View.Summary(State, Session, HostInputEnabled && !busy && !paused && !recoveryRequired && State.Phase == (byte)CorePhase.Playing);
            View.Status(BoardNotices.Ready(Session.Daily, State.CurrentTier));
        }

        public void BeginDrag(int pointer, Vector2 position)
        {
            if (!HostInputEnabled || !PresentationInitialized || Session == null || paused || recoveryRequired || activePointer != int.MinValue || IsTerminal()) return;
            if (!View.Layout.TryCell(position, out int row, out int column)) return;
            if (guardianSelected)
            {
                guardianSelected = false; Submit(new BoardAction(BoardActionKind.Guardian, (byte)row, (byte)column)); return;
            }
            // This only identifies the drawn sprite under a pointer. The native
            // engine alone decides whether its destination or action is valid.
            int start = 0;
            while (start < 8)
            {
                int width = View.DisplayGrid[row * 8 + start];
                if (width == 0) { start++; continue; }
                if (column >= start && column < start + width)
                {
                    activePointer = pointer; down = position; dragRow = row; dragStart = start; dragWidth = width;
                    dragGrid = (byte[])View.DisplayGrid.Clone();
                    grabOffset = position.x - View.Layout.CellCenter(row, start, width).x;
                    View.Ghost(row, start, width, position.x - grabOffset); return;
                }
                start += width;
            }
        }
        public void Drag(int pointer, Vector2 position)
        {
            if (pointer != activePointer) return;
            View.Ghost(dragRow, dragStart, dragWidth, position.x - grabOffset);
        }
        public void EndDrag(int pointer, Vector2 position)
        {
            if (pointer != activePointer) return;
            int destination = Mathf.RoundToInt((position.x - grabOffset - View.Layout.Board.x) / View.Layout.Cell - dragWidth / 2f);
            var snapshot = dragGrid;
            CancelDrag();
            if (Mathf.Abs(position.x - down.x) < 8 * View.Layout.Density || destination == dragStart) return;
            if (destination < 0 || destination + dragWidth > 8) { View.Status(BoardNotices.Text(BoardNotice.Outside)); return; }
            var action = new BoardAction(BoardActionKind.Move, (byte)dragRow, (byte)dragStart, (byte)destination);
            if (busy) { queued = action; queuedGrid = snapshot; View.Status(BoardNotices.Text(BoardNotice.Queued)); }
            else Submit(action);
        }
        public void CancelDrag()
        {
            activePointer = int.MinValue; dragGrid = null;
            if (View != null) View.ClearGhost();
        }
        public void SelectGuardian()
        {
            if (!HostInputEnabled || !PresentationInitialized || State == null || busy || paused || recoveryRequired || State.BonusCharges == 0 || IsTerminal()) return;
            guardianSelected = !guardianSelected;
            View.Status(guardianSelected ? BoardNotices.Text(State.BonusType == 2 ? BoardNotice.Totem : State.BonusType == 3 ? BoardNotice.Wave : BoardNotice.Hammer) : "");
        }
        public void Reroll()
        {
            if (!HostInputEnabled || !PresentationInitialized || State == null || busy || paused || recoveryRequired || State.RerollCharges == 0 || IsTerminal()) return;
            Submit(new BoardAction(BoardActionKind.Reroll));
        }
        private async void ResolveOpening()
        {
            if (State.Phase != (byte)CorePhase.AwaitingVrf || busy) { ShowTerminalIfNeeded(); return; }
            busy = true;
            try { await ResolveRandomness(); }
            catch (OperationCanceledException error) { if (!lifetime.IsCancellationRequested) ReportFailure(error); }
            catch (Exception error) { ReportFailure(error); }
            finally { if (this != null) CompleteInteraction(); }
        }
        private async void Submit(BoardAction action)
        {
            if (!HostInputEnabled || !PresentationInitialized || Session == null || busy || recoveryRequired || IsTerminal()) return;
            busy = true; guardianSelected = false; queued = null;
            failure = null;
            View.Summary(State, Session, false); View.Status(BoardNotices.Text(BoardNotice.Pending));
            try
            {
                var transition = await Session.Actions.Submit(Session.Accepted, action, lifetime.Token);
                await PresentAccepted(transition);
                await ResolveRandomness();
            }
            catch (OperationCanceledException error) { if (!lifetime.IsCancellationRequested) ReportFailure(error); }
            catch (Exception error) { ReportFailure(error); }
            finally { if (this != null) CompleteInteraction(); }
        }
        private async Task ResolveRandomness()
        {
            while (State.Phase == (byte)CorePhase.AwaitingVrf)
            {
                View.Summary(State, Session, false); View.Status(BoardNotices.Text(BoardNotice.WaitingRow));
                var transition = await Session.Actions.ResolveVrf(Session.Accepted, lifetime.Token);
                await PresentAccepted(transition);
            }
        }
        public async void Recover()
        {
            if (busy || !recoveryRequired || recoveryUnavailable || !(Session?.Actions is IBoardRecoveryProvider provider)) return;
            busy = true; paused = false; guardianSelected = false; queued = null; queuedGrid = null;
            CancelDrag(); failure = null;
            View.OpenModal("RECOVERING RUN", BoardNotices.Text(BoardNotice.Recovering));
            View.Status(BoardNotices.Text(BoardNotice.Recovering));
            try
            {
                var result = await provider.Recover(lifetime.Token);
                lifetime.Token.ThrowIfCancellationRequested();
                if (result == null) { recoveryUnavailable = true; return; }
                if (!result.IsSnapshot) throw new InvalidOperationException("Recovery must return an accepted snapshot");
                await PresentAccepted(result);
                await ResolveRandomness();
                recoveryRequired = false; View.CloseModal();
                if (!Muted) music.UnPause();
            }
            catch (OperationCanceledException error) { if (!lifetime.IsCancellationRequested) ReportFailure(error); }
            catch (Exception error) { ReportFailure(error); }
            finally { if (this != null) CompleteInteraction(); }
        }
        private async Task PresentAccepted(BoardActionResult result)
        {
            lifetime.Token.ThrowIfCancellationRequested();
            if (!result.Token.Config.SequenceEqual(Session.Accepted.Config))
                throw new InvalidOperationException("Accepted response belongs to another run configuration");
            var final = NativeEngine.Summary(result.Token);
            byte previousStars = State.LatchedStarSources;
            uint previousScore = Session.Daily ? State.DailyScore : State.Score;
            ulong previousTheme = State.ObjectiveTotal;
            bool changed = !result.Token.State.SequenceEqual(Session.Accepted.State);
            Session.Accepted = result.Token; State = final;
            if (changed) Accepted?.Invoke(result.Token);
            if (result.IsSnapshot)
            {
                View.SetBoard(State.Grid); View.SetPreview(State.HasNextRow, State.NextRow);
                View.Summary(State, Session, false);
                View.Status(BoardNotices.Text(BoardNotice.Accepted));
                return;
            }
            // A repeated accepted token carries no new action to celebrate.
            // Snapshots above still refresh the display without inventing history.
            if (!changed) return;
            var transition = result.Transition;
            // Acceptance survives a presentation failure. Rendering may fall
            // back to this snapshot; it must never roll an accepted action back.
            if (!PresentationTrace.ProjectBoard(View.DisplayGrid, transition.Events).SequenceEqual(final.Grid))
                throw new InvalidOperationException("Presentation trace differs from the native accepted board");
            uint acceptedScore = Session.Daily ? State.DailyScore : State.Score;
            View.ShowGains(acceptedScore > previousScore ? acceptedScore - previousScore : 0,
                Session.Daily && State.ObjectiveTotal > previousTheme ? State.ObjectiveTotal - previousTheme : 0,
                State.ComboCounter, ReducedMotion);
            View.Status(BoardNotices.Text(BoardNotice.Accepted));
            var completion = new TaskCompletionSource<bool>();
            StartCoroutine(Animate(transition, completion));
            using (lifetime.Token.Register(() => completion.TrySetCanceled())) await completion.Task;
            View.Summary(State, Session, false);
            if (State.LatchedStarSources != previousStars) Sound("star");
            else if ((Session.Daily ? State.DailyScore : State.Score) > previousScore) Sound("constraint-complete");
            if (Haptics && Application.platform == RuntimePlatform.Android) Handheld.Vibrate();
        }
        private IEnumerator Animate(RunTransition transition, TaskCompletionSource<bool> completion)
        {
            var animation = View.Trace(transition.Events, ReducedMotion, Sound);
            while (true)
            {
                bool more;
                try { more = animation.MoveNext(); }
                catch (Exception error) { completion.TrySetException(error); yield break; }
                if (!more) break;
                yield return animation.Current;
            }
            completion.TrySetResult(true);
        }
        private void CompleteInteraction()
        {
            busy = false;
            View.Summary(State, Session, HostInputEnabled && !paused && !recoveryRequired && State.Phase == (byte)CorePhase.Playing);
            View.Status(failure ?? BoardNotices.Ready(Session.Daily, State.CurrentTier));
            if (recoveryRequired)
            {
                queued = null; queuedGrid = null; CancelDrag(); ShowRecovery(); return;
            }
            ShowTerminalIfNeeded();
            if (queued.HasValue)
            {
                var action = queued.Value; queued = null;
                if (HostInputEnabled && !paused && !recoveryRequired && State.Phase == (byte)CorePhase.Playing && queuedGrid.SequenceEqual(State.Grid)) Submit(action);
                else View.Status(BoardNotices.Text(BoardNotice.Changed));
                queuedGrid = null;
            }
        }
        private void ReportFailure(Exception error)
        {
            if (this == null) return;
            string message = BoardNotices.Text(error is NativeEngineException ? BoardNotice.Unavailable : BoardNotice.Recover);
            failure = message;
            recoveryRequired = recoveryRequired || State.Phase == (byte)CorePhase.AwaitingVrf || !(error is NativeEngineException);
            State = NativeEngine.Summary(Session.Accepted);
            View.SetBoard(State.Grid); View.SetPreview(State.HasNextRow, State.NextRow);
            View.Status(message); Rejected?.Invoke(message);
            Debug.LogWarning("Board action: " + error.Message);
        }
        private bool IsTerminal() => State != null && (State.Phase == (byte)CorePhase.Finished || State.Phase == (byte)CorePhase.LevelComplete);
        private void ShowRecovery()
        {
            music.Pause();
            if (busy)
                View.OpenModal("RECOVERING RUN", BoardNotices.Text(BoardNotice.Recovering));
            else if (recoveryUnavailable || !(Session.Actions is IBoardRecoveryProvider))
                View.OpenModal("RETURN TO YOUR RUNS", "This board cannot continue here. Return to your runs to recover the current state.",
                    ("Back to my runs", () => ExitRequested?.Invoke()));
            else
                View.OpenModal("RECOVER RUN", "The action may have been accepted. Check the run before playing again.",
                    ("Recover run", Recover), ("Back to my runs", () => ExitRequested?.Invoke()));
        }
        private void ShowTerminalIfNeeded(bool playFeedback = true)
        {
            if (!IsTerminal()) return;
            bool completed = State.Phase == (byte)CorePhase.LevelComplete || State.EndReason == 1;
            View.Terminal(completed); music.Pause(); if (playFeedback) Sound(completed ? "victory" : "over");
            string body = Session.Daily
                ? "Score " + State.DailyScore + "\nTheme " + State.ObjectiveTotal + "\n" + State.Moves + " moves"
                : "Score " + State.Score + "\n" + ((State.LatchedStarSources & 1) != 0 ? "★" : "☆") + " Score   " + ((State.LatchedStarSources & 2) != 0 ? "★" : "☆") + " Shape   " + ((State.LatchedStarSources & 4) != 0 ? "★" : "☆") + " Blow";
            string title = completed ? "LEVEL COMPLETE" : "RUN ENDED";
            if (TerminalPresenter != null) TerminalPresenter(this, title, body);
            else View.OpenModal(title, body, ("Continue", () => ExitRequested?.Invoke()));
        }

        public void Pause()
        {
            if (PresentationInitialized && Session != null && recoveryRequired) { ShowRecovery(); return; }
            if (!PresentationInitialized || Session == null || IsTerminal()) return;
            paused = true; queued = null; CancelDrag(); music.Pause();
            View.OpenModal("PAUSED", art.Title(Session),
                ("Resume", Resume),
                (Muted ? "Sound: off" : "Sound: on", () => { SetMuted(!Muted); Pause(); }),
                (ReducedMotion ? "Reduced motion: on" : "Reduced motion: off", () => { SetReducedMotion(!ReducedMotion); Pause(); }),
                (Haptics ? "Haptics: on" : "Haptics: off", () => { SetHaptics(!Haptics); Pause(); }),
                (TextScale > 1 ? "Text size: larger" : "Text size: standard", () => { SetTextScale(TextScale > 1 ? 1 : 1.3f); Pause(); }),
                ("End run", () => View.OpenModal("END THIS RUN?", "Your accepted actions remain part of this run.",
                    ("Keep playing", Resume), ("End run", () => { paused = false; View.CloseModal(); Submit(new BoardAction(BoardActionKind.Abandon)); }))));
        }
        public void Resume()
        {
            if (!HostInputEnabled) return;
            if (recoveryRequired) { ShowRecovery(); return; }
            paused = false; View.CloseModal();
            if (!Muted) music.UnPause();
            View.Summary(State, Session, !busy && !recoveryRequired && State.Phase == (byte)CorePhase.Playing);
        }
        public void ShowStar(int source)
        {
            if (!PresentationInitialized || Session == null || Session.Daily || paused || recoveryRequired || IsTerminal()) return;
            paused = true;
            var rules = Session.Rules;
            string title = source == 0 ? "SCORE" : source == 1 ? "SHAPE" : "BLOW";
            string detail = source == 0 ? "Reach " + rules.PointsRequired + " points"
                : source == 1 ? BoardView.ObjectiveName(rules.PrimaryKind, rules.PrimaryValue) + "\n" + State.PrimaryProgress + " / " + rules.PrimaryCount
                : BoardView.ObjectiveName(rules.SecondaryKind, rules.SecondaryValue) + "\n" + ((State.LatchedStarSources & 4) != 0 ? "Earned" : "Waiting for the moment");
            View.OpenModal(title, detail, ("Back to the board", Resume));
        }
        // Android may kill the process without a quit callback. A settings action
        // must finish its save while the app is still running.
        private static void SavePreference(string key, int value) { PlayerPrefs.SetInt(key, value); PlayerPrefs.Save(); }
        public void SetReducedMotion(bool value) { ReducedMotion = value; SavePreference("zkube.motion.reduced", value ? 1 : 0); }
        public void SetHaptics(bool value) { Haptics = value; SavePreference("zkube.haptics.enabled", value ? 1 : 0); }
        public static float ReadSavedTextScale() => PlayerPrefs.GetInt("zkube.text.larger", 0) == 1 ? 1.3f : 1;
        public static float ReadDisplayDensity() => Application.isEditor || Screen.dpi <= 0 ? 1 : Screen.dpi / 160;
        public static float SupportedTextScale(float value)
        {
            if (value != 1 && !Mathf.Approximately(value, 1.3f)) throw new ArgumentOutOfRangeException(nameof(value), "Supported text sizes are 1.0 and 1.3");
            return value > 1 ? 1.3f : 1;
        }
        public void SetTextScale(float value)
        {
            TextScale = SupportedTextScale(value); SavePreference("zkube.text.larger", TextScale > 1 ? 1 : 0);
            if (PresentationInitialized && !busy) RefreshLayout();
        }
        public void SetMuted(bool value)
        {
            Muted = value; SavePreference("zkube.sound.muted", value ? 1 : 0);
            if (effects != null) effects.mute = value;
            if (music != null) { music.mute = value; if (!value && !paused && music.clip != null && !music.isPlaying) music.Play(); }
        }
        public void SetMusicVolume(double value)
        {
            try { AudioSettings.SetMusicVolume(value); }
            finally { ApplyChannelVolumes(); }
        }
        public void SetEffectsVolume(double value)
        {
            try { AudioSettings.SetEffectsVolume(value); }
            finally { ApplyChannelVolumes(); }
        }
        private void ApplyChannelVolumes()
        {
            if (music != null) music.volume = (float)MusicVolume;
            if (effects != null) effects.volume = (float)EffectsVolume;
        }
        private void Sound(string name)
        {
            if (Muted || effects == null) return;
            if (!clips.TryGetValue(name, out var clip)) { clip = Resources.Load<AudioClip>("ZKube/Audio/common/sounds__effects__" + name); clips[name] = clip; }
            if (clip != null) effects.PlayOneShot(clip);
        }
        private void OnApplicationPause(bool value) { if (value && PresentationInitialized && !paused) Pause(); }
        private void OnDestroy()
        {
            lifetime.Cancel(); lifetime.Dispose(); art?.Dispose();
            foreach (var clip in clips.Values) if (clip != null) Resources.UnloadAsset(clip);
            ReleaseRealmMusic();
        }
    }
}

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
    public sealed class BoardHostHooks
    {
        public Action<CoreRunToken> Accepted;
        public Action<string> Rejected;
        public Action Exit;
        // Leaves the board for Home with its run as it stands; a host without one leaves by Exit.
        public Action Home;
        public Action<BoardController> Terminal;
    }

    public sealed class BoardController : MonoBehaviour
    {
        private BoardArt art;
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private readonly Dictionary<string, AudioClip> clips = new Dictionary<string, AudioClip>();
        private AudioSource effects, music;
        private AudioPreferences audioPreferences;
        private AudioPreferences AudioSettings => audioPreferences ??= AppPreferences.Audio();
        public double MusicVolume => AudioSettings.MusicVolume;
        public double EffectsVolume => AudioSettings.EffectsVolume;
        private bool paused, busy, guardianSelected, recoveryRequired, recoveryUnavailable;
        private int activePointer = int.MinValue, dragRow, dragStart, dragWidth, dragMin, dragMax;
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
        // The board is on screen with its run drawn; a page handing the screen to it may go.
        public bool Drawn => isActiveAndEnabled && PresentationInitialized;
        public bool Busy => busy;
        public bool RecoveryRequired => recoveryRequired;
        public bool Paused => paused;
        public bool ReducedMotion { get; private set; }
        public bool Muted { get; private set; }
        public bool Haptics { get; private set; }
        public float TextScale { get; private set; } = 1;
        public BoardHostHooks Host { get; set; } = new BoardHostHooks();
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
        // The host validates its immutable binding before supplying the state.
        public void Observe(CoreRunToken accepted)
        {
            if (busy || accepted == null) throw new InvalidOperationException("An observed state requires an idle board");
            Show(accepted); CompleteInteraction();
        }

        // The saved settings, as they stand now. A board made for a run reads them
        // once; one kept while pages change them reads them again before its
        // next run. Nothing is written.
        public void ReadPreferences()
        {
            ReducedMotion = AppPreferences.ReducedMotion;
            Muted = AppPreferences.Muted;
            Haptics = AppPreferences.Haptics;
            TextScale = ReadSavedTextScale();
            audioPreferences = null; ApplyChannelVolumes();
            if (effects != null) effects.mute = Muted;
            if (music != null) music.mute = Muted;
        }
        // An explicit size (a test's) stands in for the saved one and is never saved.
        public void OverrideTextScale(float value)
        {
            TextScale = SupportedTextScale(value);
            if (PresentationInitialized && !busy) RefreshLayout();
        }
        private void Awake()
        {
            ReadPreferences();
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
            guardianSelected = false; paused = false; leaving = false; queued = null; queuedGrid = null;
            recoveryRequired = false; recoveryUnavailable = false; failure = null;
            // A new run changes measured HUD slots even when every text label
            // still fits (for example, Daily has no Campaign socket row).
            // Invalidate the old gesture and layout together at that boundary.
            if (!bootstrapped || loadingRealm) return;
            if (PresentationInitialized && art.RealmId == session.RealmId)
            { CancelDrag(); UseRunMusic(); SetMuted(Muted); CreateView(); DisplayAccepted(); IntroduceGuardian(); ResolveOpening(); }
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
                    UseRunMusic();
                    SetMuted(Muted); CreateView(); initialized = true; loadingRealm = false;
                    DisplayAccepted(); IntroduceGuardian(); ResolveOpening(); yield break;
                }
            }
            finally { loadingRealm = false; }
        }
        // The realm's level track, or the guardian's own on its level.
        private string musicResource;
        private void UseRunMusic()
        {
            string wanted = HudLayout.BossLevel(Session) ? art.BossMusicResource : art.LevelMusicResource;
            if (music.clip != null && musicResource == wanted) return;
            ReleaseRealmMusic();
            music.clip = Resources.Load<AudioClip>(wanted); musicResource = wanted;
            if (music.clip == null) throw new InvalidOperationException("The bound realm music is missing");
        }
        // The guardian's level opens with the guardian: once for a fresh run.
        private BoardSession introduced;
        private void IntroduceGuardian()
        {
            if (!HudLayout.BossLevel(Session) || introduced == Session || State.ActionCounter != 0) return;
            introduced = Session;
            View.IntroduceGuardian(ReducedMotion); Sound(SoundCues.BossIntro);
        }
        private void ReleaseRealmMusic()
        {
            if (music == null) return;
            music.Stop(); var old = music.clip; music.clip = null; musicResource = null;
            if (old != null) Resources.UnloadAsset(old);
        }
        private void CreateView()
        {
            lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height); askingReroll = false;
            if (View != null) { View.gameObject.SetActive(false); Destroy(View.gameObject); }
            var root = new GameObject("Realm " + art.RealmId + " board presentation"); root.transform.SetParent(transform, false);
            View = root.AddComponent<BoardView>();
            float density = ReadDisplayDensity();
            var ui = new SkinUi(art, Mathf.Max(.5f, density), TextScale);
            View.Create(this, art, HudLayout.Build(ui, State, Session, lastSafe, density, new Rect(0, 0, Screen.width, Screen.height)), ui);
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
            View.Status(""); View.Choose(guardianSelected);
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
                    // A block slides only through the empty run of cells beside it:
                    // it stops against its neighbours instead of passing through them.
                    dragMin = start; dragMax = start;
                    while (dragMin > 0 && dragGrid[row * 8 + dragMin - 1] == 0) dragMin--;
                    while (dragMax + width < 8 && dragGrid[row * 8 + dragMax + width] == 0) dragMax++;
                    grabOffset = position.x - View.Layout.CellCenter(row, start, width).x;
                    View.Ghost(row, start, width, position.x - grabOffset, dragMin, dragMax); return;
                }
                start += width;
            }
        }
        public void Drag(int pointer, Vector2 position)
        {
            if (pointer != activePointer) return;
            View.Ghost(dragRow, dragStart, dragWidth, position.x - grabOffset, dragMin, dragMax);
        }
        public void EndDrag(int pointer, Vector2 position)
        {
            if (pointer != activePointer) return;
            int destination = Mathf.Clamp(Mathf.RoundToInt((position.x - grabOffset - View.Layout.Board.x) / View.Layout.Cell - dragWidth / 2f), dragMin, dragMax);
            var snapshot = dragGrid;
            CancelDrag();
            if (Mathf.Abs(position.x - down.x) < 8 * View.Layout.Density || destination == dragStart) return;
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
            View.Choose(guardianSelected);
        }
        // The reroll asks first, on a small sheet over its tablet: the question, its cost, two verbs.
        public const string RerollTitle = "New next row?", RerollDetail = "Uses 1 reroll.", RerollConfirm = "Reroll", RerollKeep = "Keep";
        private bool askingReroll;
        public bool AskingReroll => askingReroll;
        public void Reroll()
        {
            if (!HostInputEnabled || !PresentationInitialized || State == null || busy || paused || recoveryRequired || State.RerollCharges == 0 || IsTerminal()) return;
            askingReroll = true; guardianSelected = false; View.Choose(false);
            View.OpenSheet(View.Layout.RerollButton, RerollTitle, RerollDetail, (RerollConfirm, ConfirmReroll), (RerollKeep, KeepRow));
        }
        public void ConfirmReroll()
        {
            if (!askingReroll) return;
            KeepRow(); Submit(new BoardAction(BoardActionKind.Reroll));
        }
        private void KeepRow()
        {
            if (!askingReroll) return;
            askingReroll = false; View.CloseModal();
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
            failure = null; View.Choose(false);
            View.Summary(State, Session, false); View.Status("");
            try
            {
                // The core plays the action and the board moves at once; what the
                // provider confirms is what is accepted. An action the core
                // refuses reaches no provider.
                var played = action.Play(Session.Accepted);
                var confirming = Confirming(action);
                if (!confirming.IsFaulted && !confirming.IsCanceled) await Move(played);
                var confirmed = await Confirmed(confirming);
                await Accept(played, confirmed);
                await ResolveRandomness();
            }
            catch (OperationCanceledException error) { if (!lifetime.IsCancellationRequested) ReportFailure(error); }
            catch (Exception error) { ReportFailure(error); }
            finally { if (this != null) CompleteInteraction(); }
        }
        private Task<CoreRunToken> Confirming(BoardAction action)
        {
            try { return Session.Actions.Submit(Session.Accepted, action, lifetime.Token); }
            catch (Exception error) { return Task.FromException<CoreRunToken>(error); }
        }
        // A confirmation that failed says nothing about the action: the run is
        // read once, without repeating the gesture, and that state is what counts.
        private async Task<CoreRunToken> Confirmed(Task<CoreRunToken> confirming)
        {
            if (!confirming.IsCompleted) View.Awaiting(true);
            try { return await confirming; }
            catch (OperationCanceledException) { throw; }
            catch (Exception error) when (Session.Actions is IBoardRecoveryProvider)
            {
                Debug.LogWarning("Board action: " + error.Message);
                View.Awaiting(true);
                var observed = await ((IBoardRecoveryProvider)Session.Actions).Recover(lifetime.Token);
                if (observed == null) throw;
                return observed;
            }
            finally { if (this != null && View != null) View.Awaiting(false); }
        }
        // The confirmed state is the played action, or that action and the row
        // it awaited. Anything else, a refused action included, puts the board on
        // the confirmed state and says so.
        private async Task Accept(RunTransition played, CoreRunToken confirmed)
        {
            lifetime.Token.ThrowIfCancellationRequested(); RequireRun(confirmed);
            if (confirmed.State.SequenceEqual(played.Token.State)) { Commit(played); return; }
            if (!TryObserveRow(played.Token, confirmed, out var row)) { Settle(confirmed); return; }
            Commit(played);
            await Move(row); Commit(row);
        }
        private async Task ResolveRandomness()
        {
            while (State.Phase == (byte)CorePhase.AwaitingVrf)
            {
                View.Summary(State, Session, false); View.Awaiting(true);
                var confirmed = await Session.Actions.ResolveVrf(Session.Accepted, lifetime.Token);
                View.Awaiting(false);
                // The row's motion is the core's account of that one output.
                if (!TryObserveRow(Session.Accepted, confirmed, out var row)) { Settle(confirmed); continue; }
                await Move(row); Commit(row);
            }
        }
        private bool TryObserveRow(CoreRunToken before, CoreRunToken confirmed, out RunTransition row)
        {
            RequireRun(confirmed);
            try { row = NativeEngine.ObserveVrf(before, confirmed); return true; }
            catch (NativeEngineException) { row = null; return false; }
        }
        public async void Recover()
        {
            if (busy || !recoveryRequired || recoveryUnavailable || !(Session?.Actions is IBoardRecoveryProvider provider)) return;
            busy = true; paused = false; guardianSelected = false; queued = null; queuedGrid = null;
            CancelDrag(); failure = null;
            View.OpenModal("Recovering run", BoardNotices.Text(BoardNotice.Recovering));
            View.Status(BoardNotices.Text(BoardNotice.Recovering));
            try
            {
                var result = await provider.Recover(lifetime.Token);
                lifetime.Token.ThrowIfCancellationRequested();
                if (result == null) { recoveryUnavailable = true; return; }
                Show(result);
                await ResolveRandomness();
                recoveryRequired = false; View.CloseModal();
                if (!Muted) music.UnPause();
            }
            catch (OperationCanceledException error) { if (!lifetime.IsCancellationRequested) ReportFailure(error); }
            catch (Exception error) { ReportFailure(error); }
            finally { if (this != null) CompleteInteraction(); }
        }
        private void RequireRun(CoreRunToken token)
        {
            if (!token.Config.SequenceEqual(Session.Accepted.Config))
                throw new InvalidOperationException("Accepted response belongs to another run configuration");
        }
        // An accepted state whose history the board did not see: shown as it is.
        private void Show(CoreRunToken accepted)
        {
            RequireRun(accepted);
            var final = NativeEngine.Summary(accepted);
            bool changed = !accepted.State.SequenceEqual(Session.Accepted.State);
            Session.Accepted = new CoreRunToken(accepted.Config, accepted.State); State = final;
            if (changed) Host?.Accepted?.Invoke(Session.Accepted);
            View.SetBoard(State.Grid); View.SetPreview(State.HasNextRow, State.NextRow);
            View.Summary(State, Session, false);
        }
        // The board had moved for an action the confirmed run does not hold.
        private void Settle(CoreRunToken confirmed)
        {
            Show(confirmed);
            failure = BoardNotices.Text(BoardNotice.Settled); Host?.Rejected?.Invoke(failure);
        }
        // The board's motion for one transition of the core. It accepts nothing.
        private async Task Move(RunTransition transition)
        {
            lifetime.Token.ThrowIfCancellationRequested();
            if (!PresentationTrace.ProjectBoard(View.DisplayGrid, transition.Events).SequenceEqual(NativeEngine.Summary(transition.Token).Grid))
                throw new InvalidOperationException("Presentation trace differs from the native board");
            Traced?.Invoke(transition.Events);
            var completion = new TaskCompletionSource<bool>();
            StartCoroutine(Animate(transition, completion));
            using (lifetime.Token.Register(() => completion.TrySetCanceled())) await completion.Task;
        }
        // A confirmed transition becomes the accepted run, with its feedback: the
        // gains, the count-up and the callouts follow the blocks, from the
        // accepted state alone. The combo is this move's lines, as the core's
        // trace lists them.
        private void Commit(RunTransition transition)
        {
            byte previousStars = State.LatchedStarSources, previousCharges = State.BonusCharges, previousEarned = State.ChargesEarned;
            uint previousScore = Session.Daily ? State.DailyScore : State.Score;
            ulong previousTheme = State.ObjectiveTotal;
            Session.Accepted = transition.Token; State = NativeEngine.Summary(transition.Token);
            Host?.Accepted?.Invoke(transition.Token);
            uint acceptedScore = Session.Daily ? State.DailyScore : State.Score;
            int lines = PresentationTrace.LinesCleared(transition.Events);
            var perfect = transition.Events.FirstOrDefault(e => e.Kind == PresentationKind.PerfectClear);
            View.ShowGains(acceptedScore > previousScore ? acceptedScore - previousScore : 0,
                Session.Daily && State.ObjectiveTotal > previousTheme ? State.ObjectiveTotal - previousTheme : 0,
                lines, ReducedMotion, perfect != null, perfect != null && perfect.Payload[0] == 1,
                // What the guardian's trigger earned, and whether the full tablet took all of it.
                State.ChargesEarned - previousEarned,
                State.ChargesEarned > previousEarned && State.BonusCharges == Protocol.ChargeCap
                    && State.BonusCharges - previousCharges + (transition.Events.Any(e => e.Kind == PresentationKind.BonusApplied) ? 1 : 0) < State.ChargesEarned - previousEarned);
            View.Summary(State, Session, false);
            View.Celebrate(previousStars, State.LatchedStarSources, lines, perfect != null);
            // One star sound for an action's newly earned stars; an ended run, which keeps none, earns none.
            if (HudLayout.NewStars(previousStars, State.LatchedStarSources).Any()) Sound(SoundCues.Star);
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
            busy = false; View.Awaiting(false);
            View.Summary(State, Session, HostInputEnabled && !paused && !recoveryRequired && State.Phase == (byte)CorePhase.Playing);
            View.Status(failure ?? "");
            if (recoveryRequired)
            {
                leaving = false; queued = null; queuedGrid = null; CancelDrag(); ShowRecovery(); return;
            }
            ShowTerminalIfNeeded();
            if (leaving) { if (IsTerminal()) leaving = false; else { LeaveForHome(); return; } }
            if (queued.HasValue)
            {
                var action = queued.Value; queued = null;
                // A swipe queued against a board that has since moved on is dropped without a word.
                if (HostInputEnabled && !paused && !recoveryRequired && State.Phase == (byte)CorePhase.Playing && queuedGrid.SequenceEqual(State.Grid)) Submit(action);
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
            View.Status(message); Host?.Rejected?.Invoke(message);
            Debug.LogWarning("Board action: " + error.Message);
        }
        private bool IsTerminal() => State != null && (State.Phase == (byte)CorePhase.Finished || State.Phase == (byte)CorePhase.LevelComplete);
        private void ShowRecovery()
        {
            music.Pause();
            if (busy)
                View.OpenModal("Recovering run", BoardNotices.Text(BoardNotice.Recovering));
            else if (recoveryUnavailable || !(Session.Actions is IBoardRecoveryProvider))
                View.OpenModal("Return to your runs", "This board cannot continue here. Return to your runs to recover the current state.",
                    ("Back to my runs", () => Host?.Exit?.Invoke()));
            else
                View.OpenModal("Recover run", "The action may have been accepted. Check the run before playing again.",
                    ("Recover run", Recover), ("Back to my runs", () => Host?.Exit?.Invoke()));
        }
        private void ShowTerminalIfNeeded(bool playFeedback = true)
        {
            if (!IsTerminal()) return;
            bool completed = State.Phase == (byte)CorePhase.LevelComplete || State.EndReason == 1;
            View.Terminal(completed); music.Pause(); if (playFeedback) Sound(ResultCue(Session, State));
            // The host shows the result; a board without one simply leaves.
            if (Host?.Terminal != null) Host.Terminal(this);
            else Host?.Exit?.Invoke();
        }

        public void Pause()
        {
            if (PresentationInitialized && Session != null && recoveryRequired) { ShowRecovery(); return; }
            if (!PresentationInitialized || Session == null || IsTerminal()) return;
            // The music plays on through a pause.
            KeepRow(); paused = true; queued = null; CancelDrag();
            pauseDialog?.Close();
            pauseDialog = PauseDialog.Pause(View, art, State, Session, Resume, PauseRows(), LeaveForHome, () => {
                pauseDialog?.Close();
                pauseDialog = PauseDialog.Confirm(View, art, EndRunCost(Session, State), EndRunDetail(Session), Resume,
                    () => { paused = false; pauseDialog?.Close(); pauseDialog = null; View.CloseModal(); Submit(new BoardAction(BoardActionKind.Abandon)); });
            });
        }
        // The pause's settings: the sound, haptics and reduced motion switches, and the text size.
        public PauseDialog.Row[] PauseRows() => new[] {
            new PauseDialog.Row { Name = Muted ? "Sound: off" : "Sound: on", Label = "Sound", Icon = SkinSlots.IconSound, On = !Muted,
                Invoke = () => { SetMuted(!Muted); Pause(); } },
            new PauseDialog.Row { Name = Haptics ? "Haptics: on" : "Haptics: off", Label = "Haptics", On = Haptics, Invoke = () => { SetHaptics(!Haptics); Pause(); } },
            new PauseDialog.Row { Name = ReducedMotion ? "Reduced motion: on" : "Reduced motion: off", Label = "Reduced motion", On = ReducedMotion,
                Invoke = () => { SetReducedMotion(!ReducedMotion); Pause(); } },
            new PauseDialog.Row { Name = TextScale > 1 ? "Text size: larger" : "Text size: standard", Label = "Text size", Value = TextScale > 1 ? "Larger" : "Standard",
                Invoke = () => { SetTextScale(TextScale > 1 ? 1 : 1.3f); Pause(); } },
        };
        private PauseDialog pauseDialog;
        // Home leaves the board with its run as it stands: nothing is sent and
        // nothing ends. An action still being confirmed is let finish first.
        private bool leaving;
        private void LeaveForHome()
        {
            var leave = Host?.Home ?? Host?.Exit;
            if (leave == null) { Resume(); return; }
            if (busy) { leaving = true; return; }
            leaving = false; pauseDialog?.Close(); pauseDialog = null; View.CloseModal();
            leave();
        }
        public const string EndRun = "End run";
        // What ending costs, from the core's end rule: an ended Campaign run
        // keeps no stars; an ended Daily is scored at its last accepted state,
        // and one without an accepted action ends unscored (the Arcade expires
        // the entry; Realms records nothing gained).
        public static string EndRunCost(BoardSession session, RunSummary state) =>
            !session.Daily ? "An ended run keeps no stars." :
            state.ActionCounter > 0 ? "Your score so far counts for today." : "Today’s run ends with no score.";
        // What stays: an ended Campaign run keeps its accepted actions.
        public static string EndRunDetail(BoardSession session) => session.Daily ? null : "Your accepted actions stay part of this run.";
        public void Resume()
        {
            if (!HostInputEnabled) return;
            if (recoveryRequired) { ShowRecovery(); return; }
            paused = false; leaving = false; View.CloseModal(); pauseDialog?.Close(); pauseDialog = null;
            if (!Muted) music.UnPause();
            View.Summary(State, Session, !busy && !recoveryRequired && State.Phase == (byte)CorePhase.Playing);
        }
        // Android may kill the process without a quit callback. A settings action
        // must finish its save while the app is still running.
        public void SetReducedMotion(bool value) { ReducedMotion = value; AppPreferences.SetReducedMotion(value); }
        public void SetHaptics(bool value) { Haptics = value; AppPreferences.SetHaptics(value); }
        public static float ReadSavedTextScale() => AppPreferences.TextScale;
        public static float ReadDisplayDensity() => Application.isEditor || Screen.dpi <= 0 ? 1 : Screen.dpi / 160;
        public static float SupportedTextScale(float value)
        {
            if (value != 1 && !Mathf.Approximately(value, 1.3f)) throw new ArgumentOutOfRangeException(nameof(value), "Supported text sizes are 1.0 and 1.3");
            return value > 1 ? 1.3f : 1;
        }
        public void SetTextScale(float value)
        {
            TextScale = SupportedTextScale(value); AppPreferences.SetTextScale(TextScale);
            if (PresentationInitialized && !busy) RefreshLayout();
        }
        public void SetMuted(bool value)
        {
            Muted = value; AppPreferences.SetMuted(value);
            if (effects != null) effects.mute = value;
            if (music != null) { music.mute = value; if (!value && music.clip != null && !music.isPlaying) music.Play(); }
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
        // The result's sound, by what the run kept: no stars is the loss, one or
        // two a small win, three a big win (an ended Campaign run keeps none). A
        // Daily has no stars: a new best is the big win, any other score the
        // small one, and no score the loss.
        public static string ResultCue(BoardSession session, RunSummary state)
        {
            if (session.Daily)
                return state.DailyScore == 0 ? SoundCues.Loss : state.DailyScore > (session.DailyFacts?.Best ?? uint.MaxValue) ? SoundCues.BigWin : SoundCues.SmallWin;
            int stars = state.EndReason == 3 ? 0 : HudLayout.StarCount(state.LatchedStarSources);
            return stars == 3 ? SoundCues.BigWin : stars > 0 ? SoundCues.SmallWin : SoundCues.Loss;
        }
        // Every transition the board moves for, as the core listed its events.
        public event Action<PresentationEvent[]> Traced;
        // Every cue the board plays, muted or not, by its SoundCues name.
        public event Action<string> SoundPlayed;
        private void Sound(string name)
        {
            SoundPlayed?.Invoke(name);
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

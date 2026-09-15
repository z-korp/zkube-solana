using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using ZKube.Core.Generated;
using ZKube.Integration.Client;
using ZKube.Integration.Client.Runs;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;
using ZKube.Local;

namespace ZKube.Integration.App
{
    public sealed class MoneyConfigurationException : InvalidOperationException
    {
        public string Code { get; }
        internal MoneyConfigurationException(string code) : base(code) { Code = code; }
    }
    // Explicit deployment input from the platform owner. There is no default
    // endpoint, remembered abandoned deployment, or successful offline fallback.
    public sealed class MoneyConnectionConfig
    {
        public string BaseUri { get; }
        public string RouterUri { get; }
        public string ExpectedGenesis { get; }
        public MoneyConnectionConfig(string baseUri, string routerUri, string expectedGenesis)
        { BaseUri = baseUri; RouterUri = routerUri; ExpectedGenesis = expectedGenesis; }
        internal void Validate()
        {
            if (string.IsNullOrWhiteSpace(BaseUri) || string.IsNullOrWhiteSpace(RouterUri) || string.IsNullOrWhiteSpace(ExpectedGenesis))
                throw new MoneyConfigurationException("configuration-unavailable");
            // The native wallet is currently fixed to solana:devnet. The value
            // is generated from the actual TypeScript client cluster authority.
            if (ExpectedGenesis != ClientPolicy.SolanaDevnetGenesisHash)
                throw new MoneyConfigurationException("unsupported-wallet-cluster");
            if (!ValidUri(BaseUri, out var baseAddress) || !ValidUri(RouterUri, out var routerAddress) || baseAddress == routerAddress)
                throw new MoneyConfigurationException("invalid-base-router-endpoints");
        }
        private static bool ValidUri(string value, out Uri uri) => Uri.TryCreate(value, UriKind.Absolute, out uri) &&
            uri.Scheme == Uri.UriSchemeHttps && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment);
    }

    // One concrete graph for local Campaign and Arcade. HTTP, native wallet/key
    // transport, and public storage are BORROWED from the platform owner.
    // Constructing the graph performs no read, authorization or key operation.
    public sealed partial class MoneyClientServices
    {
        private readonly object revisionsGate = new object();
        private readonly Dictionary<string, long> economyRevisions = new Dictionary<string, long>(StringComparer.Ordinal);
        public ProtocolBindings Protocol { get; }
        public SessionTokenBindings Tokens { get; }
        public AccountBindings Accounts { get; }
        public TransactionPlanner Planner { get; }
        public WalletClient Wallet { get; }
        public ClientIdentity Identity { get; }
        public DeviceKeyLifecycle Keys { get; }
        public SolanaRpcTransport Rpc { get; }
        public TransactionJournal Journal { get; }
        public SessionRecordStore Sessions { get; }
        public RunStateStore RunMarkers { get; }
        public ExecutionDispatcher Dispatcher { get; }
        public TransactionExecutor Executor { get; }
        public SessionAccess SessionAccess { get; }
        public SessionLifecycle SessionLifecycle { get; }
        public RunClient Runs { get; }
        public ProductQueries Products { get; }
        public DailyEntryReadinessQuery EntryReadiness { get; }
        public PublicDailyQuery PublicDaily { get; }
        public EconomyClient Economy { get; }

        public MoneyClientServices(string solanaJson, string sessionJson, MoneyConnectionConfig config,
            IJsonRpcHttp http, INativeDeviceKeyLifecycle native, IPublicClientStore storage, Func<long> now,
            Func<string, LocalProductStore> localCampaignStore,
            Func<byte[]> runClientSeed = null)
        {
            if (config == null) throw new MoneyConfigurationException("configuration-unavailable");
            config.Validate();
            if (string.IsNullOrWhiteSpace(solanaJson) || string.IsNullOrWhiteSpace(sessionJson))
                throw new MoneyConfigurationException("generated-schemas-unavailable");
            if (http == null || native == null || storage == null || now == null) throw new ArgumentNullException("platform dependencies");
            campaignStore = localCampaignStore ?? throw new ArgumentNullException(nameof(localCampaignStore));
            campaignClock = now;
            Protocol = new ProtocolBindings(solanaJson);
            Tokens = new SessionTokenBindings(sessionJson);
            Accounts = new AccountBindings(solanaJson, ZKube.Core.Generated.Protocol.PlayerStateAccountVersion,
                ZKube.Core.Generated.Protocol.ProtocolAccountVersion);
            Planner = new TransactionPlanner(Protocol, Tokens);
            Wallet = new WalletClient(native); Identity = new ClientIdentity(Wallet); Keys = new DeviceKeyLifecycle(native);
            Rpc = new SolanaRpcTransport(http, config.BaseUri, config.RouterUri, config.ExpectedGenesis, Protocol.ProgramId);
            Journal = new TransactionJournal(storage); Sessions = new SessionRecordStore(storage, Tokens, Protocol.ProgramId);
            RunMarkers = new RunStateStore(storage, Accounts, Tokens);
            var handoff = new SessionHandoff(Sessions, Keys, Tokens, Protocol.ProgramId);
            var persistence = new RunPersistence(RunMarkers);
            Dispatcher = new ExecutionDispatcher(
                new SessionInstructionReconciler(Protocol, Accounts, Tokens, Sessions, handoff, Planner),
                new SessionMaintenanceReconciler(Wallet, Sessions),
                new EconomyInstructionReconciler(Protocol, Accounts, Rpc, AcceptedEconomy),
                new RunInstructionReconciler(Protocol, Accounts, Planner, Rpc, persistence.Accept));
            Executor = new TransactionExecutor(Planner, Rpc, Wallet, Journal);
            SessionAccess = new SessionAccess(Wallet, Sessions, Tokens, Rpc, Protocol.ProgramId, now);
            SessionLifecycle = new SessionLifecycle(Identity, Wallet, Keys, Sessions, Tokens, Planner, Rpc,
                Journal, Executor, Dispatcher, Protocol.ProgramId, now);
            var recovery = new RunRecovery(Protocol.ProgramId, PlanningConstants.DelegationProgram, Tokens, Accounts);
            Runs = new RunClient(Identity, SessionAccess, Accounts, Planner, Rpc, RunMarkers, recovery,
                Journal, Executor, Dispatcher, now, Protocol, runClientSeed);
            Products = new ProductQueries(Identity, Accounts, Planner, Rpc, now);
            EntryReadiness = new DailyEntryReadinessQuery(Identity, SessionLifecycle, Accounts, Planner, Rpc, Journal, now);
            PublicDaily = new PublicDailyQuery(Accounts, Planner, Rpc, now);
            Economy = new EconomyClient(Identity, SessionAccess, Products, Planner, Journal, Executor, Dispatcher);
        }
        private Task AcceptedEconomy(EconomyObservation accepted)
        {
            // Reconciliation cannot depend on a visible page or a UI callback.
            // A matching owner view becomes stale; only ExecutionResult reports
            // whether the signed transaction succeeded, failed or expired.
            lock (revisionsGate) economyRevisions[accepted.Owner] = unchecked(EconomyRevision(accepted.Owner) + 1);
            return Task.CompletedTask;
        }
        internal long EconomyRevision(string owner)
        { lock (revisionsGate) return economyRevisions.TryGetValue(owner, out long revision) ? revision : 0; }
    }
}

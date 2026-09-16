using System;
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
            // The Kotlin wallet plugin is fixed to solana:devnet.
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
        public ProtocolBindings Protocol { get; }
        public SessionTokenBindings Tokens { get; }
        public AccountBindings Accounts { get; }
        public TransactionPlanner Planner { get; }
        public WalletClient Wallet { get; }
        public ClientIdentity Identity { get; }
        public SolanaRpcTransport Rpc { get; }
        public TransactionJournal Journal { get; }
        public SessionRecordStore Sessions { get; }
        public RunStateStore RunMarkers { get; }
        public ExecutionReconciler Reconciler { get; }
        public TransactionExecutor Executor { get; }
        public SessionAccess SessionAccess { get; }
        public SessionLifecycle SessionLifecycle { get; }
        public RunClient Runs { get; }
        public ProductQueries Products { get; }
        public DailyEntryReadinessQuery EntryReadiness { get; }
        public PublicDailyQuery PublicDaily { get; }
        public EconomyClient Economy { get; }

        public MoneyClientServices(string solanaJson, string sessionJson, MoneyConnectionConfig config,
            IJsonRpcHttp http, INativeWalletTransport native, IPublicClientStore storage, Func<long> now,
            Func<string, LocalProductStore> localCampaignStore,
            Func<byte[]> runClientSeed = null)
        {
            if (config == null) throw new MoneyConfigurationException("configuration-unavailable");
            config.Validate();
            if (string.IsNullOrWhiteSpace(solanaJson) || string.IsNullOrWhiteSpace(sessionJson))
                throw new MoneyConfigurationException("generated-schemas-unavailable");
            if (http == null || native == null || storage == null || now == null) throw new ArgumentNullException("platform dependencies");
            campaignStore = localCampaignStore ?? throw new ArgumentNullException(nameof(localCampaignStore));
            Protocol = new ProtocolBindings(solanaJson);
            Tokens = new SessionTokenBindings(sessionJson);
            Accounts = new AccountBindings(solanaJson, ZKube.Core.Generated.Protocol.PlayerStateAccountVersion,
                ZKube.Core.Generated.Protocol.ProtocolAccountVersion);
            Planner = new TransactionPlanner(Protocol, Tokens);
            Wallet = new WalletClient(native); Identity = new ClientIdentity(Wallet);
            Rpc = new SolanaRpcTransport(http, config.BaseUri, config.RouterUri, config.ExpectedGenesis, Protocol.ProgramId);
            Journal = new TransactionJournal(storage); Sessions = new SessionRecordStore(storage, Tokens, Protocol.ProgramId);
            RunMarkers = new RunStateStore(storage, Accounts);
            var persistence = new RunPersistence(RunMarkers);
            Reconciler = new ExecutionReconciler(Protocol, Accounts, Tokens, Sessions, Planner, Rpc,
                AcceptOwnerChange, persistence.Accept);
            Executor = new TransactionExecutor(Planner, Rpc, Wallet, Journal);
            SessionAccess = new SessionAccess(Wallet, Sessions, Tokens, Rpc, Protocol.ProgramId, now);
            SessionLifecycle = new SessionLifecycle(Identity, Wallet, Sessions, Tokens, Planner, Rpc,
                Journal, Executor, Reconciler, Protocol.ProgramId, now);
            var recovery = new RunRecovery(Protocol.ProgramId, PlanningConstants.DelegationProgram, Accounts);
            Runs = new RunClient(Identity, SessionAccess, Accounts, Planner, Rpc, RunMarkers, recovery,
                Journal, Executor, Reconciler, now, Protocol, runClientSeed);
            Products = new ProductQueries(Identity, Accounts, Planner, Rpc, now);
            EntryReadiness = new DailyEntryReadinessQuery(Identity, SessionLifecycle, Accounts, Planner, Rpc, Journal, now);
            PublicDaily = new PublicDailyQuery(Accounts, Planner, Rpc, now);
            Economy = new EconomyClient(Identity, SessionAccess, Products, Planner, Journal, Executor, Reconciler);
        }
        private Task AcceptOwnerChange(string owner)
        {
            Identity.InvalidateData(owner);
            return Task.CompletedTask;
        }
    }
}

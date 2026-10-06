using ZKube.Core.Generated;
using ZKube.Integration.Execution;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Presentation
{
    // The player's words for an operation's result: its outcome, what it was,
    // what to do next and its receipt line.
    public static class MoneyReceiptText
    {
        public static string Describe(ExecutionResult result, bool fullSignature = false)
        {
            string text = result.Outcome switch {
                ExecutionOutcome.Pending => Words.ArenaReceiptPending,
                ExecutionOutcome.ConfirmedFailure => Words.ArenaReceiptFailed,
                ExecutionOutcome.ConfirmedSuccess => Words.ArenaReceiptConfirmed,
                ExecutionOutcome.ExpiredReconciled => Words.ArenaReceiptExpired,
                ExecutionOutcome.FeeShortage => Words.ArenaReceiptFee,
                ExecutionOutcome.CompletedLocally => Words.ArenaReceiptLocal,
                // A request that was not sent says why, by the one owner of those words.
                _ => Refusal(result)
            };
            if (string.IsNullOrEmpty(result.Signature)) return text;
            string reference = fullSignature || result.Signature.Length <= 18 ? result.Signature :
                result.Signature.Substring(0, 6) + "…" + result.Signature.Substring(result.Signature.Length - 6);
            return Words.ArenaReceiptReference(text, reference);
        }

        // Why an action did not go through, in one short line; null when it did,
        // or when its transaction is still to be checked.
        public static string Refusal(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.ConfirmedSuccess or ExecutionOutcome.CompletedLocally or ExecutionOutcome.Pending => null,
            ExecutionOutcome.ConfirmedFailure => Words.ArenaRefusalFailed,
            // Sent, and it never reached a block before its blockhash ran out: nothing was spent.
            ExecutionOutcome.ExpiredReconciled => result.Intent == "start-daily" ? Words.ArenaRefusalExpiredEntry : Words.ArenaRefusalExpired,
            ExecutionOutcome.FeeShortage => result.Code == "device-deposit-low" ?
                Words.ArenaRefusalDepositLow : Words.ArenaRefusalWalletSol,
            _ => result.WalletChange != null ? Refusal(result.Code) + " (" + result.WalletChange + ")" : result.Failure != null ? Refusal(result.Failure) : result.Code == "simulation-rejected" ? Simulation(result.ChainError) : Refusal(result.Code)
        };
        // A request an error stopped, by what was asked and how it failed. Only a
        // request that never reached anything is the network's.
        public static string Refusal(RequestFailure failure)
        {
            // The service as the language names it; the transports' own names are what the log keeps.
            string service = failure.Service switch {
                "Solana" => Words.ArenaServiceSolana, "the game server" => Words.ArenaServiceServer, "the leaderboard" => Words.ArenaServiceLeaderboard,
                "the name service" => Words.ArenaServiceNames, _ => Words.ArenaServiceUnknown };
            // Every sentence opens with the service, whose name the catalogue writes with its capital.
            return failure.Kind switch {
                FailureKind.Timeout => Words.ArenaFailureTimeout(service),
                FailureKind.NoNetwork => Words.ArenaFailureNoNetwork,
                FailureKind.Insecure => Words.ArenaFailureInsecure(service),
                FailureKind.Busy => Words.ArenaFailureBusy(service),
                FailureKind.Refused => Words.ArenaFailureRefused(service),
                FailureKind.ServerError => Words.ArenaFailureServer(service),
                FailureKind.HttpError => Words.ArenaFailureHttp(service),
                FailureKind.RpcError => Words.ArenaFailureRpc(service),
                FailureKind.UnreadableReply => Words.ArenaFailureUnreadable(service),
                _ => Words.ArenaFailureDevice
            };
        }
        // What Solana said when it tried the transaction before the wallet was asked.
        private static string Simulation(string chainError) => chainError == null ? Words.ArenaSimulationRefused :
            chainError.Contains("AccountNotFound") ? Words.ArenaSimulationNoSol :
            chainError.Contains("InsufficientFunds") ? Words.ArenaRefusalWalletSol :
            chainError.Contains("BlockhashNotFound") ? Words.ArenaSimulationStale :
            Words.ArenaSimulationCheckSol;
        // The same line for a request the wallet, the network or this app refused, by its code.
        public static string Refusal(string code) => code switch {
            "wallet-rejected" or "wallet-interrupted" or "activity-recreated" => Words.ArenaRefusalNotApproved,
            "cancelled" => Words.ArenaRefusalCancelled,
            "wallet-unavailable" or "activity-unavailable" => Words.ArenaRefusalNoWallet,
            "sign-only-unavailable" or "unsupported-transaction-version" => Words.ArenaRefusalCannotSign,
            "wrong-chain" => Words.ArenaRefusalWrongChain,
            "wallet-changed-message" => Words.ArenaRefusalChanged,
            "account-changed" or "authorization-required" => Words.ArenaRefusalAccountChanged,
            "wallet-busy" or "execution-busy" => Words.ArenaRefusalBusy,
            "pending-transaction-exists" or "pending-transaction-changed" => Words.ArenaRefusalEarlier,
            "simulation-rejected" => Words.ArenaSimulationRefused,
            "preparation-failed" => Words.ArenaFailureDevice,
            _ => Words.ArenaRefusalNotSent
        };

        public static string Title(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.Pending => Words.ArenaTitlePending,
            ExecutionOutcome.ConfirmedFailure => Words.ArenaTitleFailed,
            ExecutionOutcome.ConfirmedSuccess => Confirmed(result),
            ExecutionOutcome.ExpiredReconciled => Words.ArenaTitleExpired,
            ExecutionOutcome.FeeShortage => Words.ArenaTitleFee,
            ExecutionOutcome.CompletedLocally => Words.ArenaTitleLocal,
            _ => Words.ArenaTitleNotSent
        };

        public static string Intent(ExecutionResult result) => result.Intent switch {
            "purchase-kredits" => Words.ArenaIntentPurchase,
            "session-renew" or "session-ensure" => Words.ArenaIntentDeviceSetup,
            "session-refill" => Words.ArenaIntentTopUp,
            "session-revoke" => Words.ArenaIntentDisable,
            "claim-daily" => Words.ArenaIntentClaim,
            "set-featured-identity" => Words.ArenaIntentLook,
            _ => Words.ArenaIntentOperation
        };

        // A confirmed operation's title, as one phrase: the operation and that it is confirmed.
        private static string Confirmed(ExecutionResult result) => result.Intent switch {
            "purchase-kredits" => Words.ArenaIntentPurchaseConfirmed,
            "session-renew" or "session-ensure" => Words.ArenaIntentDeviceSetupConfirmed,
            "session-refill" => Words.ArenaIntentTopUpConfirmed,
            "session-revoke" => Words.ArenaIntentDisableConfirmed,
            "claim-daily" => Words.ArenaIntentClaimConfirmed,
            "set-featured-identity" => Words.ArenaIntentLookConfirmed,
            _ => Words.ArenaIntentOperationConfirmed
        };

        public static string Next(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.Pending => Words.ArenaNextPending,
            ExecutionOutcome.ConfirmedFailure => Words.ArenaNextFailed,
            ExecutionOutcome.ConfirmedSuccess => Words.ArenaNextConfirmed,
            ExecutionOutcome.ExpiredReconciled => Words.ArenaNextExpired,
            ExecutionOutcome.FeeShortage => Words.ArenaNextFee,
            ExecutionOutcome.CompletedLocally => Words.ArenaNextLocal,
            _ => Words.ArenaNextNotSent
        };
    }
}

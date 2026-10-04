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
                ExecutionOutcome.Pending => "Transaction pending. Check again to confirm the outcome.",
                ExecutionOutcome.ConfirmedFailure => "Transaction failed.",
                ExecutionOutcome.ConfirmedSuccess => "Transaction confirmed.",
                ExecutionOutcome.ExpiredReconciled => "Transaction expired. Refresh before trying again.",
                ExecutionOutcome.FeeShortage => "There is not enough SOL for this transaction.",
                ExecutionOutcome.CompletedLocally => "No transaction was needed.",
                _ => result.Code == "execution-busy" ? "Another transaction is being checked. Try again shortly." :
                    result.Code == "pending-transaction-changed" ? "A different transaction is waiting. Check again." :
                    "The transaction request was not accepted. Refresh before trying again."
            };
            if (string.IsNullOrEmpty(result.Signature)) return text;
            string reference = fullSignature || result.Signature.Length <= 18 ? result.Signature :
                result.Signature.Substring(0, 6) + "…" + result.Signature.Substring(result.Signature.Length - 6);
            return text + "\nReceipt: " + reference;
        }

        // Why an action did not go through, in one short line; null when it did,
        // or when its transaction is still to be checked.
        public static string Refusal(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.ConfirmedSuccess or ExecutionOutcome.CompletedLocally or ExecutionOutcome.Pending => null,
            ExecutionOutcome.ConfirmedFailure => "The transaction failed. Nothing changed.",
            ExecutionOutcome.ExpiredReconciled => "The transaction expired before it was sent.",
            ExecutionOutcome.FeeShortage => result.Code == "device-deposit-low" ?
                "This device’s deposit is too low." : "Your wallet needs more SOL.",
            _ => result.Failure != null ? Refusal(result.Failure) : result.Code == "simulation-rejected" ? Simulation(result.ChainError) : Refusal(result.Code)
        };
        // A request an error stopped, by what was asked and how it failed. Only a
        // request that never reached anything is the network's.
        public static string Refusal(RequestFailure failure)
        {
            string service = failure.Service ?? "the service", Service = char.ToUpperInvariant(service[0]) + service.Substring(1);
            return failure.Kind switch {
                FailureKind.Timeout => Service + " took too long to answer.",
                FailureKind.NoNetwork => "The network could not be reached.",
                FailureKind.Insecure => "A secure connection to " + service + " could not be made.",
                FailureKind.Busy => Service + " is busy. Try again in a moment.",
                FailureKind.Refused => Service + " refused this device’s request.",
                FailureKind.ServerError => Service + " is having trouble. Try again.",
                FailureKind.HttpError => Service + " answered with an error.",
                FailureKind.RpcError => Service + " could not handle this request.",
                FailureKind.UnreadableReply => Service + " answered in a way this app could not read.",
                _ => "This request could not be prepared on this device."
            };
        }
        // What Solana said when it tried the transaction before the wallet was asked.
        private static string Simulation(string chainError) => chainError == null ? "Solana refused this request." :
            chainError.Contains("AccountNotFound") ? "Your wallet has no SOL on this network." :
            chainError.Contains("InsufficientFunds") ? "Your wallet needs more SOL." :
            chainError.Contains("BlockhashNotFound") ? "The request went stale. Try again." :
            "Solana refused this request. Check your wallet’s SOL.";
        // The same line for a request the wallet, the network or this app refused, by its code.
        public static string Refusal(string code) => code switch {
            "wallet-rejected" or "wallet-interrupted" or "activity-recreated" => "Not approved in your wallet.",
            "cancelled" => "The request was cancelled.",
            "wallet-unavailable" or "activity-unavailable" => "No wallet app was found.",
            "sign-only-unavailable" or "unsupported-transaction-version" => "This wallet cannot sign this request.",
            "wrong-chain" => "Your wallet is on another network.",
            "account-changed" or "authorization-required" => "The wallet account changed. Connect again.",
            "wallet-busy" or "execution-busy" => "Another request is still open.",
            "pending-transaction-exists" or "pending-transaction-changed" => "An earlier transaction needs checking first.",
            "simulation-rejected" => "Solana refused this request.",
            "preparation-failed" => "This request could not be prepared on this device.",
            _ => "The request was not sent."
        };

        public static string Title(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.Pending => "Transaction pending",
            ExecutionOutcome.ConfirmedFailure => "Transaction failed",
            ExecutionOutcome.ConfirmedSuccess => Intent(result) + " confirmed",
            ExecutionOutcome.ExpiredReconciled => "Transaction expired",
            ExecutionOutcome.FeeShortage => "Not enough SOL",
            ExecutionOutcome.CompletedLocally => "Nothing to send",
            _ => "Request not sent"
        };

        public static string Intent(ExecutionResult result) => result.Intent switch {
            "purchase-kredits" => "Purchase",
            "session-renew" or "session-ensure" => "Device setup",
            "session-refill" => "Deposit top-up",
            "session-revoke" => "Device disabling",
            "claim-daily" => "Reward claim",
            "set-featured-identity" => "New look",
            _ => "Operation"
        };

        public static string Next(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.Pending => "The outcome is not confirmed yet. Check this transaction before starting another.",
            ExecutionOutcome.ConfirmedFailure => "The operation did not complete. Refresh before trying again.",
            ExecutionOutcome.ConfirmedSuccess => "The operation is confirmed.",
            ExecutionOutcome.ExpiredReconciled => "Refresh before starting a new operation.",
            ExecutionOutcome.FeeShortage => "Top up this device’s deposit or fund your wallet before retrying.",
            ExecutionOutcome.CompletedLocally => "Nothing needed to be sent.",
            _ => "Nothing was sent. Refresh before trying again."
        };
    }
}

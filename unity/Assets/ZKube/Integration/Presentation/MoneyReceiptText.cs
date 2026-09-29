using ZKube.Integration.Execution;

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
                ExecutionOutcome.FeeShortage => "There is not enough SOL to cover the transaction fee.",
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

        public static string Title(ExecutionResult result) => result.Outcome switch {
            ExecutionOutcome.Pending => "Transaction pending",
            ExecutionOutcome.ConfirmedFailure => "Transaction failed",
            ExecutionOutcome.ConfirmedSuccess => Intent(result) + " confirmed",
            ExecutionOutcome.ExpiredReconciled => "Transaction expired",
            ExecutionOutcome.FeeShortage => "Not enough for the fee",
            ExecutionOutcome.CompletedLocally => "Nothing to send",
            _ => "Request not sent"
        };

        public static string Intent(ExecutionResult result) => result.Intent switch {
            "purchase-kredits" => "Purchase",
            "session-renew" or "session-ensure" => "Device setup",
            "session-refill" => "Allowance refill",
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
            ExecutionOutcome.FeeShortage => "Refill this device’s fee allowance or fund your wallet before retrying.",
            ExecutionOutcome.CompletedLocally => "Nothing needed to be sent.",
            _ => "Nothing was sent. Refresh before trying again."
        };
    }
}

using ZKube.Integration.Execution;

namespace ZKube.Integration.Presentation
{
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
    }
}

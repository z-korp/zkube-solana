package com.zkorp.zkube.unitywallet

internal class WalletFailure(val code: String) : Exception(code)

internal object WalletPolicy {
    const val SIGN_TRANSACTIONS = "solana:signTransactions"
    const val CHAIN = "solana:devnet"

    fun requireCapabilities(versions: List<Any>, features: List<String>, accountFeatures: List<String>?) {
        if (versions.none { it is Int && it == 0 }) throw WalletFailure("unsupported-transaction-version")
        if (SIGN_TRANSACTIONS !in features || (accountFeatures != null && SIGN_TRANSACTIONS !in accountFeatures))
            throw WalletFailure("sign-only-unavailable")
    }

    fun requireAccount(actual: ByteArray, expected: ByteArray?) {
        if (actual.size != 32 || (expected != null && !actual.contentEquals(expected))) throw WalletFailure("account-changed")
    }

    fun selectAccount(accounts: List<ByteArray>, expected: ByteArray?): Int {
        val index = if (expected == null) 0 else accounts.indexOfFirst { it.contentEquals(expected) }
        if (index !in accounts.indices) throw WalletFailure("account-changed")
        requireAccount(accounts[index], expected)
        return index
    }
}

fun interface BridgeCallback { fun onComplete(resultJson: String) }

// A process-local callback is consumed exactly once. No request is relaunched
// after activity recreation or process death; C# reconciles before retrying.
internal object PendingWalletRequests {
    internal data class Entry(val request: String, val callback: BridgeCallback)
    private val pending = mutableMapOf<String, Entry>()
    @Synchronized fun add(id: String, request: String, callback: BridgeCallback) {
        if (pending.isNotEmpty()) throw WalletFailure("wallet-busy")
        pending[id] = Entry(request, callback)
    }
    @Synchronized fun get(id: String): Entry? = pending[id]
    fun complete(id: String, result: String) {
        val entry = synchronized(this) { pending.remove(id) }
        entry?.callback?.onComplete(result)
    }
}

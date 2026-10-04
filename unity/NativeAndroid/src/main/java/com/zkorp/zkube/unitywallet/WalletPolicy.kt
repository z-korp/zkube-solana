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

// The wallet authorization the app keeps between launches: the connected
// address and the wallet's token for it. A start reads the address back without
// asking the wallet; the token never leaves the vault. An entry that cannot be
// read as both is dropped, so a start never restores a stale address.
internal object SavedAuthorization {
    private const val NAME = "wallet-authorization"
    fun load(vault: SecretVault): org.json.JSONObject? {
        val stored = vault.get(NAME) ?: return null
        val saved = runCatching { org.json.JSONObject(stored.toString(Charsets.UTF_8)) }.getOrNull()
        val valid = saved != null && runCatching {
            android.util.Base64.decode(saved.getString("owner"), android.util.Base64.NO_WRAP).size == 32 && saved.getString("authToken").isNotEmpty()
        }.getOrDefault(false)
        if (!valid) { vault.remove(NAME); return null }
        return saved
    }
    fun owner(vault: SecretVault): String? = load(vault)?.getString("owner")
    fun save(vault: SecretVault, owner: String, authToken: String) =
        vault.put(NAME, org.json.JSONObject().put("owner", owner).put("authToken", authToken).toString().toByteArray(Charsets.UTF_8))
    fun forget(vault: SecretVault) = vault.remove(NAME)
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

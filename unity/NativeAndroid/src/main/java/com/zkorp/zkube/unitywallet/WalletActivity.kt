package com.zkorp.zkube.unitywallet

import android.net.Uri
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

class WalletActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra("requestId") ?: run { finish(); return }
        val pending = PendingWalletRequests.get(id) ?: run { finish(); return }
        if (savedInstanceState != null) {
            PendingWalletRequests.complete(id, failure(id, "activity-recreated")); finish(); return
        }
        val sender = ActivityResultSender(this)
        lifecycleScope.launch {
            try {
                val result = withTimeout(60000) { execute(JSONObject(pending.request), sender) }
                PendingWalletRequests.complete(id, result.put("requestId", id).put("ok", true).toString())
            } catch (cause: Exception) {
                val code = if (cause is WalletFailure) cause.code else if (cause is CancellationException) "wallet-interrupted" else "wallet-rejected"
                PendingWalletRequests.complete(id, failure(id, code))
            } finally { finish() }
        }
    }

    private suspend fun execute(request: JSONObject, sender: ActivityResultSender): JSONObject {
        val operation = request.getString("operation")
        if (operation !in setOf("authorize", "signTransactions", "disconnect")) throw WalletFailure("unsupported-operation")
        val vault = SecretVault(this)
        val saved = vault.get("wallet-authorization")?.let { JSONObject(it.toString(Charsets.UTF_8)) }
        val expected = request.optString("owner").takeIf { it.isNotEmpty() }
            ?.let { Base64.decode(it, Base64.NO_WRAP) }
            ?: saved?.getString("owner")?.let { Base64.decode(it, Base64.NO_WRAP) }
        if (operation != "authorize" && (expected == null || saved == null)) throw WalletFailure("authorization-required")
        if (saved != null && expected != null) WalletPolicy.requireAccount(Base64.decode(saved.getString("owner"), Base64.NO_WRAP), expected)
        val adapter = MobileWalletAdapter(ConnectionIdentity(Uri.parse("https://zkube-solana.vercel.app"),
            Uri.parse("assets/pwa-512x512.png"), applicationInfo.loadLabel(packageManager).toString())).also { it.blockchain = Solana.Devnet; it.authToken = saved?.getString("authToken") }
        if (operation == "disconnect") {
            return when (adapter.disconnect(sender)) {
                is TransactionResult.Success -> { vault.remove("wallet-authorization"); JSONObject() }
                else -> throw WalletFailure("wallet-rejected")
            }
        }
        val transaction = if (operation == "signTransactions") Base64.decode(request.getString("transaction"), Base64.NO_WRAP).also {
            if (it.isEmpty() || it.size > 1232) throw WalletFailure("invalid-transaction")
        } else null
        val result = adapter.transact(sender) { authorization ->
            val account = authorization.accounts[WalletPolicy.selectAccount(authorization.accounts.map { it.publicKey }, expected)]
            WalletPolicy.requireAccount(account.publicKey, expected)
            val chains = account.chains
            if (chains != null && WalletPolicy.CHAIN !in chains) throw WalletFailure("wrong-chain")
            val capabilities = getCapabilities()
            WalletPolicy.requireCapabilities(capabilities.supportedTransactionVersions.toList(),
                capabilities.supportedOptionalFeatures.toList(), account.features?.toList())
            JSONObject().put("owner", Base64.encodeToString(account.publicKey, Base64.NO_WRAP)).also { output ->
                if (transaction != null) {
                    val signed = signTransactions(arrayOf(transaction)).signedPayloads
                    if (signed.size != 1) throw WalletFailure("invalid-wallet-response")
                    output.put("transaction", Base64.encodeToString(signed.single(), Base64.NO_WRAP))
                }
            }
        }
        return when (result) {
            is TransactionResult.Success -> {
                val identity = result.payload.getString("owner")
                vault.put("wallet-authorization", JSONObject().put("owner", identity)
                    .put("authToken", result.authResult.authToken).toString().toByteArray(Charsets.UTF_8))
                result.payload
            }
            is TransactionResult.NoWalletFound -> throw WalletFailure("wallet-unavailable")
            is TransactionResult.Failure -> throw (result.e as? WalletFailure ?: WalletFailure("wallet-rejected"))
        }
    }
}

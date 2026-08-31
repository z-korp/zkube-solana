package com.zkorp.zkube

import android.net.Uri
import android.util.Base64
import androidx.activity.ComponentActivity
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "MwaBridge")
class MwaBridge : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var sender: ActivityResultSender
    private lateinit var adapter: MobileWalletAdapter

    override fun load() {
        val rootActivity = activity as? ComponentActivity
            ?: error("MwaBridge requires a ComponentActivity")
        sender = ActivityResultSender(rootActivity)
        adapter = MobileWalletAdapter(
            connectionIdentity = ConnectionIdentity(
                identityUri = Uri.parse("https://zkube-solana.vercel.app"),
                iconUri = Uri.parse("assets/pwa-512x512.png"),
                identityName = "zKube",
            ),
        ).also { it.blockchain = Solana.Devnet }
    }

    @PluginMethod
    fun authorize(call: PluginCall) = launch(call) {
        adapter.authToken = call.getString("authToken")
        when (val result = adapter.connect(sender)) {
            is TransactionResult.Success -> authorizationObject(result.authResult)
            is TransactionResult.NoWalletFound -> error(result.message)
            is TransactionResult.Failure -> throw result.e
        }
    }

    @PluginMethod
    fun signTransactions(call: PluginCall) = launch(call) {
        adapter.authToken = requireAuthToken(call)
        val transactions = requirePayloads(call, "transactions")
        require(transactions.size == 1) {
            "MwaBridge signs exactly one transaction per request"
        }
        when (val result = adapter.transact(sender) {
            signTransactions(transactions).signedPayloads
        }) {
            is TransactionResult.Success -> authorizationObject(result.authResult).apply {
                put("signedTransactions", encodePayloads(result.payload))
            }
            is TransactionResult.NoWalletFound -> error(result.message)
            is TransactionResult.Failure -> throw result.e
        }
    }

    @PluginMethod
    fun signMessages(call: PluginCall) = launch(call) {
        adapter.authToken = requireAuthToken(call)
        val messages = requirePayloads(call, "messages")
        require(messages.size == 1) {
            "MwaBridge signs exactly one message per request"
        }
        when (val result = adapter.transact(sender) { authorization ->
            val address = authorization.accounts.first().publicKey
            signMessagesDetached(messages, Array(messages.size) { address }).messages
        }) {
            is TransactionResult.Success -> authorizationObject(result.authResult).apply {
                put("signedMessages", JSArray(result.payload.map { signed ->
                    require(signed.signatures.size == 1) {
                        "Wallet returned an unexpected message signature count"
                    }
                    JSObject().apply {
                        put("message", encode(signed.message))
                        put("signature", encode(signed.signatures.first()))
                    }
                }))
            }
            is TransactionResult.NoWalletFound -> error(result.message)
            is TransactionResult.Failure -> throw result.e
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) = launch(call) {
        adapter.authToken = requireAuthToken(call)
        when (val result = adapter.disconnect(sender)) {
            is TransactionResult.Success -> JSObject()
            is TransactionResult.NoWalletFound -> error(result.message)
            is TransactionResult.Failure -> throw result.e
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }

    private fun launch(call: PluginCall, operation: suspend () -> JSObject) {
        scope.launch {
            try {
                call.resolve(operation())
            } catch (cause: Throwable) {
                call.reject(cause.message ?: "Mobile Wallet Adapter request failed")
            }
        }
    }

    private fun authorizationObject(
        authorization: com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient.AuthorizationResult,
    ): JSObject {
        val account = authorization.accounts.first()
        return JSObject().apply {
            put("authToken", authorization.authToken)
            put("publicKey", encode(account.publicKey))
            account.accountLabel?.let { put("walletLabel", it) }
        }
    }

    private fun requireAuthToken(call: PluginCall): String =
        requireNotNull(call.getString("authToken")) { "authToken is required" }

    private fun requirePayloads(call: PluginCall, name: String): Array<ByteArray> {
        val values = requireNotNull(call.getArray(name)) { "$name is required" }
        require(values.length() > 0) { "$name must not be empty" }
        return Array(values.length()) { index ->
            val encoded = values.getString(index)
            Base64.decode(encoded, Base64.NO_WRAP)
        }
    }

    private fun encodePayloads(payloads: Array<ByteArray>): JSArray =
        JSArray(payloads.map(::encode))

    private fun encode(payload: ByteArray): String =
        Base64.encodeToString(payload, Base64.NO_WRAP)
}

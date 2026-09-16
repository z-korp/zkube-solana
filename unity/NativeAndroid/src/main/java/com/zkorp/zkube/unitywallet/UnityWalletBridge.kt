package com.zkorp.zkube.unitywallet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom

object UnityWalletBridge {
    @JvmStatic fun start(activity: Activity, requestJson: String, callback: BridgeCallback) {
        require(requestJson.length <= 8192)
        val request = JSONObject(requestJson)
        val id = request.getString("requestId")
        require(id.length in 1..80)
        try {
            PendingWalletRequests.add(id, requestJson, callback)
            activity.runOnUiThread {
                try { activity.startActivity(Intent(activity, WalletActivity::class.java).putExtra("requestId", id)) }
                catch (_: Exception) { PendingWalletRequests.complete(id, failure(id, "activity-unavailable")) }
            }
        } catch (cause: WalletFailure) { callback.onComplete(failure(id, cause.code)) }
    }

    @JvmStatic fun loadDeviceSeed(context: Context, create: Boolean): String? =
        DeviceSeeds.load(SecretVault(context), create)?.let {
            try { Base64.encodeToString(it, Base64.NO_WRAP) } finally { it.fill(0) }
        }
}

internal object DeviceSeeds {
    @Synchronized fun load(vault: SecretVault, create: Boolean): ByteArray? {
        vault.get("device")?.let { require(it.size == 32); return it }
        if (!create) return null
        val seed = ByteArray(32).also { SecureRandom().nextBytes(it) }
        try { vault.put("device", seed); return seed.copyOf() }
        finally { seed.fill(0) }
    }
}

internal fun failure(id: String, code: String) = JSONObject().put("requestId", id).put("ok", false).put("error", code).toString()
